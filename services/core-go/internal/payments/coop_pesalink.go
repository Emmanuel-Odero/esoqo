// coop_pesalink.go — Co-op Bank's PesaLink (A2A, inter-bank) rail: checking
// who holds an account at another bank before anyone is paid to it, and the
// transfer itself. Endpoints and payload shapes are taken from Co-op's own
// "Susufo Esoqo" Postman collection, not guessed at — same discipline as
// coop.go's STK push.
package payments

import (
	"fmt"
	"strings"

	"github.com/esoqo/core-go/internal/config"
)

// CoopBankIdentifier is Co-operative Bank of Kenya's own PesaLink/IPSL
// identifier — see banks.go's KenyanBanks list. A destination account at
// this bank is Co-op's own book, so it is moved as an internal
// account-to-account transfer (IFT) rather than routed out over PesaLink:
// cheaper, faster, and the rail Co-op's own Postman collection uses for a
// same-bank destination.
const CoopBankIdentifier = "0011"

// CoopBankTransferSend pays amountKES to accountNumber at bankCode,
// choosing the right Co-op rail for the destination: an internal transfer
// when bankCode is Co-op itself, PesaLink otherwise. This is the one entry
// point dispatchParcelOrgPayout's "BANK" case calls — callers never need to
// know which underlying endpoint a bank code resolves to.
func CoopBankTransferSend(cfg config.Config, ref, bankCode, accountNumber string, amountKES int64, narration string) (CoopSendOutcome, string) {
	if strings.TrimSpace(bankCode) == CoopBankIdentifier {
		return CoopInternalTransferSend(cfg, ref, accountNumber, amountKES, narration)
	}
	return CoopPesaLinkSend(cfg, ref, bankCode, accountNumber, amountKES, narration)
}

// CoopValidatePesaLinkAccount asks the PesaLink/IPSL switch (via Co-op) who
// holds accountNumber at the bank identified by bankCode — the check run
// before a courier company's bank settlement account is ever saved or paid
// out to. ok is false for anything short of Co-op's "Valid Account Number"
// answer, including a transport failure: a name is never guessed at.
func CoopValidatePesaLinkAccount(cfg config.Config, bankCode, accountNumber string) (accountName string, ok bool, err error) {
	bankCode = strings.TrimSpace(bankCode)
	accountNumber = strings.TrimSpace(accountNumber)
	if bankCode == "" || accountNumber == "" {
		return "", false, &MpesaError{"Pick a bank and enter the account number", MpesaInvalidMsisdn}
	}
	if cfg.CoopUserID == "" {
		return "", false, &MpesaError{"COOP_USER_ID is not set", MpesaNotConfigured}
	}
	var out struct {
		MessageCode        interface{} `json:"MessageCode"`
		MessageDescription string      `json:"MessageDescription"`
		RecipientName      string      `json:"RecipientName"`
	}
	status, err := coopPost(cfg, "/Enquiry/Validation/IPSL/1.0.0/", map[string]interface{}{
		"UserId":                  cfg.CoopUserID,
		"MessageReference":        NewCoopPayoutRef(),
		"AccountNumber":           accountNumber,
		"RecipientBankIdentifier": bankCode,
	}, &out)
	if err != nil {
		return "", false, &MpesaError{"Co-op unreachable", MpesaDarajaError}
	}
	if status < 200 || status >= 300 || strings.TrimSpace(fmt.Sprint(out.MessageCode)) != "0" {
		msg := out.MessageDescription
		if msg == "" {
			msg = fmt.Sprintf("Co-op could not validate that account (HTTP %d)", status)
		}
		return "", false, &MpesaError{msg, MpesaDarajaError}
	}
	return strings.TrimSpace(out.RecipientName), true, nil
}

// CoopPesaLinkSend pays amountKES (whole shillings) via PesaLink to
// accountNumber at bankCode — a KenyanBanks identifier (e.g. "0001"),
// converted to the short form the transfer call itself expects by
// PesaLinkTransferBankCode before it's ever sent. Mirrors CoopB2CSend's
// accepted/rejected/unknown contract: a PesaLink transfer is ack'd with
// nothing but "REQUEST ACCEPTED FOR PROCESSING", so the real outcome is
// only ever learned from CoopQueryTransferStatus (same
// /Enquiry/TransactionStatus_V3/3.0.0/ used for the M-Pesa B2C rail — the
// response shape is shared across transfer types).
func CoopPesaLinkSend(cfg config.Config, ref, bankCode, accountNumber string, amountKES int64, narration string) (CoopSendOutcome, string) {
	bankCode = strings.TrimSpace(bankCode)
	accountNumber = strings.TrimSpace(accountNumber)
	if bankCode == "" || accountNumber == "" {
		return CoopSendRejected, "missing bank code or account number"
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
	status, err := coopPost(cfg, "/FundsTransfer/External/A2A/PesaLink_v2/2.0.0/", map[string]interface{}{
		"MessageReference": ref,
		"CallBackUrl":      cfg.CoopCallbackURL,
		"ISO2CountryCode":  "KE",
		"Source": map[string]interface{}{
			"UserId":              cfg.CoopUserID,
			"AccountNumber":       cfg.CoopSourceAccount,
			"Amount":              fmt.Sprint(amountKES),
			"TransactionCurrency": "KES",
			"Narration":           narration,
		},
		"Destinations": []map[string]interface{}{{
			"ReferenceNumber":     ref + "_1",
			"AccountNumber":       accountNumber,
			"BankCode":            PesaLinkTransferBankCode(bankCode),
			"Amount":              fmt.Sprint(amountKES),
			"TransactionCurrency": "KES",
			"Narration":           narration,
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
		desc = fmt.Sprintf("Co-op rejected the PesaLink transfer (HTTP %d)", status)
	}
	return CoopSendRejected, desc
}

// CoopInternalTransferSend pays amountKES (whole shillings) to
// accountNumber, another Co-op account — the "IFT to Account" call in
// Co-op's Postman collection, POST /FundsTransfer/Internal/A2A_v3/3.0.0.
// No BankCode on the destination: an internal transfer is addressed by
// account number alone. Same accepted/rejected/unknown contract as
// CoopPesaLinkSend, and the same /Enquiry/TransactionStatus_V3/3.0.0/
// enquiry resolves the outcome.
func CoopInternalTransferSend(cfg config.Config, ref, accountNumber string, amountKES int64, narration string) (CoopSendOutcome, string) {
	accountNumber = strings.TrimSpace(accountNumber)
	if accountNumber == "" {
		return CoopSendRejected, "missing account number"
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
	status, err := coopPost(cfg, "/FundsTransfer/Internal/A2A_v3/3.0.0", map[string]interface{}{
		"MessageReference": ref,
		"ISO2CountryCode":  "KE",
		"CallBackUrl":      cfg.CoopCallbackURL,
		"Source": map[string]interface{}{
			"UserId":              cfg.CoopUserID,
			"AccountNumber":       cfg.CoopSourceAccount,
			"Amount":              amountKES,
			"TransactionCurrency": "KES",
			"Narration":           narration,
		},
		"Destinations": []map[string]interface{}{{
			"ReferenceNumber":     ref + "_1",
			"AccountNumber":       accountNumber,
			"Amount":              amountKES,
			"TransactionCurrency": "KES",
			"Narration":           narration,
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
		desc = fmt.Sprintf("Co-op rejected the internal transfer (HTTP %d)", status)
	}
	return CoopSendRejected, desc
}
