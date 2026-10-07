package payments

import "testing"

func TestParseCoopStkStatusSuccess(t *testing.T) {
	// Verbatim shape from the Postman "STK PushTransactionStatus" response.
	body := []byte(`{"MessageReference":"christopher10","MessageCode":"0","MessageDescription":"FULL SUCCESS",
	"MessageDetails":"Transaction processed successfully","TransactionMetadata":{"Items":[
	{"Name":"Amount","Value":"1.0"},{"Name":"PhoneNumber","Value":"254795227237"},
	{"Name":"Narration","Value":"Test Transaction~UJ7MW94X2D~2026-10-07"}]}}`)
	st := parseCoopStkStatus(body)
	if st.State != CoopStkSuccess || !st.AmountSet || st.AmountKES != 1 ||
		st.Phone != "254795227237" || st.Receipt != "UJ7MW94X2D" {
		t.Fatalf("unexpected parse: %+v", st)
	}
}

func TestParseCoopStkStatusFailureAndAmbiguous(t *testing.T) {
	failed := parseCoopStkStatus([]byte(`{"MessageCode":"2","MessageDescription":"FULL FAILURE~Failed~x"}`))
	if failed.State != CoopStkFailed {
		t.Fatalf("want FAILED, got %+v", failed)
	}
	// Never book a parcel on an answer we can't read.
	for _, b := range []string{`{}`, `not json`, `{"MessageCode":"0","MessageDescription":"PROCESSING"}`} {
		if st := parseCoopStkStatus([]byte(b)); st.State != CoopStkPending {
			t.Fatalf("%q should stay PENDING, got %+v", b, st)
		}
	}
}

func TestIsCoopRef(t *testing.T) {
	if !IsCoopRef(newCoopRef()) || IsCoopRef("ws_CO_123") {
		t.Fatal("ref prefix detection wrong")
	}
}
