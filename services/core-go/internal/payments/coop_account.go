// coop_account.go — Co-op Bank account balance and statement enquiries for
// the platform's own settlement account (COOP_SOURCE_ACCOUNT). Endpoints
// and payload shapes are taken from Co-op's own "Susufo Esoqo" Postman
// collection, not guessed at — same discipline as coop_pesalink.go.
package payments

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/esoqo/core-go/internal/config"
)

// CoopAccountBalance is the parsed Enquiry/AccountBalance_v2 response for
// one account. Co-op sends every amount as a string, so these are parsed
// up front rather than left for every caller to repeat.
type CoopAccountBalance struct {
	AccountNumber    string
	AccountName      string
	Currency         string
	ProductName      string
	BranchName       string
	ClearedBalance   float64
	BookedBalance    float64
	BlockedBalance   float64
	AvailableBalance float64
}

func parseCoopAmount(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}

// parseCoopBalance is pure — same reasoning as parseCoopTransferStatus:
// testable without a live call, and the one place both the Co-op client
// and its tests agree on what the bank's response means.
func parseCoopBalance(body []byte) (*CoopAccountBalance, error) {
	var d struct {
		MessageCode        interface{} `json:"MessageCode"`
		MessageDescription string      `json:"MessageDescription"`
		AccountNumber      string      `json:"AccountNumber"`
		AccountName        string      `json:"AccountName"`
		Currency           string      `json:"Currency"`
		ProductName        string      `json:"ProductName"`
		BranchName         string      `json:"BranchName"`
		ClearedBalance     string      `json:"ClearedBalance"`
		BookedBalance      string      `json:"BookedBalance"`
		BlockedBalance     string      `json:"BlockedBalance"`
		AvailableBalance   string      `json:"AvailableBalance"`
	}
	if json.Unmarshal(body, &d) != nil {
		return nil, &MpesaError{"Co-op sent back something unreadable", MpesaDarajaError}
	}
	if strings.TrimSpace(fmt.Sprint(d.MessageCode)) != "0" {
		msg := d.MessageDescription
		if msg == "" {
			msg = "Co-op could not return the account balance"
		}
		return nil, &MpesaError{msg, MpesaDarajaError}
	}
	return &CoopAccountBalance{
		AccountNumber:    d.AccountNumber,
		AccountName:      d.AccountName,
		Currency:         d.Currency,
		ProductName:      d.ProductName,
		BranchName:       d.BranchName,
		ClearedBalance:   parseCoopAmount(d.ClearedBalance),
		BookedBalance:    parseCoopAmount(d.BookedBalance),
		BlockedBalance:   parseCoopAmount(d.BlockedBalance),
		AvailableBalance: parseCoopAmount(d.AvailableBalance),
	}, nil
}

// CoopGetAccountBalance asks Co-op for accountNumber's current balance —
// POST /Enquiry/AccountBalance_v2/2.0.0/, the "Account Balance" call in
// Co-op's own Postman collection.
func CoopGetAccountBalance(cfg config.Config, accountNumber string) (*CoopAccountBalance, error) {
	accountNumber = strings.TrimSpace(accountNumber)
	if accountNumber == "" {
		return nil, &MpesaError{"No Co-op account number configured", MpesaNotConfigured}
	}
	if cfg.CoopUserID == "" {
		return nil, &MpesaError{"COOP_USER_ID is not set", MpesaNotConfigured}
	}
	var raw rawCapture
	status, err := coopPost(cfg, "/Enquiry/AccountBalance_v2/2.0.0/", map[string]interface{}{
		"MessageReference": NewCoopPayoutRef(),
		"UserId":           cfg.CoopUserID,
		"AccountNumber":    accountNumber,
	}, &raw)
	if err != nil {
		return nil, &MpesaError{"Co-op unreachable", MpesaDarajaError}
	}
	if status < 200 || status >= 300 {
		return nil, &MpesaError{fmt.Sprintf("Co-op rejected the balance enquiry (HTTP %d)", status), MpesaDarajaError}
	}
	return parseCoopBalance(raw)
}

// CoopStatementEntry is one line of a Co-op AccountFullStatementPaginated
// response.
type CoopStatementEntry struct {
	TransactionID   string
	TransactionDate string
	Narration       string
	// TransactionType is "D" (debit) or "C" (credit) straight from Co-op.
	TransactionType string
	CreditAmount    float64
	DebitAmount     float64
	RunningBalance  float64
}

// coopStatementAmount handles Co-op's statement amounts, which — unlike
// the balance enquiry's — come back as JSON numbers, not strings.
func coopStatementAmount(v interface{}) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		return parseCoopAmount(x)
	default:
		return 0
	}
}

// CoopGetAccountStatement asks Co-op for accountNumber's transactions
// between startDate and endDate (both "YYYY-MM-DD") — POST
// /Enquiry/AccountFullStatementPaginated/1.0.0/.
func CoopGetAccountStatement(cfg config.Config, accountNumber, startDate, endDate string) (accountName string, entries []CoopStatementEntry, err error) {
	accountNumber = strings.TrimSpace(accountNumber)
	if accountNumber == "" {
		return "", nil, &MpesaError{"No Co-op account number configured", MpesaNotConfigured}
	}
	if cfg.CoopUserID == "" {
		return "", nil, &MpesaError{"COOP_USER_ID is not set", MpesaNotConfigured}
	}
	var out struct {
		MessageCode        interface{} `json:"MessageCode"`
		MessageDescription string      `json:"MessageDescription"`
		AccountName        string      `json:"AccountName"`
		Transactions       []struct {
			TransactionID   string      `json:"TransactionId"`
			TransactionDate string      `json:"TransactionDate"`
			Narration       string      `json:"Narration"`
			TransactionType string      `json:"TransactionType"`
			CreditAmount    interface{} `json:"CreditAmount"`
			DebitAmount     interface{} `json:"DebitAmount"`
			RunningBalance  interface{} `json:"RunningBalance"`
		} `json:"Transactions"`
	}
	status, err := coopPost(cfg, "/Enquiry/AccountFullStatementPaginated/1.0.0/", map[string]interface{}{
		"MessageReference": NewCoopPayoutRef(),
		"ISO2CountryCode":  "KE",
		"UserId":           cfg.CoopUserID,
		"AccountNumber":    accountNumber,
		"StartDate":        startDate,
		"EndDate":          endDate,
	}, &out)
	if err != nil {
		return "", nil, &MpesaError{"Co-op unreachable", MpesaDarajaError}
	}
	if status < 200 || status >= 300 || strings.TrimSpace(fmt.Sprint(out.MessageCode)) != "0" {
		msg := out.MessageDescription
		if msg == "" {
			msg = fmt.Sprintf("Co-op rejected the statement enquiry (HTTP %d)", status)
		}
		return "", nil, &MpesaError{msg, MpesaDarajaError}
	}
	entries = make([]CoopStatementEntry, 0, len(out.Transactions))
	for _, t := range out.Transactions {
		entries = append(entries, CoopStatementEntry{
			TransactionID:   t.TransactionID,
			TransactionDate: t.TransactionDate,
			Narration:       strings.TrimSpace(t.Narration),
			TransactionType: t.TransactionType,
			CreditAmount:    coopStatementAmount(t.CreditAmount),
			DebitAmount:     coopStatementAmount(t.DebitAmount),
			RunningBalance:  coopStatementAmount(t.RunningBalance),
		})
	}
	return out.AccountName, entries, nil
}
