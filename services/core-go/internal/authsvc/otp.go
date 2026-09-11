package authsvc

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"math/big"
	"regexp"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/esoko/core-go/internal/notify"
)

// Ported 1:1 from packages/auth/src/otp.ts. Codes are never stored, only
// HMAC(code, OTP_PEPPER). Per-MSISDN + per-IP rate limits, exponential
// per-number cooldown and a hard daily spend cap guard the one attack
// that actually costs money here: SMS pumping.

type OtpPurpose string

const (
	OtpRegistration  OtpPurpose = "REGISTRATION"
	OtpSignIn        OtpPurpose = "SIGN_IN"
	OtpPinReset      OtpPurpose = "PIN_RESET"
	OtpStepUp        OtpPurpose = "STEP_UP"
	OtpConsentGrant  OtpPurpose = "CONSENT_GRANT"
	OtpParcelReceipt OtpPurpose = "PARCEL_RECEIPT"
)

const (
	otpTTL         = 10 * time.Minute
	otpMaxAttempts = 5
	smsCostKES     = 0.8 // per segment — replace with the real aggregator rate
)

var kenyanMobileRe = regexp.MustCompile(`^(7\d{8}|1[01]\d{7})$`)

// IsAllowedPrefix — only Safaricom, Airtel and Telkom mobile prefixes.
// Blocks premium-rate ranges.
func IsAllowedPrefix(e164 string) bool {
	if len(e164) < 5 || e164[:4] != "+254" {
		return false
	}
	return kenyanMobileRe.MatchString(e164[4:])
}

type OtpErrorCode string

const (
	OtpRateLimited     OtpErrorCode = "RATE_LIMITED"
	OtpBadPrefix       OtpErrorCode = "BAD_PREFIX"
	OtpSpendCap        OtpErrorCode = "SPEND_CAP"
	OtpExpired         OtpErrorCode = "EXPIRED"
	OtpTooManyAttempts OtpErrorCode = "TOO_MANY_ATTEMPTS"
	OtpWrongCode       OtpErrorCode = "WRONG_CODE"
)

type OtpError struct {
	Message string
	Code    OtpErrorCode
}

func (e *OtpError) Error() string { return e.Message }

type OtpService struct {
	rdb                    *redis.Client
	pepper                 string
	dailyCapKES            float64
	rateLimitPerHourMSISDN int
}

func NewOtpService(rdb *redis.Client, pepper string, dailyCapKES float64, rateLimitPerHour int) *OtpService {
	return &OtpService{rdb: rdb, pepper: pepper, dailyCapKES: dailyCapKES, rateLimitPerHourMSISDN: rateLimitPerHour}
}

func (s *OtpService) hashCode(code, msisdn string) string {
	mac := hmac.New(sha256.New, []byte(s.pepper))
	mac.Write([]byte(msisdn + ":" + code))
	return hex.EncodeToString(mac.Sum(nil))
}

func otpKey(msisdn string, purpose OtpPurpose) string {
	return fmt.Sprintf("otp:%s:%s", purpose, msisdn)
}

type SendResult struct {
	ExpiresAt       time.Time
	CooldownSeconds int
}

func (s *OtpService) IssueOtp(ctx context.Context, msisdn string, purpose OtpPurpose, ip string) (*SendResult, error) {
	if !IsAllowedPrefix(msisdn) {
		return nil, &OtpError{"That is not a Kenyan mobile number we can send to", OtpBadPrefix}
	}

	if err := CheckRateLimit(ctx, s.rdb, "otp:msisdn:"+msisdn, s.rateLimitPerHourMSISDN, time.Hour); err != nil {
		if _, ok := err.(*RateLimitError); ok {
			return nil, &OtpError{"Too many codes requested. Try again in a little while.", OtpRateLimited}
		}
		return nil, err
	}
	if ip != "" {
		if err := CheckRateLimit(ctx, s.rdb, "otp:ip:"+ip, 20, time.Hour); err != nil {
			if _, ok := err.(*RateLimitError); ok {
				return nil, &OtpError{"Too many codes requested. Try again in a little while.", OtpRateLimited}
			}
			return nil, err
		}
	}

	spendKey := "otp:spend:" + time.Now().UTC().Format("2006-01-02")
	spent, _ := s.rdb.Get(ctx, spendKey).Float64()
	if spent+smsCostKES > s.dailyCapKES {
		return nil, &OtpError{"Verification is temporarily unavailable. Please try later.", OtpSpendCap}
	}

	sendCountKey := "otp:sends:" + msisdn
	sends, _ := s.rdb.Get(ctx, sendCountKey).Int()
	cooldown := 30 << uint(sends)
	if cooldown > 900 {
		cooldown = 900
	}

	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	expiresAt := time.Now().Add(otpTTL)

	pipe := s.rdb.TxPipeline()
	k := otpKey(msisdn, purpose)
	pipe.HSet(ctx, k, "hash", s.hashCode(code, msisdn), "attempts", 0)
	pipe.Expire(ctx, k, otpTTL)
	pipe.Incr(ctx, sendCountKey)
	pipe.Expire(ctx, sendCountKey, time.Hour)
	pipe.IncrByFloat(ctx, spendKey, smsCostKES)
	pipe.Expire(ctx, spendKey, 48*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}

	if SmsProvider() == "console" {
		fmt.Printf("\n  ┌─ OTP ─────────────────────────────\n  │  %s\n  │  code: %s\n  │  purpose: %s\n  └───────────────────────────────────\n\n", msisdn, code, purpose)
		return &SendResult{ExpiresAt: expiresAt, CooldownSeconds: cooldown}, nil
	}

	if err := SendSms(msisdn, notify.OtpCode(code), "otp"); err != nil {
		return nil, err
	}
	return &SendResult{ExpiresAt: expiresAt, CooldownSeconds: cooldown}, nil
}

func (s *OtpService) VerifyOtp(ctx context.Context, msisdn string, purpose OtpPurpose, code string) (bool, error) {
	k := otpKey(msisdn, purpose)
	rec, err := s.rdb.HGetAll(ctx, k).Result()
	if err != nil {
		return false, err
	}
	storedHash, ok := rec["hash"]
	if !ok || storedHash == "" {
		return false, &OtpError{"That code has expired. Ask for a new one.", OtpExpired}
	}

	attempts := 0
	fmt.Sscanf(rec["attempts"], "%d", &attempts)
	if attempts >= otpMaxAttempts {
		s.rdb.Del(ctx, k)
		return false, &OtpError{"Too many wrong attempts. Ask for a new code.", OtpTooManyAttempts}
	}

	expected, err1 := hex.DecodeString(storedHash)
	actual, err2 := hex.DecodeString(s.hashCode(code, msisdn))
	okMatch := err1 == nil && err2 == nil && len(expected) == len(actual) && subtle.ConstantTimeCompare(expected, actual) == 1

	if !okMatch {
		s.rdb.HIncrBy(ctx, k, "attempts", 1)
		return false, &OtpError{fmt.Sprintf("That code is not right. %d tries left.", otpMaxAttempts-attempts-1), OtpWrongCode}
	}

	s.rdb.Del(ctx, k)
	s.rdb.Del(ctx, "otp:sends:"+msisdn)
	return true, nil
}
