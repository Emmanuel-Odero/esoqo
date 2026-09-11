package payments

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/esoko/core-go/internal/config"
)

// TransactionStatus is the Daraja Transaction Status API result for an
// M-Pesa receipt shown to a tout (external till payment, no Esoko STK).
// Console mode returns a canned NOT_FOUND so tests stay offline.
type TransactionStatus struct {
	Found       bool
	Receipt     string
	AmountKES   float64
	Phone       string
	CompletedAt *time.Time
	ResultDesc  string
}

// QueryTransactionStatus looks up a receipt via Daraja. Best-effort:
// any transport/auth failure returns Found=false, never an error, so
// verify endpoints degrade to local-ledger answers.
func QueryTransactionStatus(cfg config.Config, receipt string) TransactionStatus {
	base := ""
	switch MpesaProvider(cfg) {
	case "production":
		base = mpesaProductionBase
	case "sandbox":
		base = mpesaSandboxBase
	default:
		return TransactionStatus{Found: false, Receipt: receipt, ResultDesc: "console mode — local ledger only"}
	}
	if cfg.MpesaConsumerKey == "" || cfg.MpesaShortcode == "" || cfg.MpesaPasskey == "" {
		return TransactionStatus{Found: false, Receipt: receipt, ResultDesc: "M-Pesa not configured"}
	}
	token, err := getDarajaAccessToken(cfg, base)
	if err != nil {
		return TransactionStatus{Found: false, Receipt: receipt, ResultDesc: "auth failed"}
	}
	timestamp := darajaTimestamp()
	password := base64.StdEncoding.EncodeToString([]byte(cfg.MpesaShortcode + cfg.MpesaPasskey + timestamp))
	body, _ := json.Marshal(map[string]interface{}{
		"Initiator":          cfg.MpesaShortcode,
		"SecurityCredential": password,
		"CommandID":          "TransactionStatusQuery",
		"TransactionID":      receipt,
		"PartyA":             cfg.MpesaShortcode,
		"IdentifierType":     "4",
		"ResultURL":          cfg.MpesaCallbackURL,
		"QueueTimeOutURL":    cfg.MpesaCallbackURL,
		"Remarks":            "Esoko verify",
		"Occasion":           "verify",
	})
	req, _ := http.NewRequest("POST", base+"/mpesa/transactionstatus/v1/query", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return TransactionStatus{Found: false, Receipt: receipt, ResultDesc: "query failed"}
	}
	defer resp.Body.Close()
	var data struct {
		ResponseCode        string `json:"ResponseCode"`
		ResponseDescription string `json:"ResponseDescription"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&data)
	if data.ResponseCode != "0" {
		return TransactionStatus{Found: false, Receipt: receipt, ResultDesc: data.ResponseDescription}
	}
	// Daraja answers async on ResultURL; synchronous body only confirms
	// acceptance. Treat as pending, not found-yet.
	return TransactionStatus{Found: false, Receipt: receipt, ResultDesc: fmt.Sprintf("accepted: %s", data.ResponseDescription)}
}
