package payments

import "testing"

// callbackBody builds a Daraja-shaped success payload with the given
// CallbackMetadata items.
func callbackBody(items []interface{}) map[string]interface{} {
	return map[string]interface{}{
		"Body": map[string]interface{}{
			"stkCallback": map[string]interface{}{
				"CheckoutRequestID": "ws_CO_123",
				"ResultCode":        float64(0),
				"ResultDesc":        "The service request is processed successfully.",
				"CallbackMetadata":  map[string]interface{}{"Item": items},
			},
		},
	}
}

func TestParseStkCallbackExtractsAmountAndPayer(t *testing.T) {
	got := ParseStkCallback(callbackBody([]interface{}{
		map[string]interface{}{"Name": "Amount", "Value": float64(1500)},
		map[string]interface{}{"Name": "MpesaReceiptNumber", "Value": "QGR7XYZ123"},
		map[string]interface{}{"Name": "PhoneNumber", "Value": float64(254712345678)},
	}))
	if got == nil {
		t.Fatal("expected a parsed callback")
	}
	if !got.Succeeded {
		t.Error("ResultCode 0 should parse as succeeded")
	}
	if !got.AmountPresent || got.Amount != 1500 {
		t.Errorf("Amount = %v (present %v), want 1500", got.Amount, got.AmountPresent)
	}
	if got.PayerMsisdn != "254712345678" {
		t.Errorf("PayerMsisdn = %q, want 254712345678 (numeric form must not go scientific)", got.PayerMsisdn)
	}
	if got.MpesaReceiptCode != "QGR7XYZ123" {
		t.Errorf("MpesaReceiptCode = %q", got.MpesaReceiptCode)
	}
}

// Sandbox has been observed quoting Amount; losing it would silently
// disable the amount check rather than fail loudly, so both forms parse.
func TestParseStkCallbackAcceptsStringAmount(t *testing.T) {
	got := ParseStkCallback(callbackBody([]interface{}{
		map[string]interface{}{"Name": "Amount", "Value": "1500.50"},
	}))
	if !got.AmountPresent || got.Amount != 1500.50 {
		t.Errorf("Amount = %v (present %v), want 1500.50", got.Amount, got.AmountPresent)
	}
}

// A missing Amount must be distinguishable from a genuine zero — the
// webhook refuses to confirm in that case rather than treating it as 0.
func TestParseStkCallbackMissingAmountIsNotZero(t *testing.T) {
	got := ParseStkCallback(callbackBody([]interface{}{
		map[string]interface{}{"Name": "MpesaReceiptNumber", "Value": "QGR7XYZ123"},
	}))
	if got.AmountPresent {
		t.Error("AmountPresent should be false when Daraja omits Amount")
	}
}
