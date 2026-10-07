// Package payments ports packages/payments/src/mpesa.ts and pesapal.ts —
// same provider-gating discipline (console|sandbox|production, default
// console; production never honoured from a development APP_ENV, no
// matter what the provider env var says).
package payments

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"
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

// ── B2C/B2B payouts — courier-partner settlement, dbx.createParcelOrgPayoutTx ──
//
// Ports packages/payments/src/mpesa.ts's initiateB2CPayment/
// parseB2CResultCallback, console-mode fake included, and adds B2B (no TS
// equivalent exists — this codebase's first use of it). Daraja accepts
// or refuses the request synchronously (a ConversationID to track); the
// actual paid/failed outcome arrives later on ResultURL, same
// asynchronous shape as the STK callback but on its own pair of URLs and
// its own payload shape.

type B2CPaymentRequest struct {
	Msisdn    string // E.164, e.g. +254712345678
	AmountKES float64
	// Daraja's own CommandID enum. BusinessPayment is the correct one for
	// a payout to someone else; SalaryPayment/PromotionPayment exist for
	// payroll/promo use cases this codebase does not have.
	CommandID string
	Remarks   string
	Occasion  string
}

type B2CPaymentResult struct {
	ConversationID           string
	OriginatorConversationID string
	ResponseDescription      string
	// True when this call already settled the payout (console mode only).
	AutoConfirmed      bool
	MpesaTransactionID string
}

func InitiateB2CPayment(cfg config.Config, req B2CPaymentRequest) (*B2CPaymentResult, error) {
	if !mpesaMsisdnRe.MatchString(req.Msisdn) {
		return nil, &MpesaError{"That does not look like a Kenyan mobile number", MpesaInvalidMsisdn}
	}
	if req.CommandID == "" {
		req.CommandID = "BusinessPayment"
	}

	switch MpesaProvider(cfg) {
	case "console":
		time.Sleep(800 * time.Millisecond)
		conversationID := fmt.Sprintf("console-b2c-%d-%s", time.Now().UnixMilli(), randomSuffix())
		transactionID := "CNSB2C" + strings.ToUpper(randomSuffix())
		fmt.Printf("\n  ┌─ M-PESA B2C PAYOUT (console) ───────\n  │  %s\n  │  KES %.2f — %s\n  │  conversationId: %s\n  │  auto-confirmed with transaction id %s\n  └─────────────────────────────────────\n\n",
			req.Msisdn, req.AmountKES, req.Remarks, conversationID, transactionID)
		return &B2CPaymentResult{
			ConversationID:           conversationID,
			OriginatorConversationID: conversationID,
			ResponseDescription:      "Accepted (console — never enabled in a deployed environment)",
			AutoConfirmed:            true,
			MpesaTransactionID:       transactionID,
		}, nil
	case "sandbox":
		return initiateDarajaB2CPayment(cfg, req, mpesaSandboxBase)
	default: // production
		return initiateDarajaB2CPayment(cfg, req, mpesaProductionBase)
	}
}

// buildSecurityCredential mirrors packages/payments/src/b2c-credential.ts:
// the initiator password, RSA-encrypted (PKCS1 v1.5) against Safaricom's
// published certificate for the target environment, base64-encoded. This
// is NOT the STK push Password (shortcode+passkey+timestamp) — B2C/B2B
// authenticate the *initiator* (a named individual authorised to move
// money out), not the paybill.
func buildSecurityCredential(initiatorPassword, certPEM string) (string, error) {
	block, _ := pem.Decode([]byte(certPEM))
	if block == nil {
		return "", &MpesaError{"MPESA_B2C_CERT is not valid PEM", MpesaNotConfigured}
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", &MpesaError{"MPESA_B2C_CERT could not be parsed as a certificate", MpesaNotConfigured}
	}
	pub, ok := cert.PublicKey.(*rsa.PublicKey)
	if !ok {
		return "", &MpesaError{"MPESA_B2C_CERT's public key is not RSA", MpesaNotConfigured}
	}
	encrypted, err := rsa.EncryptPKCS1v15(rand.Reader, pub, []byte(initiatorPassword))
	if err != nil {
		return "", &MpesaError{"Could not build the B2C security credential", MpesaNotConfigured}
	}
	return base64.StdEncoding.EncodeToString(encrypted), nil
}

