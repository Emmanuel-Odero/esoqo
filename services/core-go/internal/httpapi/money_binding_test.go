package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/money"
)

// Swapping a request field from float64 to money.Amount is only
// non-breaking if two things hold, and neither is obvious enough to take
// on trust:
//
//  1. gin still binds a plain JSON number, so every client shipped today
//     keeps working with no change at all.
//  2. `binding:"required"` still rejects a missing or zero amount.
//     go-playground/validator implements "required" as "not the zero
//     value", and money.Amount's zero value is 0 — but it is a named
//     int64 type with custom JSON methods, which is exactly the shape
//     where a validator can quietly start treating every value as
//     present.
//
// If (2) silently stopped working, every money endpoint would begin
// accepting amount-less requests and the failure would show up as
// zero-value rows rather than as an error. Hence this test.

type amountBindingProbe struct {
	AmountKes money.Amount `json:"amountKes" binding:"required"`
	Note      string       `json:"note"`
}

func bindProbe(t *testing.T, body string) (amountBindingProbe, error) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	var req amountBindingProbe
	err := c.ShouldBindJSON(&req)
	return req, err
}

func TestAmountBindsFromTheLegacyNumberForm(t *testing.T) {
	req, err := bindProbe(t, `{"amountKes":2500.50,"note":"x"}`)
	if err != nil {
		t.Fatalf("binding a JSON number failed — this would break every existing client: %v", err)
	}
	if req.AmountKes.Cents() != 250050 {
		t.Errorf("got %d cents, want 250050", req.AmountKes.Cents())
	}
}

func TestAmountBindsFromTheConvergedStringForm(t *testing.T) {
	req, err := bindProbe(t, `{"amountKes":"2500.50","note":"x"}`)
	if err != nil {
		t.Fatalf("binding a decimal string failed: %v", err)
	}
	if req.AmountKes.Cents() != 250050 {
		t.Errorf("got %d cents, want 250050", req.AmountKes.Cents())
	}
}

func TestBothWireFormsBindIdentically(t *testing.T) {
	fromNumber, err := bindProbe(t, `{"amountKes":2500.50}`)
	if err != nil {
		t.Fatal(err)
	}
	fromString, err := bindProbe(t, `{"amountKes":"2500.50"}`)
	if err != nil {
		t.Fatal(err)
	}
	if fromNumber.AmountKes != fromString.AmountKes {
		t.Errorf("the two wire forms disagree: %d vs %d",
			fromNumber.AmountKes.Cents(), fromString.AmountKes.Cents())
	}
}

func TestRequiredStillRejectsAMissingAmount(t *testing.T) {
	if _, err := bindProbe(t, `{"note":"x"}`); err == nil {
		t.Error("binding:\"required\" accepted a request with no amount at all — " +
			"every money endpoint using money.Amount would now accept amount-less " +
			"requests and write zero-value rows instead of erroring")
	}
}

func TestRequiredStillRejectsAZeroAmount(t *testing.T) {
	for _, body := range []string{
		`{"amountKes":0,"note":"x"}`,
		`{"amountKes":"0.00","note":"x"}`,
		`{"amountKes":null,"note":"x"}`,
	} {
		if _, err := bindProbe(t, body); err == nil {
			t.Errorf("binding:\"required\" accepted a zero amount in %s", body)
		}
	}
}

func TestMalformedAmountIsRejectedNotSilentlyZeroed(t *testing.T) {
	for _, body := range []string{
		`{"amountKes":"abc"}`,
		`{"amountKes":"1.2.3"}`,
		`{"amountKes":true}`,
	} {
		if _, err := bindProbe(t, body); err == nil {
			t.Errorf("accepted malformed amount in %s", body)
		}
	}
}

// The response half of the contract, stated once here so the intended
// output shape is pinned somewhere even while most response fields are
// still float64.
func TestAmountSerialisesAsADecimalStringInResponses(t *testing.T) {
	type resp struct {
		PriceKes money.Amount `json:"priceKes"`
	}
	got, err := json.Marshal(resp{PriceKes: money.AmountFromKES(1200)})
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"priceKes":"1200.00"}` {
		t.Errorf("got %s, want {\"priceKes\":\"1200.00\"}", got)
	}
}
