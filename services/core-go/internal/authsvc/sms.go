package authsvc

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
)

// SmsProvider mirrors packages/auth/src/sms.ts's smsProvider() — env-gated,
// dev-safe by default. "console" and "mock" never dial a real gateway.
func SmsProvider() string {
	v := os.Getenv("SMS_PROVIDER")
	if v == "" {
		return "console"
	}
	return v
}

// SendSms — console mode logs to stdout (read it directly, the code is
// never returned to a caller); mock mode hits the local mock-sms catcher
// (see docker-compose.yml's mock-sms service) the same way
// packages/auth/src/sms.ts does; any other provider value is a no-op
// here until a real gateway integration is ported (Africa's Talking, in
// the TS original) — never falls through to dialing a live gateway by
// accident.
func SendSms(msisdn, message, purpose string) error {
	switch SmsProvider() {
	case "console":
		fmt.Printf("\n  ┌─ SMS (console) ────────────────────\n  │  %s\n  │  %s\n  │  purpose: %s\n  └───────────────────────────────────\n\n", msisdn, message, purpose)
		return nil
	case "mock":
		mockURL := os.Getenv("SMS_MOCK_URL")
		if mockURL == "" {
			mockURL = "http://localhost:8026"
		}
		q := url.Values{"to": {msisdn}, "message": {message}}
		resp, err := http.Get(mockURL + "/sendsms?" + q.Encode())
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		return nil
	default:
		// Real gateway integration (Africa's Talking) is not yet ported to
		// core-go — see packages/auth/src/sms.ts for the TS implementation
		// this will mirror when a live-send path is needed here.
		return fmt.Errorf("SMS provider %q is not yet wired in core-go", SmsProvider())
	}
}
