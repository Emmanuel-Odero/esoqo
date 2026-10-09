// coop_b2c.go — Co-op Bank M-Pesa B2C (account → mobile wallet) and the
// transfer status enquiry used to learn how a payout actually ended.
package payments

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"

	"github.com/esoqo/core-go/internal/config"
)

// CoopPayoutRefPrefix distinguishes courier-payout references from STK ones.
const CoopPayoutRefPrefix = "CPO"

func IsCoopPayoutRef(id string) bool { return strings.HasPrefix(id, CoopPayoutRefPrefix) }

// NewCoopPayoutRef is "CPO" + 14 lowercase alphanumerics, the same length and
// alphabet as the STK references that already work against the bank.
func NewCoopPayoutRef() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 14)
	for i := range out {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		out[i] = alphabet[n.Int64()]
	}
	return CoopPayoutRefPrefix + string(out)
}

type CoopSendOutcome int

const (
	// CoopSendAccepted — the bank took the request; the final result comes
	// from the status enquiry.
	CoopSendAccepted CoopSendOutcome = iota
	// CoopSendRejected — a definitive "no": nothing was or will be sent.
	CoopSendRejected
	// CoopSendUnknown — we cannot tell whether the bank received it
	// (timeout, 5xx). The payout must stay PENDING and be resolved by
	// enquiry, never retried blind — a retry could pay twice.
	CoopSendUnknown
)

// CoopB2CSend pays amountKES (whole shillings) to an M-Pesa wallet.
// msisdn is E.164 (+2547…).
func CoopB2CSend(cfg config.Config, ref, msisdn string, amountKES int64, narration string) (CoopSendOutcome, string) {
	if !mpesaMsisdnRe.MatchString(msisdn) {
		return CoopSendRejected, "invalid mobile number"
	}
	if cfg.CoopSourceAccount == "" {
		return CoopSendRejected, "COOP_SOURCE_ACCOUNT not set"
	}
	if _, err := coopToken(cfg); err != nil {
		return CoopSendRejected, "could not authenticate with Co-op" // nothing sent yet
	}
	narration = truncate(narration, 40)
	var out struct {
		MessageCode        interface{} `json:"MessageCode"`
		MessageDescription string      `json:"MessageDescription"`
	}
	status, err := coopPost(cfg, "/FundsTransfer/External/A2M/Mpesa_v2/2.0.0", map[string]interface{}{
		"MessageReference": ref,
		"ISO2CountryCode":  "KE",
		"CallBackUrl":      cfg.CoopCallbackURL,
		// Required by Co-op's own M-Pesa B2C (Account-to-Mobile) product
		// for this endpoint — not a Safaricom Daraja CommandID, which is
		// why it doesn't match InitiateB2CPayment's BusinessPayment/etc.
		"CommandId": "SUSUFO",
		"Source": map[string]interface{}{
			"AccountNumber":       cfg.CoopSourceAccount,
			"Amount":              fmt.Sprint(amountKES),
			"TransactionCurrency": "KES",
			"Narration":           narration,
		},
		"Destinations": []map[string]interface{}{{
			"ReferenceNumber": ref + "_1",
			"MobileNumber":    msisdn[1:],
			"Amount":          fmt.Sprint(amountKES),
			"Narration":       narration,
		}},
	}, &out)
	if err != nil || status >= 500 || status == 0 {
		return CoopSendUnknown, "no answer from Co-op"
	}
	if status >= 200 && status < 300 && strings.TrimSpace(fmt.Sprint(out.MessageCode)) == "0" {
		return CoopSendAccepted, out.MessageDescription
	}
	desc := out.MessageDescription
	if desc == "" {
		desc = fmt.Sprintf("Co-op rejected the transfer (HTTP %d)", status)
	}
	return CoopSendRejected, desc
}

type CoopTransferState string

const (
	CoopTransferPending CoopTransferState = "PENDING"
	CoopTransferSuccess CoopTransferState = "SUCCESS"
	CoopTransferFailed  CoopTransferState = "FAILED"
)

type CoopTransferStatus struct {
	State       CoopTransferState
	Description string
	// Receipt is the M-Pesa transaction id (Destinations[].ExternalTransactionID),
	// falling back to the bank's own TransactionID.
	Receipt string
}

// parseCoopTransferStatus is pure. Observed: MessageCode "0" with
// "FULL SUCCESS" is done, "FULL FAILURE~…" (code "2") is failed. Anything
// else is PENDING — a payout is never declared failed (which would make the
// earnings payable again) or successful on an answer we can't read.
func parseCoopTransferStatus(body []byte) CoopTransferStatus {
	var d struct {
		MessageCode        interface{} `json:"MessageCode"`
		MessageDescription string      `json:"MessageDescription"`
		Destinations       []struct {
			TransactionID         string `json:"TransactionID"`
			ExternalTransactionID string `json:"ExternalTransactionID"`
		} `json:"Destinations"`
	}
	st := CoopTransferStatus{State: CoopTransferPending}
	if json.Unmarshal(body, &d) != nil {
		return st
	}
	st.Description = d.MessageDescription
	desc := strings.ToUpper(d.MessageDescription)
	code := strings.TrimSpace(fmt.Sprint(d.MessageCode))
	switch {
	case code == "0" && strings.Contains(desc, "FULL SUCCESS"):
		st.State = CoopTransferSuccess
	case strings.Contains(desc, "FULL FAILURE"):
		st.State = CoopTransferFailed
	}
	if len(d.Destinations) > 0 {
		st.Receipt = d.Destinations[0].ExternalTransactionID
		if st.Receipt == "" || st.Receipt == "NULL" {
			st.Receipt = d.Destinations[0].TransactionID
		}
		if st.Receipt == "NULL" {
			st.Receipt = ""
		}
	}
	return st
}

// CoopQueryTransferStatus asks the bank how a funds transfer ended.
// Transport/auth trouble reads as PENDING — ask again next tick.
func CoopQueryTransferStatus(cfg config.Config, ref string) CoopTransferStatus {
	var raw rawCapture
	status, err := coopPost(cfg, "/Enquiry/TransactionStatus_V3/3.0.0/",
		map[string]string{"MessageReference": ref, "UserId": cfg.CoopUserID}, &raw)
	if err != nil || status != http.StatusOK {
		return CoopTransferStatus{State: CoopTransferPending, Description: "enquiry failed"}
	}
	return parseCoopTransferStatus(raw)
}

// rawCapture lets coopPost's json.Unmarshal hand back the untouched body.
type rawCapture []byte

func (r *rawCapture) UnmarshalJSON(b []byte) error { *r = append((*r)[:0], b...); return nil }
