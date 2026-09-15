package config

import (
	"strings"
	"testing"
)

func TestDevelopmentKeepsFallbacks(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	cfg := Load()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("development should boot with no secrets set: %v", err)
	}
	if cfg.SessionSecret == "" {
		t.Error("development should still get a dev SESSION_SECRET")
	}
}

// The whole point of C4: a published constant must never be what signs a
// production session, OTP, audit chain or fleet QR code.
func TestProductionRefusesMissingSecrets(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	err := Load().Validate()
	if err == nil {
		t.Fatal("production must refuse to boot without secrets")
	}
	for _, key := range []string{"OTP_PEPPER", "SESSION_SECRET", "AUDIT_CHAIN_SEED", "FLEET_QR_SECRET"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error should name %s, got: %v", key, err)
		}
	}
}

// LOCAL_TEST_PROD points DATABASE_URL at real infrastructure, so it is
// held to production's standard, not development's.
func TestLocalTestProdIsHeldToProductionStandard(t *testing.T) {
	t.Setenv("APP_ENV", "LOCAL_TEST_PROD")
	if Load().Validate() == nil {
		t.Fatal("LOCAL_TEST_PROD must not silently use dev secret fallbacks")
	}
}

// C1 and C2 are one landmine: turning on a real provider is exactly the
// moment the callback becomes a money-crediting endpoint.
func TestRealMpesaProviderRequiresCallbackSecret(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	for _, k := range []string{"OTP_PEPPER", "SESSION_SECRET", "AUDIT_CHAIN_SEED", "FLEET_QR_SECRET"} {
		t.Setenv(k, "set-for-this-test")
	}

	t.Setenv("MPESA_PROVIDER", "console")
	if err := Load().Validate(); err != nil {
		t.Fatalf("console mode needs no callback secret: %v", err)
	}

	t.Setenv("MPESA_PROVIDER", "production")
	err := Load().Validate()
	if err == nil || !strings.Contains(err.Error(), "MPESA_CALLBACK_SECRET") {
		t.Fatalf("a real provider must require MPESA_CALLBACK_SECRET, got: %v", err)
	}

	t.Setenv("MPESA_CALLBACK_SECRET", "an-unguessable-path-segment")
	if err := Load().Validate(); err != nil {
		t.Fatalf("should boot once the callback secret is set: %v", err)
	}
}