func initiateDarajaB2CPayment(cfg config.Config, req B2CPaymentRequest, base string) (*B2CPaymentResult, error) {
	if cfg.MpesaB2CShortcode == "" || cfg.MpesaInitiatorName == "" || cfg.MpesaInitiatorPassword == "" ||
		cfg.MpesaB2CCert == "" || cfg.MpesaB2CResultURL == "" || cfg.MpesaB2CTimeoutURL == "" {
		return nil, &MpesaError{"MPESA_B2C_SHORTCODE/MPESA_INITIATOR_NAME/MPESA_INITIATOR_PASSWORD/MPESA_B2C_CERT/MPESA_B2C_RESULT_URL/MPESA_B2C_TIMEOUT_URL are not set", MpesaNotConfigured}
	}
	token, err := getDarajaAccessToken(cfg, base)
	if err != nil {
		return nil, err
	}
	securityCredential, err := buildSecurityCredential(cfg.MpesaInitiatorPassword, cfg.MpesaB2CCert)
	if err != nil {
		return nil, err
	}
	msisdnLocal := req.Msisdn[1:] // strip leading '+'

	remarks := req.Remarks
	if len(remarks) > 100 {
		remarks = remarks[:100]
	}
	occasion := req.Occasion
	if len(occasion) > 100 {
		occasion = occasion[:100]
	}

	body, _ := json.Marshal(map[string]interface{}{
		"InitiatorName":      cfg.MpesaInitiatorName,
		"SecurityCredential": securityCredential,
		"CommandID":          req.CommandID,
		"Amount":             int(req.AmountKES + 0.5),
		"PartyA":             cfg.MpesaB2CShortcode,
		"PartyB":             msisdnLocal,
		"Remarks":            remarks,
		"QueueTimeOutURL":    cfg.MpesaB2CTimeoutURL,
		"ResultURL":          cfg.MpesaB2CResultURL,
		"Occasion":           occasion,
	})

	httpReq, _ := http.NewRequest("POST", base+"/mpesa/b2c/v1/paymentrequest", bytes.NewReader(body))
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, &MpesaError{"Daraja rejected the B2C payout request", MpesaDarajaError}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	var data struct {
		ConversationID           string `json:"ConversationID"`
		OriginatorConversationID string `json:"OriginatorConversationID"`
		ResponseDescription      string `json:"ResponseDescription"`
	}
	_ = json.Unmarshal(respBody, &data)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || data.ConversationID == "" {
		msg := data.ResponseDescription
		if msg == "" {
			msg = "Daraja rejected the B2C payout request"
		}
		return nil, &MpesaError{msg, MpesaDarajaError}
	}

	originatorID := data.OriginatorConversationID
	if originatorID == "" {
		originatorID = data.ConversationID
	}
	desc := data.ResponseDescription
	if desc == "" {
		desc = "Accepted"
	}
	return &B2CPaymentResult{
		ConversationID:           data.ConversationID,
		OriginatorConversationID: originatorID,
		ResponseDescription:      desc,
		AutoConfirmed:            false,
	}, nil
}

// B2CResultCallback mirrors Daraja's B2C result payload — shaped nothing
// like the STK callback. The parameters that matter come out of
// Result.ResultParameters.ResultParameter, a name/value array rather than
// STK's CallbackMetadata.Item.
type B2CResultCallback struct {
	ConversationID     string
	Succeeded          bool
	ResultDescription  string
	MpesaTransactionID string
	AmountKES          float64
	AmountPresent      bool
}

// ParseB2CResultCallback is a pure parser, matching
// packages/payments/src/mpesa.ts's parseB2CResultCallback exactly.
func ParseB2CResultCallback(body map[string]interface{}) *B2CResultCallback {
	return parseDarajaResultCallback(body)
}

// parseDarajaResultCallback is shared by B2C and B2B — Daraja uses the
// identical Result.ResultParameters shape for both.
func parseDarajaResultCallback(body map[string]interface{}) *B2CResultCallback {
	result, ok := body["Result"].(map[string]interface{})
	if !ok {
		return nil
	}
	conversationID, ok := result["ConversationID"].(string)
	if !ok {
		return nil
	}

	params, _ := result["ResultParameters"].(map[string]interface{})
	var items []interface{}
	if params != nil {
		items, _ = params["ResultParameter"].([]interface{})
	}
	paramValue := func(key string) (string, bool) {
		for _, it := range items {
			item, ok := it.(map[string]interface{})
			if !ok {
				continue
			}
			if item["Key"] != key {
				continue
			}
			switch v := item["Value"].(type) {
			case string:
				return v, true
			case float64:
				return strconv.FormatFloat(v, 'f', -1, 64), true
			}
		}
		return "", false
	}

	resultCode, _ := result["ResultCode"].(float64)
	resultDesc, _ := result["ResultDesc"].(string)
	txID, _ := paramValue("TransactionReceipt")
	amountStr, amountOk := paramValue("TransactionAmount")
	var amount float64
	var amountPresent bool
	if amountOk {
		if f, err := strconv.ParseFloat(amountStr, 64); err == nil {
			amount, amountPresent = f, true
		}
	}

	return &B2CResultCallback{
		ConversationID:     conversationID,
		Succeeded:          resultCode == 0,
		ResultDescription:  resultDesc,
		MpesaTransactionID: txID,
		AmountKES:          amount,
		AmountPresent:      amountPresent,
	}
}

// ── B2B payouts — till (BuyGoods) and paybill (PayBill) destinations ───
//
// No TS equivalent exists yet; this is this codebase's first B2B
// integration. Same initiator credentials as B2C, different command and
// receiver-identifier type, different endpoint.

type B2BPaymentRequest struct {
	// "BusinessBuyGoods" (till) or "BusinessPayBill" (paybill).
	CommandID string
	// Till number or paybill (business) shortcode.
	PartyB string
	// Paybill account reference — ignored for BusinessBuyGoods.
	AccountReference string
	AmountKES        float64
	Remarks          string
}

