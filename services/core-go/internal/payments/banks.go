// banks.go — the Kenyan bank identifier list PesaLink routes transfers by.
// Codes are the Central Bank/IPSL "bank identifier" values Co-op's own
// PesaLink validation and transfer calls expect as RecipientBankIdentifier /
// Destinations[].BankCode (see CoopValidatePesaLinkAccount, CoopPesaLinkSend).
package payments

import "strings"

// Bank is one entry in the PesaLink participant list: a human-readable name
// and the identifier code banks are addressed by on the IPSL switch.
type Bank struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// KenyanBanks is every PesaLink participant courier companies can be paid
// out to. Kept as a plain slice (not a DB table) since it changes about as
// often as the banking sector itself does — editing this list is a code
// change, same as any other static reference data in this package.
var KenyanBanks = []Bank{
	{"0001", "Kenya Commercial Bank (KCB)"},
	{"0002", "Standard Chartered Bank"},
	{"0003", "ABSA Bank Kenya"},
	{"0005", "Bank of India"},
	{"0006", "Bank of Baroda"},
	{"0007", "National Commercial Bank of Africa (NCBA Bank)"},
	{"0010", "Prime Bank"},
	{"0009", "Central Bank of Kenya"},
	{"0011", "Co-operative Bank of Kenya"},
	{"0012", "National Bank of Kenya (NBK)"},
	{"0014", "M-Oriental Bank"},
	{"0016", "CitiBank of Kenya"},
	{"0017", "Habib Bank AG Zurich"},
	{"0018", "Middle East Bank (MEB)"},
	{"0019", "Bank of Africa (BOA)"},
	{"0023", "Consolidated Bank"},
	{"0025", "Credit Bank"},
	{"0026", "Access Bank"},
	{"0031", "Stanbic Bank"},
	{"0032", "Unaitas SACCO"},
	{"0035", "ABC Bank"},
	{"0043", "Eco Bank"},
	{"0048", "Caritas Microfinance Bank"},
	{"0050", "Paramount Bank"},
	{"0051", "Kingdom Bank"},
	{"0053", "Guaranty Trust Bank (GT Bank)"},
	{"0054", "Victoria Commercial Bank (VCB)"},
	{"0055", "Guardian Bank"},
	{"0057", "I&M Bank"},
	{"0059", "Development Bank of Kenya"},
	{"0060", "SBM Bank"},
	{"0061", "Housing Finance (HFCB)"},
	{"0062", "Post Bank"},
	{"0063", "Diamond Trust Bank (DTB)"},
	{"0065", "Commercial International Bank (CIB) Kenya"},
	{"0066", "Sidian Bank"},
	{"0067", "UMBA Microfinance Bank"},
	{"0068", "Equity Bank"},
	{"0070", "Family Bank"},
	{"0072", "Gulf African Bank"},
	{"0074", "Premier Bank"},
	{"0075", "Dubai Islamic Bank (DIB)"},
	{"0076", "United Bank for Africa (UBA) Bank"},
	{"0078", "Kenya Women Finance Trust (KWFT)"},
	{"0079", "Faulu Microfinance Bank"},
	{"0082", "Choice Bank"},
	{"0089", "Stima SACCO"},
	{"0097", "Telkom Kenya"},
	{"0138", "LOOP"},
	{"1015", "SMEP Microfinance Bank"},
	{"0301", "Amica SACCO"},
	{"0401", "Mwalimu Sacco"},
	{"0203", "Branch MicroFinance Bank"},
	{"0368", "Finserve Africa"},
	{"0402", "Yetu SACCO"},
	{"0081", "Salaam MicroFinance Bank"},
	{"0090", "Taifa Sacco"},
}

// BankByCode looks up a PesaLink bank by its identifier code, found false
// when nothing matches — e.g. a code typed or stored before this list
// existed, or a stale one.
func BankByCode(code string) (Bank, bool) {
	for _, b := range KenyanBanks {
		if b.Code == code {
			return b, true
		}
	}
	return Bank{}, false
}

// PesaLinkTransferBankCode converts a KenyanBanks identifier (always
// four digits, e.g. "0001", "0011") into the short form Co-op's PesaLink
// transfer call actually wants on Destinations[].BankCode — the leading
// "00" dropped, so "0001" becomes "1" and "0011" becomes "11". Co-op's own
// Postman examples validate an account with the full four-digit
// identifier ("RecipientBankIdentifier": "0001") but send the transfer
// itself with the padding stripped ("BankCode": "1") — two different
// fields on two different calls, not a typo.
func PesaLinkTransferBankCode(identifier string) string {
	trimmed := strings.TrimPrefix(strings.TrimSpace(identifier), "00")
	trimmed = strings.TrimLeft(trimmed, "0")
	if trimmed == "" {
		return "0"
	}
	return trimmed
}
