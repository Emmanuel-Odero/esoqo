// Package config centralises environment handling for core-go, the same
// decentralised-but-consistent pattern the TypeScript side uses (no shared
// env-schema package exists there either — see packages/domain/src/env.ts
// for the one thing every language-side does share: the APP_ENV switch).
package config

import (
	"fmt"
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
	// DirectDatabaseURL — a connection that bypasses any transaction-mode
	// connection pooler in front of DatabaseURL (dev's pgbouncer; see
	// docker-compose.yml's own comment on it), for the one thing that
	// needs a stable session: Postgres LISTEN/NOTIFY behind the counter
	// ticket queue's live push. Falls back to DatabaseURL when unset —
	// production has no pooler in front of Postgres today, so the two
	// are the same connection string there.
	DirectDatabaseURL string
	RedisURL          string

	// CORS — see httpapi.Server.corsMiddleware's own comment; only
	// matters for the Flutter *web* target, native apps ignore it.
	CORSAllowedOrigins []string

	// TrustedProxyHops — how many X-Forwarded-For entries are appended by
	// infrastructure we control, counted from the right. Render's edge is
	// one hop. Raise it behind an extra CDN, or that CDN's address
	// becomes the rate-limit bucket every client shares. 0 disables XFF
	// entirely (direct exposure, no proxy).
	TrustedProxyHops int

	// Auth
	OTPPepper           string
	OTPDailySpendCapKES float64
	OTPRateLimitPerHour int
	SessionSecret       string
	AuditChainSeed      string

	// OrgContextActivationDays — how long a SUBJECT's OTP-verified org
	// context (docs/proposals/esoqo-unified-crew-identity.md) stays
	// switched on before the next org-scoped action needs a fresh OTP
	// again. Deliberately configurable, not the original design's fixed
	// shift-length window: a stolen/unlocked phone risk is mitigated by
	// an org admin's suspend (kills the activation immediately,
	// independent of this TTL), not by forcing a short expiry on
	// everyone by default.
	OrgContextActivationDays int

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

	// MpesaCallbackSecret is an unguessable path segment appended to the
	// STK callback route. Daraja offers no signature, HMAC or source
	// allowlist of its own, so the only thing separating a real callback
	// from a forged POST is a URL only Safaricom was ever told. Required
	// whenever a non-console M-Pesa provider is configured; see
	// Config.Validate.
	MpesaCallbackSecret string

	// Co-operative Bank Open API. CoopProvider "" leaves the Daraja STK path
	// in charge; "sandbox"/"production" route parcel STK through Co-op.
	// CoopBaseURL defaults to https://openapi.co-opbank.co.ke.
	CoopProvider       string
	CoopBaseURL        string
	CoopBasicAuth      string // base64(key:secret), as issued; with or without "Basic "
	// CoopSourceAccount is the Co-op account B2C payouts are debited from.
	// CoopCourierAutopay turns on the sweep that pays accrued courier
	// earnings out automatically; off by default because it moves real money.
	CoopSourceAccount  string
	CoopCourierAutopay bool
	CoopUserID         string
	CoopOperatorCode   string
	CoopCallbackURL    string
	// CoopCallbackSecret is the unguessable path segment of the callback
	// URL. The callback body is never trusted (the outcome is re-queried),
	// but it still keeps strangers from making us call Co-op on demand.
	CoopCallbackSecret string

	// Pesapal
	PesapalProvider       string
	PesapalConsumerKey    string
	PesapalConsumerSecret string
	PesapalIPNID          string

	// Strangler bridge: when Daraja callbacks land here for checkouts Go
	// doesn't own yet (registration/donation — still TS-only), the raw
	// body is forwarded to the TS core webhook. Empty = disabled.
	TsCoreWebhookURL string

	// Fleet QR + fare proof + vouchers. HMAC secret signs trip/voucher
	// QR payloads (never trust raw trip IDs from a scanner). TTL bounds
	// how long a CONFIRMED fare counts as valid proof to a tout.
	FleetQrSecret      string
	FareProofTTLMin    int
	VouchersEnabled    bool
	LoyaltyEarnEnabled bool

	// Object storage for field-captured images (proof-of-delivery
	// photos). Same env var names packages/db/src/storage.ts already
	// reads, deliberately — both services write into the same bucket and
	// splitting the configuration into two vocabularies would guarantee
	// they eventually point at different places. Unset StorageProvider
	// means "development uses local disk, everything else uses R2",
	// which is that file's rule too.
	StorageProvider   string
	LocalStorageDir   string
	R2Bucket          string
	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey string

	// PublicTrackingBaseURL — where a PKG- code resolves for someone who
	// just got an SMS about it, e.g. https://esoqo.co.ke. Every parcel
	// notification appends a tracking link built from this (see
	// notify.TrackingURL); an empty value degrades every message back to
	// the code-only text they all used to be, rather than texting
	// somebody a broken "https:///t/PKG-XXXX".
	PublicTrackingBaseURL string

	// ParcelVolumetricDivisor converts cm³ to the kilogrammes a bulky
	// parcel is charged as — (L × W × H) / divisor, see
	// dbx.VolumetricKg.
	//
	// Configurable because the right number is a commercial decision,
	// not an engineering one: 5000 is the IATA air convention and
	// charges bulk hardest, 6000 is common for road and is gentler on
	// exactly the light-and-bulky freight a matatu network carries a lot
	// of. It moves real prices for real customers, so it belongs
	// somewhere a business decision can change it without a deploy of
	// new logic.
	ParcelVolumetricDivisor float64

	// missingSecrets records secrets that had no value outside
	// development, where falling back to a published constant would
	// mean forgeable sessions/OTPs/QR codes. Read by Validate.
	missingSecrets []string
}

