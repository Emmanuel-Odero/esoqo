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

	// Comma formatted amount and alternative receipt extraction
	body2 := []byte(`{"MessageReference":"ref2","MessageCode":0,"MessageDescription":"SUCCESS",
	"TransactionMetadata":{"Items":[{"Name":"Amount","Value":"1,250.00"},{"Name":"Receipt","Value":"REC1234567"}]}}`)
	st2 := parseCoopStkStatus(body2)
	if st2.State != CoopStkSuccess || !st2.AmountSet || st2.AmountKES != 1250 || st2.Receipt != "REC1234567" {
		t.Fatalf("unexpected parse: %+v", st2)
	}
}

func TestParseCoopStkStatusFailureAndAmbiguous(t *testing.T) {
	failed := parseCoopStkStatus([]byte(`{"MessageCode":"2","MessageDescription":"FULL FAILURE~Failed~x"}`))
	if failed.State != CoopStkFailed {
		t.Fatalf("want FAILED, got %+v", failed)
	}

	cancelled := parseCoopStkStatus([]byte(`{"MessageCode":"1032","MessageDescription":"Request cancelled by user"}`))
	if cancelled.State != CoopStkFailed {
		t.Fatalf("want FAILED for cancellation, got %+v", cancelled)
	}

	// Live Co-op response when push is in flight / on user's phone but not yet committed:
	// Co-op Enquiry returns -13 "Message Reference does not exist". This MUST be PENDING!
	inFlight := parseCoopStkStatus([]byte(`{"MessageReference":"ESQ123","MessageCode":"-13","MessageDescription":"Message Reference does not exist"}`))
	if inFlight.State != CoopStkPending {
		t.Fatalf("want PENDING for in-flight reference, got %+v", inFlight)
	}

	accepted := parseCoopStkStatus([]byte(`{"MessageReference":"ESQ123","MessageCode":"0","MessageDescription":"REQUEST ACCEPTED FOR PROCESSING"}`))
	if accepted.State != CoopStkPending {
		t.Fatalf("want PENDING for accepted for processing, got %+v", accepted)
	}

	// Seen live mid-payment: no receipt yet, only a date.
	processing := parseCoopStkStatus([]byte(`{"MessageCode":"0","MessageDescription":"PROCESSING",
	"TransactionMetadata":{"Items":[{"Name":"Narration","Value":"Esoqo parcel test~2026-10-08"}]}}`))
	if processing.State != CoopStkPending || processing.Receipt != "" {
		t.Fatalf("PROCESSING should be PENDING with no receipt, got %+v", processing)
	}
	// Never book a parcel on an answer we can't read.
	for _, b := range []string{`{}`, `not json`, `{"MessageCode":"0","MessageDescription":"PROCESSING"}`} {
		if st := parseCoopStkStatus([]byte(b)); st.State != CoopStkPending {
			t.Fatalf("%q should stay PENDING, got %+v", b, st)
		}
	}
}

func TestCoopCallbackURLOK(t *testing.T) {
	for _, u := range []string{"https://api.esoqo.com/webhooks/coop/callback/x", "https://esoqo.com/"} {
		if !coopCallbackURLOK(u) {
			t.Fatalf("%q should be accepted", u)
		}
	}
	for _, u := range []string{"", "http://api.esoqo.com/x", "https://localhost:4100/x", "http://localhost:4100/x",
		"https://127.0.0.1/x", "https://192.168.1.5/x", "https://core-go.local/x", "not a url"} {
		if coopCallbackURLOK(u) {
			t.Fatalf("%q should be rejected", u)
		}
	}
}

func TestIsCoopRef(t *testing.T) {
	if !IsCoopRef(newCoopRef()) || IsCoopRef("ws_CO_123") {
		t.Fatal("ref prefix detection wrong")
	}
}
