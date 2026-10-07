// coop.go — Co-operative Bank of Kenya Open API (openapi.co-opbank.co.ke).
//
// Unlike Daraja, a Co-op STK push is acknowledged with nothing but our own
// MessageReference ("REQUEST ACCEPTED FOR PROCESSING"); the outcome is read
// from the Enquiry/STK endpoint. That makes the status enquiry — an
// authenticated call WE make — the source of truth. The callback Co-op also
// posts is never trusted for its contents, only used as a nudge to run the
// enquiry (see httpapi.handleCoopCallback).
package payments

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/esoqo/core-go/internal/config"
)

const (
	// CoopRefPrefix marks a payment key as a Co-op MessageReference so the
	// status poll knows which provider a pending parcel belongs to.
	CoopRefPrefix = "ESQ"

	coopDefaultBase = "https://openapi.co-opbank.co.ke"
)

// CoopEnabled reports whether Co-op is the live STK provider. "production"
// is never honoured from a development APP_ENV, same discipline as
// MpesaProvider; an empty provider leaves the Daraja path untouched.
func CoopEnabled(cfg config.Config) bool {
	switch cfg.CoopProvider {
	case "sandbox":
		return true
	case "production", "live":
		return config.CurrentAppEnv() != config.AppEnvDevelopment
	}
	return false
}

func coopBase(cfg config.Config) string {
	if cfg.CoopBaseURL != "" {
		return strings.TrimRight(cfg.CoopBaseURL, "/")
	}
	return coopDefaultBase
}

// IsCoopRef reports whether a stored checkout id came from this client.
func IsCoopRef(id string) bool { return strings.HasPrefix(id, CoopRefPrefix) }

// ── token ────────────────────────────────────────────────────────────

var coopTok struct {
	sync.Mutex
	value   string
	expires time.Time
}

func coopToken(cfg config.Config) (string, error) {
	basic := strings.TrimSpace(cfg.CoopBasicAuth)
	basic = strings.TrimSpace(strings.TrimPrefix(basic, "Basic "))
	if basic == "" {
		return "", &MpesaError{"COOP_BASIC_AUTH is not set", MpesaNotConfigured}
	}
	coopTok.Lock()
	defer coopTok.Unlock()
	if coopTok.value != "" && time.Now().Before(coopTok.expires) {
		return coopTok.value, nil
	}
	req, _ := http.NewRequest("POST", coopBase(cfg)+"/token", strings.NewReader("grant_type=client_credentials"))
	req.Header.Set("Authorization", "Basic "+basic)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return "", &MpesaError{"Could not authenticate with Co-op", MpesaDarajaError}
	}
	defer resp.Body.Close()
	var data struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 ||
		json.NewDecoder(resp.Body).Decode(&data) != nil || data.AccessToken == "" {
		return "", &MpesaError{"Could not authenticate with Co-op", MpesaDarajaError}
	}
	ttl := time.Duration(data.ExpiresIn) * time.Second
	if ttl <= 0 {
		ttl = 55 * time.Minute
	}
	// Refresh a minute early so a token never expires mid-request.
	coopTok.value, coopTok.expires = data.AccessToken, time.Now().Add(ttl-time.Minute)
	return coopTok.value, nil
}

func coopPost(cfg config.Config, path string, payload interface{}, out interface{}) (int, error) {
	token, err := coopToken(cfg)
	if err != nil {
		return 0, err
	}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", coopBase(cfg)+path, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusUnauthorized {
		// Token revoked early: drop the cache so the next call re-auths.
		coopTok.Lock()
		coopTok.value = ""
		coopTok.Unlock()
	}
	_ = json.Unmarshal(raw, out)
	return resp.StatusCode, nil
}

// ── STK push ─────────────────────────────────────────────────────────

func newCoopRef() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 14)
	for i := range out {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		out[i] = alphabet[n.Int64()]
	}
	return CoopRefPrefix + string(out)
}

