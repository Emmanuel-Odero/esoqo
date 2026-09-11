package authsvc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// SmsProvider mirrors packages/auth/src/sms.ts's smsProvider() — env-gated,
// dev-safe by default. "console" and "mock" never dial a real gateway.
//
// SMS_TEST_ENV is a coarse dev/prod override checked first, so switching
// between "read the code from the mock catcher" and "send a real text
// via Celcom" doesn't require editing SMS_PROVIDER itself (and can't
// accidentally leak into a real deployment — it only overrides when
// explicitly set):
//   SMS_TEST_ENV=local → force "mock" (localhost:8026 catcher)
//   SMS_TEST_ENV=CELO  → force "celcom" (real gateway)
//   unset              → fall through to SMS_PROVIDER as before
func SmsProvider() string {
	switch strings.ToLower(os.Getenv("SMS_TEST_ENV")) {
	case "local":
		return "mock"
	case "celo":
		return "celcom"
	}
	v := os.Getenv("SMS_PROVIDER")
	if v == "" {
		return "console"
	}
	return v
}

// SendSms — console mode logs to stdout (read it directly, the code is
// never returned to a caller); mock mode hits the local mock-sms catcher
// (see docker-compose.yml's mock-sms service) the same way
// packages/auth/src/sms.ts does; "celcom" dials the real Celcom Africa
// bulk SMS gateway (isms.celcomafrica.com) — the actual live gateway
// this deployment uses (Africa's Talking, referenced in the TS sibling
// packages/auth/src/sms.ts, was never wired up here or there for real
// sends). Any other provider value is a no-op error — never falls
// through to dialing a live gateway by accident.
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
		senderID := os.Getenv("SMS_SENDER_ID")
		if senderID == "" {
			senderID = "ESOKO"
		}
		// Param names match packages/auth/src/sms.ts's 'mock' branch —
		// the mock-smtp image reads "mobiles" as the recipient, not "to";
		// sending "to" left the catcher UI showing a blank recipient.
		q := url.Values{"mobiles": {msisdn}, "sender": {senderID}, "message": {message}}
		resp, err := http.Get(mockURL + "/sendsms?" + q.Encode())
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		return nil
	case "celcom":
		return sendCelcomSms(msisdn, message)
	default:
		// Real gateway integration (Africa's Talking) is not yet ported to
		// core-go — see packages/auth/src/sms.ts for the TS implementation
		// this will mirror when a live-send path is needed here.
		return fmt.Errorf("SMS provider %q is not yet wired in core-go", SmsProvider())
	}
}

// celcomResponse — Celcom Africa's bulk SMS API wraps each recipient's
// result in a "responses" array. 200 is success; anything else is a
// rejection (bad credentials, blocked shortcode, insufficient balance,
// etc.). "mobile" comes back as a bare JSON number, not a string.
type celcomResponse struct {
	Responses []struct {
		RespCode int             `json:"response-code"`
		RespDesc string          `json:"response-description"`
		Mobile   json.RawMessage `json:"mobile"`
	} `json:"responses"`
}

// sendCelcomSms posts to Celcom Africa's sendsms endpoint. Expects
// CELCOM_API_KEY, CELCOM_PARTNER_ID and CELCOM_SHORTCODE in the
// environment; CELCOM_API_URL overrides the endpoint for testing.
func sendCelcomSms(msisdn, message string) error {
	apiKey := os.Getenv("CELCOM_API_KEY")
	partnerID := os.Getenv("CELCOM_PARTNER_ID")
	shortcode := os.Getenv("CELCOM_SHORTCODE")
	if apiKey == "" || partnerID == "" || shortcode == "" {
		return fmt.Errorf("CELCOM_API_KEY/CELCOM_PARTNER_ID/CELCOM_SHORTCODE are not set")
	}
	apiURL := os.Getenv("CELCOM_API_URL")
	if apiURL == "" {
		apiURL = "https://isms.celcomafrica.com/api/services/sendsms/"
	}

	// Celcom expects the mobile number without the leading "+" (e.g.
	// "254712345678"), unlike our internal +E.164 msisdn shape.
	mobile := strings.TrimPrefix(msisdn, "+")

	body, err := json.Marshal(map[string]string{
		"apikey":    apiKey,
		"partnerID": partnerID,
		"message":   message,
		"shortcode": shortcode,
		"mobile":    mobile,
	})
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach the SMS gateway: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("SMS gateway rejected the request (HTTP %d): %s", resp.StatusCode, string(raw))
	}

	var parsed celcomResponse
	if err := json.Unmarshal(raw, &parsed); err != nil || len(parsed.Responses) == 0 {
		// Some gateway errors come back as a flat JSON object instead of
		// the {"responses":[...]} success shape — surface the raw body
		// rather than silently treating an unparseable reply as success.
		return fmt.Errorf("unexpected SMS gateway response: %s", string(raw))
	}
	for _, r := range parsed.Responses {
		if r.RespCode != 200 {
			return fmt.Errorf("SMS gateway declined %s: %s", string(r.Mobile), r.RespDesc)
		}
	}
	return nil
}
