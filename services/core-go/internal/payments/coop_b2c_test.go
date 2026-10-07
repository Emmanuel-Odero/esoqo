package payments

import "testing"

func TestParseCoopTransferStatus(t *testing.T) {
	// Verbatim shapes from the Postman "Transaction Status" examples.
	ok := parseCoopTransferStatus([]byte(`{"MessageReference":"4844ebf1b17e","MessageCode":"0","MessageDescription":"FULL SUCCESS",
	"Destinations":[{"ReferenceNumber":"4844ebf1b17e_1","TransactionID":"CB0507000_20261007","ExternalTransactionID":"UJ7MW94NMS"}]}`))
	if ok.State != CoopTransferSuccess || ok.Receipt != "UJ7MW94NMS" {
		t.Fatalf("success: %+v", ok)
	}
	bad := parseCoopTransferStatus([]byte(`{"MessageCode":"2","MessageDescription":"FULL FAILURE~Failed~INSUFFICIENT AVAIL BAL",
	"Destinations":[{"TransactionID":"NULL"}]}`))
	if bad.State != CoopTransferFailed || bad.Receipt != "" {
		t.Fatalf("failure: %+v", bad)
	}
	for _, b := range []string{`{}`, `nope`, `{"MessageCode":"0","MessageDescription":"PROCESSING"}`, `{"MessageCode":"1","MessageDescription":"PARTIAL"}`} {
		if st := parseCoopTransferStatus([]byte(b)); st.State != CoopTransferPending {
			t.Fatalf("%q must stay PENDING, got %+v", b, st)
		}
	}
}

func TestPayoutRefPrefixes(t *testing.T) {
	r := NewCoopPayoutRef()
	if !IsCoopPayoutRef(r) || IsCoopRef(r) || len(r) != 17 {
		t.Fatalf("bad payout ref %q", r)
	}
}