// CoopStkPush asks Co-op to put an M-Pesa prompt on req.Msisdn. The
// returned CheckoutRequestID is our own MessageReference, which is what the
// parcel row stores and what every later enquiry is keyed on.
func CoopStkPush(cfg config.Config, req StkPushRequest) (*StkPushResult, error) {
	if !mpesaMsisdnRe.MatchString(req.Msisdn) {
		return nil, &MpesaError{"That does not look like a Kenyan mobile number", MpesaInvalidMsisdn}
	}
	if cfg.CoopUserID == "" || cfg.CoopOperatorCode == "" || cfg.CoopCallbackURL == "" {
		return nil, &MpesaError{"COOP_USER_ID/COOP_OPERATOR_CODE/COOP_CALLBACK_URL are not set", MpesaNotConfigured}
	}
	var amount interface{} = req.AmountKES
	if req.AmountKES == math.Trunc(req.AmountKES) {
		amount = int64(req.AmountKES)
	}
	ref := newCoopRef()
	var out struct {
		MessageCode        string `json:"MessageCode"`
		MessageDescription string `json:"MessageDescription"`
	}
	status, err := coopPost(cfg, "/FT/stk/1.0.0", map[string]interface{}{
		"MessageReference":    ref,
		"CallBackUrl":         cfg.CoopCallbackURL,
		"UserId":              cfg.CoopUserID,
		"OperatorCode":        cfg.CoopOperatorCode,
		"TransactionCurrency": "KES",
		"MobileNumber":        req.Msisdn[1:],
		"Narration":           truncate(req.Description, 40),
		"Amount":              amount,
		"MessageDateTime":     time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		"OtherDetails":        []map[string]string{{"Name": "Reference", "Value": req.AccountReference}},
	}, &out)
	if err != nil {
		if _, ok := err.(*MpesaError); ok {
			return nil, err
		}
		return nil, &MpesaError{"Co-op unreachable", MpesaDarajaError}
	}
	if status < 200 || status >= 300 || out.MessageCode != "0" {
		msg := out.MessageDescription
		if msg == "" {
			msg = fmt.Sprintf("Co-op rejected the STK push (HTTP %d)", status)
		}
		return nil, &MpesaError{msg, MpesaDarajaError}
	}
	return &StkPushResult{
		CheckoutRequestID:   ref,
		MerchantRequestID:   ref,
		ResponseDescription: out.MessageDescription,
	}, nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ── STK status ───────────────────────────────────────────────────────

type CoopStkState string

const (
	CoopStkPending CoopStkState = "PENDING"
	CoopStkSuccess CoopStkState = "SUCCESS"
	CoopStkFailed  CoopStkState = "FAILED"
)

type CoopStkStatus struct {
	State       CoopStkState
	Description string
	AmountKES   float64
	AmountSet   bool
	Phone       string
	Receipt     string
}

// parseCoopStkStatus is pure. Observed responses: success is MessageCode "0"
// with "FULL SUCCESS" and Items Amount/PhoneNumber/Narration, where the
// Narration is "<text>~<MPESA RECEIPT>~<date>". Failures were only seen on
// the transfer endpoints ("FULL FAILURE~..."), so anything that is neither
// plainly successful nor plainly failed is left PENDING rather than
// guessed at — a parcel is never booked on an ambiguous answer.
func parseCoopStkStatus(body []byte) CoopStkStatus {
	var d struct {
		MessageCode        interface{} `json:"MessageCode"`
		MessageDescription string      `json:"MessageDescription"`
		TransactionMeta    struct {
			Items []struct {
				Name  string      `json:"Name"`
				Value interface{} `json:"Value"`
			} `json:"Items"`
		} `json:"TransactionMetadata"`
	}
	st := CoopStkStatus{State: CoopStkPending}
	if json.Unmarshal(body, &d) != nil {
		return st
	}
	st.Description = d.MessageDescription
	desc := strings.ToUpper(d.MessageDescription)
	code := strings.TrimSpace(fmt.Sprint(d.MessageCode))
	switch {
	case code == "0" && strings.Contains(desc, "FULL SUCCESS"):
		st.State = CoopStkSuccess
	case strings.Contains(desc, "FAIL") || strings.Contains(desc, "CANCEL") || strings.Contains(desc, "REJECT"):
		st.State = CoopStkFailed
	}
	for _, it := range d.TransactionMeta.Items {
		v := strings.TrimSpace(fmt.Sprint(it.Value))
		switch it.Name {
		case "Amount":
			var f float64
			if _, err := fmt.Sscanf(v, "%f", &f); err == nil {
				st.AmountKES, st.AmountSet = f, true
			}
		case "PhoneNumber":
			st.Phone = v
		case "Narration":
			if parts := strings.Split(v, "~"); len(parts) >= 2 {
				st.Receipt = strings.TrimSpace(parts[1])
			}
		}
	}
	return st
}

// CoopQueryStkStatus asks Co-op what became of a push. A transport or auth
// failure returns PENDING — the caller simply asks again on the next poll.
func CoopQueryStkStatus(cfg config.Config, ref string) CoopStkStatus {
	token, err := coopToken(cfg)
	if err != nil {
		return CoopStkStatus{State: CoopStkPending, Description: "auth failed"}
	}
	body, _ := json.Marshal(map[string]string{"MessageReference": ref, "UserId": cfg.CoopUserID})
	req, _ := http.NewRequest("POST", coopBase(cfg)+"/Enquiry/STK/1.0.0/", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return CoopStkStatus{State: CoopStkPending, Description: "enquiry failed"}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusUnauthorized {
		coopTok.Lock()
		coopTok.value = ""
		coopTok.Unlock()
	}
	return parseCoopStkStatus(raw)
}