// Validate reports secrets that must be set in this APP_ENV but weren't.
// Call it before anything reads Config — booting with a known-value
// SESSION_SECRET or FLEET_QR_SECRET is strictly worse than not booting.
func (c Config) Validate() error {
	missing := c.missingSecrets

	// The moment a real provider is switched on, money actually moves and
	// the STK callback becomes a money-crediting endpoint reachable by
	// anyone on the internet. Refuse that combination without the secret
	// path segment that authenticates it.
	if c.MpesaProvider != "" && c.MpesaProvider != "console" && c.MpesaCallbackSecret == "" {
		missing = append(missing, fmt.Sprintf(
			"MPESA_CALLBACK_SECRET (required with MPESA_PROVIDER=%s)", c.MpesaProvider))
	}

	if c.CoopProvider != "" && c.CoopCallbackSecret == "" {
		missing = append(missing, fmt.Sprintf(
			"COOP_CALLBACK_SECRET (required with COOP_PROVIDER=%s)", c.CoopProvider))
	}

	if c.CoopCourierAutopay && (c.CoopProvider == "" || c.CoopSourceAccount == "") {
		missing = append(missing, "COOP_PROVIDER and COOP_SOURCE_ACCOUNT (required with COOP_COURIER_AUTOPAY=true)")
	}

	if len(missing) == 0 {
		return nil
	}
	return fmt.Errorf(
		"APP_ENV=%s requires these to be set (no dev fallback applies outside development): %s",
		CurrentAppEnv(), strings.Join(missing, ", "))
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

// secret resolves a value that signs or peppers something — a session
// cookie, an OTP hash, an audit chain, a fleet QR payload. The dev
// fallbacks below are published in this repo, so they are only ever
// applied under APP_ENV=development. Anywhere else an unset var is
// recorded for Validate to refuse the boot over, because a service that
// silently starts with 'dev-session-secret-change-me' issues sessions
// anyone holding this source can forge. LOCAL_TEST_PROD counts as
// production here on purpose: it points at real infrastructure.
func secret(key, devFallback string, missing *[]string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	if CurrentAppEnv() == AppEnvDevelopment {
		return devFallback
	}
	*missing = append(*missing, key)
	return ""
}

func getenvInt(key string, fallback int) int {
	v, err := strconv.Atoi(getenv(key, ""))
	if err != nil {
		return fallback
	}
	return v
}

// getenvFloat, with the same fall-back-on-anything-unparseable contract
// getenvInt has. A non-positive value also falls back: a zero divisor
// would mean dividing by it, and a negative one would mean charging
// negative weight.
func getenvFloat(key string, fallback float64) float64 {
	v, err := strconv.ParseFloat(getenv(key, ""), 64)
	if err != nil || v <= 0 {
		return fallback
	}
	return v
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

	var missing []string

	databaseURL := getenv("DATABASE_URL", "postgres://esoqo:esoqo@localhost:6432/esoqo?sslmode=disable")

	cfg := Config{
		Port:               getenv("PORT", "4100"),
		DatabaseURL:        databaseURL,
		DirectDatabaseURL:  getenv("DIRECT_DATABASE_URL", databaseURL),
		RedisURL:           getenv("REDIS_URL", "redis://localhost:6379"),
		CORSAllowedOrigins: corsOrigins,
		TrustedProxyHops:   getenvInt("TRUSTED_PROXY_HOPS", 1),

		OTPPepper:           secret("OTP_PEPPER", "dev-pepper-change-me", &missing),
		OTPDailySpendCapKES: dailyCap,
		OTPRateLimitPerHour: rateLimit,
		SessionSecret:       secret("SESSION_SECRET", "dev-session-secret-change-me", &missing),
		AuditChainSeed:      secret("AUDIT_CHAIN_SEED", "esoko-genesis", &missing),
		// 60 days — the middle of the 30-90 day range ops asked for;
		// override with ORG_CONTEXT_ACTIVATION_DAYS per environment.
		OrgContextActivationDays: getenvInt("ORG_CONTEXT_ACTIVATION_DAYS", 60),

		SMSProvider: getenv("SMS_PROVIDER", "console"),
		SMSAPIKey:   getenv("SMS_API_KEY", ""),
		SMSUsername: getenv("SMS_USERNAME", ""),
		SMSSenderID: getenv("SMS_SENDER_ID", "ESOQO"),

		MpesaProvider:       getenv("MPESA_PROVIDER", ""),
		MpesaConsumerKey:    getenv("MPESA_CONSUMER_KEY", ""),
		MpesaConsumerSecret: getenv("MPESA_CONSUMER_SECRET", ""),
		MpesaShortcode:      getenv("MPESA_SHORTCODE", ""),
		MpesaPasskey:        getenv("MPESA_PASSKEY", ""),
		MpesaCallbackURL:    getenv("MPESA_CALLBACK_URL", ""),
		MpesaCallbackSecret: getenv("MPESA_CALLBACK_SECRET", ""),

		CoopProvider:       getenv("COOP_PROVIDER", ""),
		CoopBaseURL:        getenv("COOP_BASE_URL", ""),
		CoopBasicAuth:      getenv("COOP_BASIC_AUTH", ""),
		CoopSourceAccount:  getenv("COOP_SOURCE_ACCOUNT", ""),
		CoopCourierAutopay: getenv("COOP_COURIER_AUTOPAY", "false") == "true",
		CoopUserID:         getenv("COOP_USER_ID", ""),
		CoopOperatorCode:   getenv("COOP_OPERATOR_CODE", ""),
		CoopCallbackURL:    getenv("COOP_CALLBACK_URL", ""),
		CoopCallbackSecret: getenv("COOP_CALLBACK_SECRET", ""),

		PesapalProvider:       getenv("PESAPAL_PROVIDER", ""),
		PesapalConsumerKey:    getenv("PESAPAL_CONSUMER_KEY", ""),
		PesapalConsumerSecret: getenv("PESAPAL_CONSUMER_SECRET", ""),
		PesapalIPNID:          getenv("PESAPAL_IPN_ID", ""),

		TsCoreWebhookURL: getenv("TS_CORE_WEBHOOK_URL", ""),

		FleetQrSecret:      secret("FLEET_QR_SECRET", "dev-fleet-qr-secret-change-me", &missing),
		FareProofTTLMin:    getenvInt("FARE_PROOF_TTL_MIN", 90),
		VouchersEnabled:    getenv("VOUCHERS_ENABLED", "true") == "true",
		LoyaltyEarnEnabled: getenv("LOYALTY_EARN_ENABLED", "true") == "true",

		StorageProvider:   getenv("STORAGE_PROVIDER", ""),
		LocalStorageDir:   getenv("LOCAL_STORAGE_DIR", ""),
		R2Bucket:          getenv("R2_BUCKET", "esoko"),
		R2AccountID:       getenv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:     getenv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getenv("R2_SECRET_ACCESS_KEY", ""),

		PublicTrackingBaseURL: strings.TrimRight(getenv("PUBLIC_TRACKING_BASE_URL", ""), "/"),

		// Zero means "not configured", which dbx.VolumetricKg already
		// reads as "use the documented default". Deliberately not
		// repeating that default here: config would have to import dbx
		// to name it, which is the wrong direction, and a second copy of
		// the number is a second thing to forget to change.
		ParcelVolumetricDivisor: getenvFloat("PARCEL_VOLUMETRIC_DIVISOR", 0),
	}

	// Set after the literal, not inside it: Go does not guarantee a plain
	// variable read is ordered against the secret() calls above.
	cfg.missingSecrets = missing
	return cfg
}