type B2BPaymentResult struct {
	ConversationID           string
	OriginatorConversationID string
	ResponseDescription      string
	AutoConfirmed            bool
	MpesaTransactionID       string
}

func InitiateB2BPayment(cfg config.Config, req B2BPaymentRequest) (*B2BPaymentResult, error) {
	if req.PartyB == "" {
		return nil, &MpesaError{"A till or paybill number is required", MpesaInvalidMsisdn}
	}

	switch MpesaProvider(cfg) {
	case "console":
		time.Sleep(800 * time.Millisecond)
		conversationID := fmt.Sprintf("console-b2b-%d-%s", time.Now().UnixMilli(), randomSuffix())
		transactionID := "CNSB2B" + strings.ToUpper(randomSuffix())
		fmt.Printf("\n  ┌─ M-PESA B2B PAYOUT (console) ───────\n  │  %s %s\n  │  KES %.2f — %s\n  │  conversationId: %s\n  │  auto-confirmed with transaction id %s\n  └─────────────────────────────────────\n\n",
			req.CommandID, req.PartyB, req.AmountKES, req.Remarks, conversationID, transactionID)
		return &B2BPaymentResult{
			ConversationID:           conversationID,
			OriginatorConversationID: conversationID,
			ResponseDescription:      "Accepted (console — never enabled in a deployed environment)",
			AutoConfirmed:            true,
			MpesaTransactionID:       transactionID,
		}, nil
	case "sandbox":
		return initiateDarajaB2BPayment(cfg, req, mpesaSandboxBase)
	default: // production
		return initiateDarajaB2BPayment(cfg, req, mpesaProductionBase)
	}
}

func initiateDarajaB2BPayment(cfg config.Config, req B2BPaymentRequest, base string) (*B2BPaymentResult, error) {
	if cfg.MpesaB2CShortcode == "" || cfg.MpesaInitiatorName == "" || cfg.MpesaInitiatorPassword == "" ||
		cfg.MpesaB2CCert == "" || cfg.MpesaB2BResultURL == "" || cfg.MpesaB2BTimeoutURL == "" {
		return nil, &MpesaError{"MPESA_B2C_SHORTCODE/MPESA_INITIATOR_NAME/MPESA_INITIATOR_PASSWORD/MPESA_B2C_CERT/MPESA_B2B_RESULT_URL/MPESA_B2B_TIMEOUT_URL are not set", MpesaNotConfigured}
	}
	token, err := getDarajaAccessToken(cfg, base)
	if err != nil {
		return nil, err
	}
	securityCredential, err := buildSecurityCredential(cfg.MpesaInitiatorPassword, cfg.MpesaB2CCert)
	if err != nil {
		return nil, err
	}

	remarks := req.Remarks
	if len(remarks) > 100 {
		remarks = remarks[:100]
	}

	// RecieverIdentifierType (Daraja's own spelling): 4 = till/shortcode
	// for BusinessBuyGoods, also 4 for BusinessPayBill's PartyB shortcode.
	body, _ := json.Marshal(map[string]interface{}{
		"Initiator":              cfg.MpesaInitiatorName,
		"SecurityCredential":     securityCredential,
		"CommandID":              req.CommandID,
		"SenderIdentifierType":   "4",
		"RecieverIdentifierType": "4",
		"Amount":                 int(req.AmountKES + 0.5),
		"PartyA":                 cfg.MpesaB2CShortcode,
		"PartyB":                 req.PartyB,
		"AccountReference":       req.AccountReference,
		"Requester":              "",
		"Remarks":                remarks,
		"QueueTimeOutURL":        cfg.MpesaB2BTimeoutURL,
		"ResultURL":              cfg.MpesaB2BResultURL,
	})

	httpReq, _ := http.NewRequest("POST", base+"/mpesa/b2b/v1/paymentrequest", bytes.NewReader(body))
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, &MpesaError{"Daraja rejected the B2B payout request", MpesaDarajaError}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	var data struct {
		ConversationID           string `json:"ConversationID"`
		OriginatorConversationID string `json:"OriginatorConversationID"`
		ResponseDescription      string `json:"ResponseDescription"`
	}
	_ = json.Unmarshal(respBody, &data)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || data.ConversationID == "" {
		msg := data.ResponseDescription
		if msg == "" {
			msg = "Daraja rejected the B2B payout request"
		}
		return nil, &MpesaError{msg, MpesaDarajaError}
	}

	originatorID := data.OriginatorConversationID
	if originatorID == "" {
		originatorID = data.ConversationID
	}
	desc := data.ResponseDescription
	if desc == "" {
		desc = "Accepted"
	}
	return &B2BPaymentResult{
		ConversationID:           data.ConversationID,
		OriginatorConversationID: originatorID,
		ResponseDescription:      desc,
		AutoConfirmed:            false,
	}, nil
}

// ParseB2BResultCallback reuses the B2C result shape — Daraja's B2B
// result callback is structurally identical (Result.ResultParameters).
func ParseB2BResultCallback(body map[string]interface{}) *B2CResultCallback {
	return parseDarajaResultCallback(body)
}
