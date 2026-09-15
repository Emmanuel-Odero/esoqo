package authsvc

import (
	"context"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

// alertSpendCap fires when the daily OTP SMS budget is exhausted.
//
// Hitting this cap is not a routine event: OTP messages cost real money
// (~KES 0.8 each), so the only ways to reach it are a genuine traffic
// spike or someone pumping the endpoint. Previously it was recorded with
// a stdout line nobody was watching, which meant an attacker could burn
// the entire daily budget and the first symptom would be users quietly
// unable to sign in.
//
// The SMS leg is deliberately capped at one message per ops number per
// day, held in Redis: an alert path that sends without a limit of its
// own is just a second pump waiting to be found. When the guard can't be
// taken (Redis down) the log still fires — losing the alert is
// acceptable, sending thousands of them is not.
func (s *OtpService) alertSpendCap(ctx context.Context, spentKES float64, msisdn, ip string) {
	// Always, regardless of whether SMS alerting is configured. Rendered
	// as one line so it is greppable and alertable from the platform log
	// drain without any extra infrastructure.
	log.Printf("ALERT otp_daily_spend_cap_exceeded spent_kes=%.2f cap_kes=%.2f last_msisdn=%s client_ip=%q",
		spentKES, s.dailyCapKES, maskMsisdn(msisdn), ip)

	raw := strings.TrimSpace(os.Getenv("OPS_ALERT_MSISDNS"))
	if raw == "" || SmsProvider() == "console" {
		return
	}

	day := time.Now().UTC().Format("2006-01-02")
	for _, to := range strings.Split(raw, ",") {
		to = strings.TrimSpace(to)
		if to == "" {
			continue
		}
		// SETNX-style once-per-day guard, so a sustained attack produces
		// one alert rather than one per blocked request.
		ok, err := s.rdb.SetNX(ctx, "otp:spendalert:"+day+":"+to, "1", 48*time.Hour).Result()
		if err != nil || !ok {
			continue
		}
		if err := SendSms(to, spendCapAlertSms(s.dailyCapKES), "ops-spend-alert"); err != nil {
			log.Printf("core-go: could not deliver spend-cap alert to ops: %v", err)
		}
	}
}

func spendCapAlertSms(capKES float64) string {
	return "Esoqo alert: the daily OTP SMS budget (KES " +
		trimFloat(capKES) + ") is exhausted. Sign-in codes are being refused. Check for abuse."
}

// maskMsisdn keeps an alert line useful without writing a full subscriber
// number into logs that are retained and widely readable.
func maskMsisdn(msisdn string) string {
	if len(msisdn) <= 4 {
		return "***"
	}
	return "***" + msisdn[len(msisdn)-3:]
}

func trimFloat(f float64) string {
	s := strings.TrimRight(strings.TrimRight(strconv.FormatFloat(f, 'f', 2, 64), "0"), ".")
	if s == "" {
		return "0"
	}
	return s
}
