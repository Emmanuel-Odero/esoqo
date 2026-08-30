// Package config centralises environment handling for core-go, the same
// decentralised-but-consistent pattern the TypeScript side uses (no shared
// env-schema package exists there either — see packages/domain/src/env.ts
// for the one thing every language-side does share: the APP_ENV switch).
package config

import (
	"os"
	"strconv"
	"strings"
)

// AppEnv mirrors packages/domain/src/env.ts's appEnv(): the single switch
// every provider-gating decision (SMS, M-Pesa, Pesapal) reads.
type AppEnv string

const (
	AppEnvDevelopment   AppEnv = "development"
	AppEnvLocalTestProd AppEnv = "LOCAL_TEST_PROD"
	AppEnvProduction    AppEnv = "production"
)

func CurrentAppEnv() AppEnv {
	switch os.Getenv("APP_ENV") {
	case string(AppEnvLocalTestProd):
		return AppEnvLocalTestProd
	case string(AppEnvProduction):
		return AppEnvProduction
	default:
		return AppEnvDevelopment
	}
}

// Config holds every env var core-go reads, resolved once at boot with the
// same dev-safe fallbacks the TS packages use at point of use.
type Config struct {
	Port        string
	DatabaseURL string
	RedisURL    string

	// CORS — see httpapi.Server.corsMiddleware's own comment; only
	// matters for the Flutter *web* target, native apps ignore it.
	CORSAllowedOrigins []string

	// Auth
	OTPPepper           string
	OTPDailySpendCapKES float64
	OTPRateLimitPerHour int
	SessionSecret       string
	AuditChainSeed      string

	// SMS
	SMSProvider string
	SMSAPIKey   string
	SMSUsername string
	SMSSenderID string

	// M-Pesa
	MpesaProvider       string
	MpesaConsumerKey    string
	MpesaConsumerSecret string
	MpesaShortcode      string
	MpesaPasskey        string
	MpesaCallbackURL    string

	// Pesapal
	PesapalProvider       string
	PesapalConsumerKey    string
	PesapalConsumerSecret string
	PesapalIPNID          string
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func Load() Config {
	dailyCap, err := strconv.ParseFloat(getenv("OTP_DAILY_SPEND_CAP_KES", "5000"), 64)
	if err != nil {
		dailyCap = 5000
	}
	rateLimit, err := strconv.Atoi(getenv("OTP_RATE_LIMIT_PER_HOUR", "5"))
	if err != nil {
		rateLimit = 5
	}

	var corsOrigins []string
	if raw := getenv("CORS_ALLOWED_ORIGINS", ""); raw != "" {
		corsOrigins = strings.Split(raw, ",")
	}

	return Config{
		Port:               getenv("PORT", "4100"),
		DatabaseURL:        getenv("DATABASE_URL", "postgres://esoko:esoko@localhost:6432/esoko?sslmode=disable"),
		RedisURL:           getenv("REDIS_URL", "redis://localhost:6379"),
		CORSAllowedOrigins: corsOrigins,

		OTPPepper:           getenv("OTP_PEPPER", "dev-pepper-change-me"),
		OTPDailySpendCapKES: dailyCap,
		OTPRateLimitPerHour: rateLimit,
		SessionSecret:       getenv("SESSION_SECRET", "dev-session-secret-change-me"),
		AuditChainSeed:      getenv("AUDIT_CHAIN_SEED", "esoko-genesis"),

		SMSProvider: getenv("SMS_PROVIDER", "console"),
		SMSAPIKey:   getenv("SMS_API_KEY", ""),
		SMSUsername: getenv("SMS_USERNAME", ""),
		SMSSenderID: getenv("SMS_SENDER_ID", "ESOKO"),

		MpesaProvider:       getenv("MPESA_PROVIDER", ""),
		MpesaConsumerKey:    getenv("MPESA_CONSUMER_KEY", ""),
		MpesaConsumerSecret: getenv("MPESA_CONSUMER_SECRET", ""),
		MpesaShortcode:      getenv("MPESA_SHORTCODE", ""),
		MpesaPasskey:        getenv("MPESA_PASSKEY", ""),
		MpesaCallbackURL:    getenv("MPESA_CALLBACK_URL", ""),

		PesapalProvider:       getenv("PESAPAL_PROVIDER", ""),
		PesapalConsumerKey:    getenv("PESAPAL_CONSUMER_KEY", ""),
		PesapalConsumerSecret: getenv("PESAPAL_CONSUMER_SECRET", ""),
		PesapalIPNID:          getenv("PESAPAL_IPN_ID", ""),
	}
}
