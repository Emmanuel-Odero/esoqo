package ledger

import (
	"math"
	"testing"
)

// The balance rule is what makes double-entry bookkeeping worth doing.
// It used to be checked as a float sum against a ±0.005 tolerance:
//
//	if sum < -0.005 || sum > 0.005 { // float tolerance
//
// These tests pin the two things that change: the check is now exact,
// and it runs on every path (PostEntry validates before touching the
// database; dbx/treasury.go's two inline-transaction writers call
// ValidateBalanced themselves).

func TestValidateBalancedAcceptsBalancedEntries(t *testing.T) {
	cases := []struct {
		name     string
		postings []Posting
	}{
		{"two legs", []Posting{
			{AccountID: "a", AmountCents: 250000},
			{AccountID: "b", AmountCents: -250000},
		}},
		// The shape that made the old tolerance load-bearing: COD
		// collection splits one payment across goods and delivery fee
		// (dbx.AllocateCodCollection derives goods by subtraction).
		{"three legs, COD collection", []Posting{
			{AccountID: "held", AmountCents: 250001},
			{AccountID: "goods", AmountCents: -130001},
			{AccountID: "fee", AmountCents: -120000},
		}},
		// COD settlement: gross clears, seller gets net, Esoqo takes fee.
		{"three legs, COD settlement", []Posting{
			{AccountID: "payable", AmountCents: 333333},
			{AccountID: "settlement", AmountCents: -316667},
			{AccountID: "fee", AmountCents: -16666},
		}},
		{"zero-value entry still balances", []Posting{
			{AccountID: "a", AmountCents: 0},
			{AccountID: "b", AmountCents: 0},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateBalanced(tc.postings); err != nil {
				t.Errorf("ValidateBalanced() = %v, want nil", err)
			}
		})
	}
}

func TestValidateBalancedRejectsOneCentImbalance(t *testing.T) {
	// Under the old ±0.005 float tolerance this was ACCEPTED and written
	// to the ledger: one cent is 0.01 KES, which... is outside 0.005, so
	// this particular one would have been caught. The sub-cent case
	// below is the one that would not have been.
	postings := []Posting{
		{AccountID: "a", AmountCents: 10000},
		{AccountID: "b", AmountCents: -9999},
	}
	if err := ValidateBalanced(postings); err == nil {
		t.Fatal("ValidateBalanced() = nil, want an error for a one-cent imbalance")
	}
}

func TestValidateBalancedRejectsWhatTheOldToleranceAllowed(t *testing.T) {
	// The old check compared a float64 sum in KES against ±0.005. Any
	// imbalance smaller than half a cent passed. In cents that is an
	// imbalance the integer check now catches, because there is no
	// longer any such thing as "less than a cent" in this type.
	const oldTolerance = 0.005

	// An imbalance the old code would have waved through.
	imbalanceKES := 0.004
	if math.Abs(imbalanceKES) >= oldTolerance {
		t.Fatalf("test setup: %v is not inside the old tolerance", imbalanceKES)
	}

	// The nearest thing representable in cents is 0 — which is exactly
	// the point: sub-cent imbalances cannot be constructed any more, so
	// the class of defect is gone rather than merely detected.
	if got := CentsFromKES(imbalanceKES); got != 0 {
		t.Errorf("CentsFromKES(%v) = %d, want 0", imbalanceKES, got)
	}

	// And anything that *is* representable and non-zero is rejected.
	postings := []Posting{
		{AccountID: "a", AmountCents: 1},
		{AccountID: "b", AmountCents: 0},
	}
	if err := ValidateBalanced(postings); err == nil {
		t.Error("ValidateBalanced() = nil, want an error for a 1-cent sum")
	}
}

func TestValidateBalancedRejectsEmptyEntry(t *testing.T) {
	if err := ValidateBalanced(nil); err == nil {
		t.Error("ValidateBalanced(nil) = nil, want an error")
	}
	if err := ValidateBalanced([]Posting{}); err == nil {
		t.Error("ValidateBalanced([]) = nil, want an error")
	}
}

func TestCentsFromKES(t *testing.T) {
	cases := []struct {
		kes  float64
		want int64
	}{
		{0, 0},
		{1, 100},
		{250.50, 25050},
		{-45.20, -4520},
		{0.01, 1},
		{0.005, 1},   // half a cent rounds away from zero
		{-0.005, -1}, // ...symmetrically
		{0.004, 0},
		// The float the old parcel pricing produced: 51 * (1 - 5/100).
		// Rounding recovers the cent that was meant; truncation would
		// have shorted it.
		{51 * (1 - 5.0/100), 4845},
		{99.99 * 3, 29997},
	}
	for _, tc := range cases {
		if got := CentsFromKES(tc.kes); got != tc.want {
			t.Errorf("CentsFromKES(%v) = %d, want %d", tc.kes, got, tc.want)
		}
	}
}

// CentsFromKES must be the inverse of Decimal for every amount that
// round-trips through a caller still typed as float64.
func TestCentsFromKESRoundTripsThroughDecimal(t *testing.T) {
	for _, kes := range []float64{0, 1, 0.01, 250.50, 1234.56, -45.20, 99999.99} {
		p := Posting{AmountCents: CentsFromKES(kes)}
		back := CentsFromKES(parseFloat(t, p.Decimal()))
		if back != p.AmountCents {
			t.Errorf("round trip of %v: %d -> %q -> %d", kes, p.AmountCents, p.Decimal(), back)
		}
	}
}

func TestPostingDecimal(t *testing.T) {
	cases := []struct {
		cents int64
		want  string
	}{
		{0, "0.00"},
		{1, "0.01"},
		{-1, "-0.01"},
		{100, "1.00"},
		{25050, "250.50"},
		{-4520, "-45.20"},
		{123456789, "1234567.89"},
		{-5, "-0.05"},
	}
	for _, tc := range cases {
		if got := (Posting{AmountCents: tc.cents}).Decimal(); got != tc.want {
			t.Errorf("Posting{%d}.Decimal() = %q, want %q", tc.cents, got, tc.want)
		}
	}
}

// A balanced entry must still render to decimal strings that sum to
// zero — otherwise the exactness stops at the driver boundary.
func TestDecimalPreservesBalance(t *testing.T) {
	postings := []Posting{
		{AccountID: "held", AmountCents: 250001},
		{AccountID: "goods", AmountCents: -130001},
		{AccountID: "fee", AmountCents: -120000},
	}
	if err := ValidateBalanced(postings); err != nil {
		t.Fatalf("test setup: %v", err)
	}
	var sum int64
	for _, p := range postings {
		sum += CentsFromKES(parseFloat(t, p.Decimal()))
	}
	if sum != 0 {
		t.Errorf("decimal round trip sums to %d cents, want 0", sum)
	}
}

func parseFloat(t *testing.T, s string) float64 {
	t.Helper()
	var f float64
	var neg bool
	if len(s) > 0 && s[0] == '-' {
		neg = true
		s = s[1:]
	}
	var whole, frac int64
	var seenDot bool
	var fracDigits int
	for _, c := range s {
		switch {
		case c == '.':
			seenDot = true
		case c >= '0' && c <= '9':
			if seenDot {
				frac = frac*10 + int64(c-'0')
				fracDigits++
			} else {
				whole = whole*10 + int64(c-'0')
			}
		default:
			t.Fatalf("unparseable decimal %q", s)
		}
	}
	f = float64(whole) + float64(frac)/math.Pow(10, float64(fracDigits))
	if neg {
		return -f
	}
	return f
}
