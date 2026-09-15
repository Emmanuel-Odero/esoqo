// Package payments ports packages/payments/src/mpesa.ts and pesapal.ts —
// same provider-gating discipline (console|sandbox|production, default
// console; production never honoured from a development APP_ENV, no
// matter what the provider env var says).
package payments

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/esoqo/core-go/internal/config"
)

const (
	mpesaSandboxBase    = "https://sandbox.safaricom.co.ke"
	mpesaProductionBase = "https://api.safaricom.co.ke"
)

func MpesaProvider(cfg config.Config) string {
	requested := cfg.MpesaProvider
	if requested == "live" {
		requested = "production"
	}
	if requested == "sandbox" {
		return "sandbox"
	}
	if requested == "production" {
		if config.CurrentAppEnv() == config.AppEnvDevelopment {
			return "console"
		}
		return "production"
	}
	if config.CurrentAppEnv() == config.AppEnvDevelopment {
		return "console"
	}
	if config.CurrentAppEnv() == config.AppEnvLocalTestProd {
		return "sandbox"
	}
	return "console"
}

type MpesaErrorCode string

const (
	MpesaInvalidMsisdn MpesaErrorCode = "INVALID_MSISDN"
	MpesaDarajaError   MpesaErrorCode = "DARAJA_ERROR"
	MpesaNotConfigured MpesaErrorCode = "NOT_CONFIGURED"
)

type MpesaError struct {
	Message string
	Code    MpesaErrorCode
}

func (e *MpesaError) Error() string { return e.Message }

var mpesaMsisdnRe = regexp.MustCompile(`^\+254(7|1)\d{8}$`)

type StkPushRequest struct {
	Msisdn           string // E.164, e.g. +254712345678
	AmountKES        float64
	AccountReference string
	Description      string
}

type StkPushResult struct {
	CheckoutRequestID   string
	MerchantRequestID   string
	ResponseDescription string
	AutoConfirmed       bool
	MpesaReceiptCode    string
}

func InitiateStkPush(cfg config.Config, req StkPushRequest) (*StkPushResult, error) {
	if !mpesaMsisdnRe.MatchString(req.Msisdn) {
		return nil, &MpesaError{"That does not look like a Kenyan mobile number", MpesaInvalidMsisdn}
	}

	switch MpesaProvider(cfg) {
	case "console":
		// Mimics the ~1.5s round trip a real STK push takes to reach the
		// phone and be approved, so the client's waiting state is
		// exercised honestly instead of resolving instantly.
		time.Sleep(1500 * time.Millisecond)
		checkoutRequestID := fmt.Sprintf("console-%d-%s", time.Now().UnixMilli(), randomSuffix())
		receipt := "CNS" + randomSuffix()
		fmt.Printf("\n  ┌─ M-PESA STK PUSH (console) ────────\n  │  %s\n  │  KES %.2f — %s\n  │  checkoutRequestId: %s\n  │  auto-confirmed with receipt %s\n  └─────────────────────────────────────\n\n",
			req.Msisdn, req.AmountKES, req.AccountReference, checkoutRequestID, receipt)
		return &StkPushResult{
			CheckoutRequestID:   checkoutRequestID,
			MerchantRequestID:   checkoutRequestID,
			ResponseDescription: "Accepted (console — never enabled in a deployed environment)",
			AutoConfirmed:       true,
			MpesaReceiptCode:    receipt,
		}, nil
	case "sandbox":
		return initiateDarajaStkPush(cfg, req, mpesaSandboxBase)
	default: // production
		return initiateDarajaStkPush(cfg, req, mpesaProductionBase)
	}
}

func randomSuffix() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 6)
	for i := range out {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		out[i] = alphabet[n.Int64()]
	}
	return string(out)
}

func getDarajaAccessToken(cfg config.Config, base string) (string, error) {
	if cfg.MpesaConsumerKey == "" || cfg.MpesaConsumerSecret == "" {
		return "", &MpesaError{"MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET are not set", MpesaNotConfigured}
	}
	auth := base64.StdEncoding.EncodeToString([]byte(cfg.MpesaConsumerKey + ":" + cfg.MpesaConsumerSecret))
	req, _ := http.NewRequest("GET", base+"/oauth/v1/generate?grant_type=client_credentials", nil)
	req.Header.Set("Authorization", "Basic "+auth)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", &MpesaError{"Could not authenticate with Daraja", MpesaDarajaError}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", &MpesaError{"Could not authenticate with Daraja", MpesaDarajaError}
	}
	var data struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", &MpesaError{"Could not authenticate with Daraja", MpesaDarajaError}
	}
	return data.AccessToken, nil
}

func darajaTimestamp() string {
	return time.Now().Format("20060102150405")
}

