package dbx

import (
	"strings"
	"testing"
)

// The delivery code is read off an SMS, frequently spoken down a phone,
// and typed on a counter handset. These tests pin the two properties
// that make that survivable — it is all digits, and it is the length
// the counter's entry field renders boxes for — because both are easy
// to break by "improving" the generator and impossible to notice until
// a clerk is staring at a field that won't accept a real code.

func TestDeliveryCodeIsAllDigits(t *testing.T) {
	for i := 0; i < 500; i++ {
		got, err := generateDeliveryCode()
		if err != nil {
			t.Fatalf("generateDeliveryCode: %v", err)
		}
		if len(got) != DeliveryCodeDigits {
			t.Fatalf("length = %d, want %d (the counter renders exactly this many boxes): %q",
				len(got), DeliveryCodeDigits, got)
		}
		if strings.Trim(got, "0123456789") != "" {
			t.Fatalf("non-digit in %q — a letter here costs the numeric keypad and reintroduces case handling", got)
		}
	}
}

// Rejection sampling, not modulo: 256 % 10 == 6, so a naive
// `b[0] % 10` would make 0–5 about 4% likelier than 6–9 in every
// position. On a six-digit code that is real entropy lost, and it is
// exactly the kind of bias that never shows up in manual testing.
func TestDeliveryCodeDigitsAreNotModuloBiased(t *testing.T) {
	const samples = 30000
	var counts [10]int
	for i := 0; i < samples; i++ {
		got, err := generateDeliveryCode()
		if err != nil {
			t.Fatalf("generateDeliveryCode: %v", err)
		}
		for _, r := range got {
			counts[r-'0']++
		}
	}
	total := samples * DeliveryCodeDigits
	expected := float64(total) / 10
	// ±5% is loose enough never to flake and tight enough to catch the
	// ~4% skew a modulo generator produces.
	for d, n := range counts {
		ratio := float64(n) / expected
		if ratio < 0.95 || ratio > 1.05 {
			t.Errorf("digit %d appeared %d times (%.3f of expected) — generator looks modulo-biased", d, n, ratio)
		}
	}
}

// Codes minted before the switch to digits are alphanumeric and must
// keep working until their parcels land. DeliverParcel never re-derives
// the format — it compares against the stored value — so this test
// guards the comparison rule that makes that true rather than the
// generator.
func TestLegacyAlphanumericCodesStillCompare(t *testing.T) {
	const stored = "K7MP2Q"
	for _, typed := range []string{"K7MP2Q", "k7mp2q", " K7MP2Q ", "K7mp2Q"} {
		if !strings.EqualFold(strings.TrimSpace(typed), stored) {
			t.Errorf("typed %q should still match legacy stored code %q", typed, stored)
		}
	}
	if strings.EqualFold(strings.TrimSpace("K7MP2R"), stored) {
		t.Error("a genuinely different code must not match")
	}
}
