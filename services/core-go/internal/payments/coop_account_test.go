package payments

import "testing"

func TestParseCoopBalance(t *testing.T) {
	// Verbatim shape from the Postman "Account Balance" example.
	bal, err := parseCoopBalance([]byte(`{
		"MessageReference": "69bc046e-5c2d-46ee-9f41-01788bf5290d",
		"MessageDateTime": "2026-10-07T13:10:24",
		"MessageCode": "0",
		"MessageDescription": "SUCCESS",
		"AccountNumber": "01103391196001",
		"AccountName": "SUSUFO ESOQO LTD",
		"Currency": "KES",
		"ProductName": "MSME BRONZE",
		"ClearedBalance": "218.25",
		"BookedBalance": "0.0",
		"BlockedBalance": "0.0",
		"AvailableBalance": "218.25",
		"BranchName": "COOP HOUSE BRANCH"
	}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if bal.AccountName != "SUSUFO ESOQO LTD" || bal.AvailableBalance != 218.25 || bal.ClearedBalance != 218.25 {
		t.Fatalf("bad balance: %+v", bal)
	}

	if _, err := parseCoopBalance([]byte(`{"MessageCode":"1","MessageDescription":"ACCOUNT NOT FOUND"}`)); err == nil {
		t.Fatal("a non-zero MessageCode must be an error")
	}
}

func TestCoopStatementAmount(t *testing.T) {
	if v := coopStatementAmount(float64(100)); v != 100 {
		t.Fatalf("got %v", v)
	}
	if v := coopStatementAmount("50.5"); v != 50.5 {
		t.Fatalf("got %v", v)
	}
	if v := coopStatementAmount(nil); v != 0 {
		t.Fatalf("got %v", v)
	}
}