func initiateDarajaStkPush(cfg config.Config, req StkPushRequest, base string) (*StkPushResult, error) {
	if cfg.MpesaShortcode == "" || cfg.MpesaPasskey == "" || cfg.MpesaCallbackURL == "" {
		return nil, &MpesaError{"MPESA_SHORTCODE/MPESA_PASSKEY/MPESA_CALLBACK_URL are not set", MpesaNotConfigured}
	}
	token, err := getDarajaAccessToken(cfg, base)
	if err != nil {
		return nil, err
	}
	timestamp := darajaTimestamp()
	password := base64.StdEncoding.EncodeToString([]byte(cfg.MpesaShortcode + cfg.MpesaPasskey + timestamp))
	msisdnLocal := req.Msisdn[1:] // strip leading '+'

	accountRef := req.AccountReference
	if len(accountRef) > 12 {
		accountRef = accountRef[:12]
	}
	desc := req.Description
	if len(desc) > 13 {
		desc = desc[:13]
	}

	body, _ := json.Marshal(map[string]interface{}{
		"BusinessShortCode": cfg.MpesaShortcode,
		"Password":          password,
		"Timestamp":         timestamp,
		"TransactionType":   "CustomerPayBillOnline",
		"Amount":            int(req.AmountKES + 0.5),
		"PartyA":            msisdnLocal,
		"PartyB":            cfg.MpesaShortcode,
		"PhoneNumber":       msisdnLocal,
		"CallBackURL":       cfg.MpesaCallbackURL,
		"AccountReference":  accountRef,
		"TransactionDesc":   desc,
	})

	httpReq, _ := http.NewRequest("POST", base+"/mpesa/stkpush/v1/processrequest", bytes.NewReader(body))
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, &MpesaError{"Daraja rejected the STK push request", MpesaDarajaError}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	var data struct {
		CheckoutRequestID   string `json:"CheckoutRequestID"`
		MerchantRequestID   string `json:"MerchantRequestID"`
		ResponseDescription string `json:"ResponseDescription"`
		ErrorMessage        string `json:"errorMessage"`
	}
	_ = json.Unmarshal(respBody, &data)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || data.CheckoutRequestID == "" {
		msg := data.ErrorMessage
		if msg == "" {
			msg = "Daraja rejected the STK push request"
		}
		return nil, &MpesaError{msg, MpesaDarajaError}
	}

	merchantReqID := data.MerchantRequestID
	if merchantReqID == "" {
		merchantReqID = data.CheckoutRequestID
	}
	desc2 := data.ResponseDescription
	if desc2 == "" {
		desc2 = "Accepted"
	}
	return &StkPushResult{
		CheckoutRequestID:   data.CheckoutRequestID,
		MerchantRequestID:   merchantReqID,
		ResponseDescription: desc2,
		AutoConfirmed:       false,
	}, nil
}

// ── callback payload parsing, used by the STK webhook route ──────────

type StkCallbackResult struct {
	CheckoutRequestID string
	Succeeded         bool
	ResultDescription string
	MpesaReceiptCode  string

	// Amount and PayerMsisdn come from CallbackMetadata on a successful
	// push. Daraja signs nothing, so these are the only payload fields
	// that can be cross-checked against what we asked the payer for —
	// see dbx.VerifyCallbackAmount's callers. AmountPresent distinguishes
	// "Daraja omitted Amount" from a genuine zero.
	Amount        float64
	AmountPresent bool
	PayerMsisdn   string
}

// ParseStkCallback is a pure parser — no side effects, matches
// packages/payments/src/mpesa.ts's parseStkCallback exactly.
func ParseStkCallback(body map[string]interface{}) *StkCallbackResult {
	b, ok := body["Body"].(map[string]interface{})
	if !ok {
		return nil
	}
	cb, ok := b["stkCallback"].(map[string]interface{})
	if !ok {
		return nil
	}
	checkoutRequestID, ok := cb["CheckoutRequestID"].(string)
	if !ok {
		return nil
	}

	var receipt, payer string
	var amount float64
	var amountPresent bool
	if meta, ok := cb["CallbackMetadata"].(map[string]interface{}); ok {
		if items, ok := meta["Item"].([]interface{}); ok {
			for _, it := range items {
				item, ok := it.(map[string]interface{})
				if !ok {
					continue
				}
				switch item["Name"] {
				case "MpesaReceiptNumber":
					if v, ok := item["Value"].(string); ok {
						receipt = v
					}
				case "Amount":
					// Daraja sends this as a JSON number, but sandbox has
					// been seen to quote it — accept both rather than
					// silently losing the only amount we can verify.
					switch v := item["Value"].(type) {
					case float64:
						amount, amountPresent = v, true
					case string:
						if f, err := strconv.ParseFloat(v, 64); err == nil {
							amount, amountPresent = f, true
						}
					}
				case "PhoneNumber":
					switch v := item["Value"].(type) {
					case string:
						payer = v
					case float64:
						payer = strconv.FormatFloat(v, 'f', -1, 64)
					}
				}
			}
		}
	}

	resultCode, _ := cb["ResultCode"].(float64)
	resultDesc, _ := cb["ResultDesc"].(string)

	return &StkCallbackResult{
		CheckoutRequestID: checkoutRequestID,
		Succeeded:         resultCode == 0,
		ResultDescription: resultDesc,
		MpesaReceiptCode:  receipt,
		Amount:            amount,
		AmountPresent:     amountPresent,
		PayerMsisdn:       payer,
	}
}
