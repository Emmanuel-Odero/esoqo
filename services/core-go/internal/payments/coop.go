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
	"net"
	"net/http"
	"net/url"
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

// coopCallbackURLOK: Co-op's WAF silently rejects a push whose CallBackUrl
// is plain http or a local address (seen live: http://localhost:… returns
// an HTML "Request Rejected" page), so catch it before calling the bank.
func coopCallbackURLOK(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".localhost") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified()) {
		return false
	}
	return true
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
	if !coopCallbackURLOK(cfg.CoopCallbackURL) {
		return nil, &MpesaError{"COOP_CALLBACK_URL must be a public https URL — Co-op's gateway rejects anything else", MpesaNotConfigured}
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
			// No JSON at all: the bank's WAF answered with an HTML
			// "Request Rejected" page (HTTP 200), not the API.
			msg = fmt.Sprintf("Co-op gateway rejected the STK push (HTTP %d, no API response)", status)
		}
		return nil, &MpesaError{msg, MpesaDarajaError}
	}
	return &StkPushResult{
		CheckoutRequestID:   ref,
		MerchantRequestID:   ref,
		ResponseDescription: out.MessageDescription,
	}, nil
}

// ParcelStkPush is the one STK entry point for parcel payments, online
// bookings and counter settlements alike: Co-op when it is the live
// provider, Daraja otherwise.
func ParcelStkPush(cfg config.Config, req StkPushRequest) (*StkPushResult, error) {
	if CoopEnabled(cfg) {
		return CoopStkPush(cfg, req)
	}
	return InitiateStkPush(cfg, req)
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
		MessageCode         interface{} `json:"MessageCode"`
		MessageDescription  string      `json:"MessageDescription"`
		MessageDetails      string      `json:"MessageDetails"`
		ResponseCode        interface{} `json:"ResponseCode"`
		ResponseDescription string      `json:"ResponseDescription"`
		TransactionMeta     struct {
			Items []struct {
				Name  string      `json:"Name"`
				Value interface{} `json:"Value"`
			} `json:"Items"`
		} `json:"TransactionMetadata"`
		Destinations []struct {
			TransactionID         string `json:"TransactionID"`
			ExternalTransactionID string `json:"ExternalTransactionID"`
		} `json:"Destinations"`
	}
	st := CoopStkStatus{State: CoopStkPending}
	if json.Unmarshal(body, &d) != nil {
		return st
	}
	st.Description = d.MessageDescription
	if st.Description == "" {
		st.Description = d.MessageDetails
	}
	if st.Description == "" {
		st.Description = d.ResponseDescription
	}
	desc := strings.ToUpper(d.MessageDescription)
	details := strings.ToUpper(d.MessageDetails)
	respDesc := strings.ToUpper(d.ResponseDescription)
	code := strings.TrimSpace(fmt.Sprint(d.MessageCode))
	respCode := strings.TrimSpace(fmt.Sprint(d.ResponseCode))

	// While an STK push is still in flight or awaiting the customer's PIN on their phone,
	// Co-op's /Enquiry/STK/1.0.0/ endpoint returns MessageCode "-13" ("Message Reference does not exist")
	// or "REQUEST ACCEPTED FOR PROCESSING" or "PROCESSING". These are NOT failures — the customer
	// is actively holding the prompt on their screen.
	isPendingText := code == "-13" || code == "-1" ||
		strings.Contains(desc, "DOES NOT EXIST") || strings.Contains(desc, "NOT FOUND") ||
		strings.Contains(desc, "REQUEST ACCEPTED") || strings.Contains(desc, "PROCESSING") ||
		strings.Contains(desc, "PENDING") || strings.Contains(desc, "WAITING") ||
		strings.Contains(details, "DOES NOT EXIST") || strings.Contains(details, "NOT FOUND") ||
		strings.Contains(details, "REQUEST ACCEPTED") || strings.Contains(details, "PROCESSING") ||
		strings.Contains(details, "PENDING") || strings.Contains(details, "WAITING")

	isSuccessCode := code == "0" || respCode == "0"
	isSuccessText := strings.Contains(desc, "FULL SUCCESS") || strings.Contains(desc, "SUCCESS") ||
		strings.Contains(details, "SUCCESS") || strings.Contains(details, "PROCESSED SUCCESSFULLY") ||
		strings.Contains(respDesc, "SUCCESS") || strings.Contains(respDesc, "PROCESSED SUCCESSFULLY")

	// Genuine failure only when explicitly reported by provider (user cancelled, timeout, insufficient funds)
	isFailedText := !isPendingText && (strings.Contains(desc, "FULL FAILURE") ||
		strings.Contains(desc, "FAIL") ||
		strings.Contains(desc, "CANCEL") ||
		strings.Contains(desc, "REJECT") ||
		strings.Contains(desc, "DECLIN") ||
		strings.Contains(desc, "EXPIRED") ||
		strings.Contains(desc, "TIMEOUT") ||
		strings.Contains(desc, "INSUFFICIENT") ||
		strings.Contains(desc, "WRONG PIN") ||
		strings.Contains(details, "FULL FAILURE") ||
		strings.Contains(details, "FAIL") ||
		strings.Contains(details, "CANCEL") ||
		strings.Contains(details, "REJECT") ||
		strings.Contains(details, "DECLIN") ||
		strings.Contains(details, "EXPIRED") ||
		strings.Contains(details, "TIMEOUT") ||
		strings.Contains(respDesc, "FULL FAILURE") ||
		strings.Contains(respDesc, "FAIL") ||
		strings.Contains(respDesc, "CANCEL") ||
		strings.Contains(respDesc, "REJECT") ||
		strings.Contains(respDesc, "DECLIN"))

	isFailedCode := respCode == "1032" || respCode == "1037" || respCode == "1025"

	switch {
	case isSuccessCode && isSuccessText && !isFailedText:
		st.State = CoopStkSuccess
	case isFailedText || isFailedCode:
		st.State = CoopStkFailed
	default:
		// When pending or reference not yet indexed, keep state PENDING
		st.State = CoopStkPending
		if isPendingText || st.Description == "" {
			st.Description = "Awaiting customer approval on phone"
		}
	}

	for _, it := range d.TransactionMeta.Items {
		v := strings.TrimSpace(fmt.Sprint(it.Value))
		switch it.Name {
		case "Amount":
			var f float64
			vClean := strings.ReplaceAll(v, ",", "")
			if _, err := fmt.Sscanf(vClean, "%f", &f); err == nil {
				st.AmountKES, st.AmountSet = f, true
			}
		case "PhoneNumber":
			st.Phone = v
		case "Narration":
			// "<text>~<receipt>~<date>" once paid; while PROCESSING it is
			// "<text>~<date>", which has no receipt to take.
			if parts := strings.Split(v, "~"); len(parts) >= 3 {
				st.Receipt = strings.TrimSpace(parts[1])
			} else if len(parts) == 2 {
				// Alternative narration format "<receipt>~<date>" or "<text>~<receipt>"
				p0 := strings.TrimSpace(parts[0])
				p1 := strings.TrimSpace(parts[1])
				if len(p0) >= 8 && len(p0) <= 12 && !strings.Contains(p0, " ") {
					st.Receipt = p0
				} else if len(p1) >= 8 && len(p1) <= 12 && !strings.Contains(p1, " ") && !strings.Contains(p1, "-") {
					st.Receipt = p1
				}
			}
		case "Receipt", "MpesaReceiptCode", "TransactionID":
			if st.Receipt == "" && v != "" && v != "NULL" {
				st.Receipt = v
			}
		}
	}
	if st.Receipt == "" {
		for _, dst := range d.Destinations {
			if dst.ExternalTransactionID != "" && dst.ExternalTransactionID != "NULL" {
				st.Receipt = dst.ExternalTransactionID
				break
			}
			if dst.TransactionID != "" && dst.TransactionID != "NULL" {
				st.Receipt = dst.TransactionID
				break
			}
		}
	}
	return st
}

// CoopQueryStkStatus asks Co-op what became of a push. A transport or auth
// failure returns PENDING — the caller simply asks again on the next poll.
func CoopQueryStkStatus(cfg config.Config, ref string) CoopStkStatus {
	if cfg.CoopUserID == "" {
		return CoopStkStatus{State: CoopStkPending, Description: "Co-op UserId not configured"}
	}
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
	if resp.StatusCode != http.StatusOK {
		return CoopStkStatus{State: CoopStkPending, Description: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}
	st := parseCoopStkStatus(raw)
	return st
}
