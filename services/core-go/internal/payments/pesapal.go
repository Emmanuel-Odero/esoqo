package payments

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/esoko/core-go/internal/config"
)

const (
	pesapalSandboxBase    = "https://cybqa.pesapal.com/pesapalv3"
	pesapalProductionBase = "https://pay.pesapal.com/v3"
)

func PesapalProvider(cfg config.Config) string {
	requested := cfg.PesapalProvider
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

type PesapalErrorCode string

const (
	PesapalInvalidRequest PesapalErrorCode = "INVALID_REQUEST"
	PesapalAPIError       PesapalErrorCode = "PESAPAL_ERROR"
	PesapalNotConfigured  PesapalErrorCode = "NOT_CONFIGURED"
)

type PesapalError struct {
	Message string
	Code    PesapalErrorCode
}

func (e *PesapalError) Error() string { return e.Message }

type PesapalOrderRequest struct {
	MerchantReference string
	AmountKES         float64
	Description       string
	Email             string
	Phone             string
	FirstName         string
	LastName          string
	ReturnURL         string
}

type PesapalOrderResult struct {
	OrderTrackingID   string
	MerchantReference string
	RedirectURL       string
	AutoConfirmed     bool
}

func InitiatePesapalOrder(cfg config.Config, req PesapalOrderRequest) (*PesapalOrderResult, error) {
	if strings.TrimSpace(req.MerchantReference) == "" {
		return nil, &PesapalError{"A merchant reference is required", PesapalInvalidRequest}
	}

	switch PesapalProvider(cfg) {
	case "console":
		time.Sleep(800 * time.Millisecond)
		orderTrackingID := fmt.Sprintf("console-%d-%s", time.Now().UnixMilli(), randomSuffix())
		fmt.Printf("\n  ┌─ PESAPAL ORDER (console) ──────────\n  │  %s\n  │  KES %.2f — %s\n  │  orderTrackingId: %s\n  │  auto-confirmed (never enabled in a deployed environment)\n  └─────────────────────────────────────\n\n",
			req.MerchantReference, req.AmountKES, req.Description, orderTrackingID)
		return &PesapalOrderResult{
			OrderTrackingID:   orderTrackingID,
			MerchantReference: req.MerchantReference,
			RedirectURL:       fmt.Sprintf("%s?console=1&orderTrackingId=%s", req.ReturnURL, orderTrackingID),
			AutoConfirmed:     true,
		}, nil
	case "sandbox":
		return submitPesapalOrder(cfg, req, pesapalSandboxBase)
	default: // production
		return submitPesapalOrder(cfg, req, pesapalProductionBase)
	}
}

func getPesapalAccessToken(cfg config.Config, base string) (string, error) {
	if cfg.PesapalConsumerKey == "" || cfg.PesapalConsumerSecret == "" {
		return "", &PesapalError{"PESAPAL_CONSUMER_KEY/PESAPAL_CONSUMER_SECRET are not set", PesapalNotConfigured}
	}
	body, _ := json.Marshal(map[string]string{
		"consumer_key":    cfg.PesapalConsumerKey,
		"consumer_secret": cfg.PesapalConsumerSecret,
	})
	req, _ := http.NewRequest("POST", base+"/api/Auth/RequestToken", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", &PesapalError{"Could not authenticate with Pesapal", PesapalAPIError}
	}
	defer resp.Body.Close()
	var data struct {
		Token   string `json:"token"`
		Message string `json:"message"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&data)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || data.Token == "" {
		msg := data.Message
		if msg == "" {
			msg = "Could not authenticate with Pesapal"
		}
		return "", &PesapalError{msg, PesapalAPIError}
	}
	return data.Token, nil
}

func submitPesapalOrder(cfg config.Config, req PesapalOrderRequest, base string) (*PesapalOrderResult, error) {
	if cfg.PesapalIPNID == "" {
		return nil, &PesapalError{"PESAPAL_IPN_ID is not set — register the IPN URL with Pesapal first", PesapalNotConfigured}
	}
	token, err := getPesapalAccessToken(cfg, base)
	if err != nil {
		return nil, err
	}

	desc := req.Description
	if len(desc) > 100 {
		desc = desc[:100]
	}

	body, _ := json.Marshal(map[string]interface{}{
		"id":              req.MerchantReference,
		"currency":        "KES",
		"amount":          int(req.AmountKES + 0.5),
		"description":     desc,
		"callback_url":    req.ReturnURL,
		"notification_id": cfg.PesapalIPNID,
		"billing_address": map[string]interface{}{
			"email_address": req.Email,
			"phone_number":  req.Phone,
			"first_name":    req.FirstName,
			"last_name":     req.LastName,
			"country_code":  "KE",
		},
	})

	httpReq, _ := http.NewRequest("POST", base+"/api/Transactions/SubmitOrderRequest", bytes.NewReader(body))
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, &PesapalError{"Pesapal rejected the order request", PesapalAPIError}
	}
	defer resp.Body.Close()

	var data struct {
		OrderTrackingID   string `json:"order_tracking_id"`
		MerchantReference string `json:"merchant_reference"`
		RedirectURL       string `json:"redirect_url"`
		Error             *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&data)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || data.OrderTrackingID == "" || data.RedirectURL == "" {
		msg := "Pesapal rejected the order request"
		if data.Error != nil && data.Error.Message != "" {
			msg = data.Error.Message
		}
		return nil, &PesapalError{msg, PesapalAPIError}
	}

	merchantRef := data.MerchantReference
	if merchantRef == "" {
		merchantRef = req.MerchantReference
	}
	return &PesapalOrderResult{
		OrderTrackingID:   data.OrderTrackingID,
		MerchantReference: merchantRef,
		RedirectURL:       data.RedirectURL,
		AutoConfirmed:     false,
	}, nil
}

// ── IPN handling, used by the Pesapal webhook route ───────────────────

type PesapalIPNResult struct {
	OrderTrackingID   string
	MerchantReference string
}

// ParsePesapalIpn is pure parsing only — an IPN notification carries
// just the identifiers, never the payment result itself. Accepts either
// query params or a JSON body, both lower/upper-cased key variants.
func ParsePesapalIpn(source map[string]interface{}) *PesapalIPNResult {
	orderTrackingID, _ := source["OrderTrackingId"].(string)
	if orderTrackingID == "" {
		orderTrackingID, _ = source["orderTrackingId"].(string)
	}
	if orderTrackingID == "" {
		return nil
	}
	merchantRef, _ := source["OrderMerchantReference"].(string)
	if merchantRef == "" {
		merchantRef, _ = source["orderMerchantReference"].(string)
	}
	return &PesapalIPNResult{OrderTrackingID: orderTrackingID, MerchantReference: merchantRef}
}

type PesapalConfirmResult struct {
	Succeeded         bool
	StatusDescription string
}

// ConfirmPesapalOrder is the real confirmation step — call after
// ParsePesapalIpn, never trust the IPN payload's own claims about status.
func ConfirmPesapalOrder(cfg config.Config, orderTrackingID string) (*PesapalConfirmResult, error) {
	provider := PesapalProvider(cfg)
	if provider == "console" {
		return &PesapalConfirmResult{Succeeded: true, StatusDescription: "COMPLETED (console)"}, nil
	}
	base := pesapalProductionBase
	if provider == "sandbox" {
		base = pesapalSandboxBase
	}
	token, err := getPesapalAccessToken(cfg, base)
	if err != nil {
		return nil, err
	}
	req, _ := http.NewRequest("GET", base+"/api/Transactions/GetTransactionStatus?orderTrackingId="+orderTrackingID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, &PesapalError{"Could not reach Pesapal", PesapalAPIError}
	}
	defer resp.Body.Close()
	var data struct {
		PaymentStatusDescription string `json:"payment_status_description"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&data)
	desc := data.PaymentStatusDescription
	if desc == "" {
		desc = "UNKNOWN"
	}
	return &PesapalConfirmResult{
		Succeeded:         strings.ToUpper(desc) == "COMPLETED",
		StatusDescription: desc,
	}, nil
}
