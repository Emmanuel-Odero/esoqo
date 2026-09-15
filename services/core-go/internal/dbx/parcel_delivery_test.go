package dbx

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/esoqo/core-go/internal/money"
)

// The pure halves of the unhappy-path and coverage logic — the pieces
// that decide money and wording, testable without a database fixture,
// same split nextHandoffStatus already keeps.

func TestNextHandoffStatusRecoversFromFailure(t *testing.T) {
	// A parcel that failed at the door or is sitting on a shop shelf and
	// is now being scanned by someone is, by definition, moving again.
	// Without this it would stay stranded in a failure state forever.
	for _, from := range []string{"FAILED_DELIVERY", "HELD_AT_AGENT"} {
		if got := nextHandoffStatus(from); got != "IN_TRANSIT" {
			t.Errorf("nextHandoffStatus(%q) = %q, want IN_TRANSIT", from, got)
		}
	}
}

func TestAttemptReasonValidation(t *testing.T) {
	for _, r := range ValidAttemptReasons {
		if !isValidAttemptReason(r) {
			t.Errorf("%q is in ValidAttemptReasons but isValidAttemptReason says no", r)
		}
	}
	for _, r := range []string{"", "nobody_home", "MADE_UP", "DELIVERED"} {
		if isValidAttemptReason(r) {
			t.Errorf("isValidAttemptReason(%q) should be false", r)
		}
	}
}

func TestAttemptReasonTextIsAHumanSentence(t *testing.T) {
	note := "the gate was locked"
	cases := []struct {
		reason string
		note   *string
		want   string
	}{
		{"NOBODY_HOME", nil, "nobody was there to receive it"},
		{"REFUSED", nil, "it was turned away at the door"},
		// OTHER carries the courier's own words through — that's the
		// entire reason a free-text note is mandatory alongside it.
		{"OTHER", &note, "the gate was locked"},
		// ...but an OTHER that somehow arrives without one (an older
		// client, a direct API call) must still read as a sentence
		// rather than leak the raw enum into somebody's SMS.
		{"OTHER", nil, "the delivery couldn't be completed"},
		{"MADE_UP", nil, "the delivery couldn't be completed"},
	}
	for _, tc := range cases {
		if got := AttemptReasonText(tc.reason, tc.note); got != tc.want {
			t.Errorf("AttemptReasonText(%q) = %q, want %q", tc.reason, got, tc.want)
		}
	}
}

func TestCoverageFeeAndPayoutAgreeOnTheCap(t *testing.T) {
	// Same figures as before the move to exact cents — the assertions are
	// unchanged in meaning, only in unit, so this still guards the
	// behaviour it always did.
	tier := ParcelCoverageTier{
		Name:        "Standard",
		MaxCoverKes: money.AmountFromKES(25000),
		FeeKes:      money.AmountFromKES(50),
		FeePct:      1,
	}
	kes := func(v float64) money.Cents { return money.FromKES(v) }

	// Under the ceiling: fee is charged on the full declared value.
	if got := tier.CoverageFee(kes(10000)); got != kes(150) {
		t.Errorf("CoverageFee(10000) = %s, want 150.00 (50 flat + 1%% of 10000)", got.Decimal())
	}
	if got := tier.CoveredAmount(kes(10000)); got != kes(10000) {
		t.Errorf("CoveredAmount(10000) = %s, want 10000.00", got.Decimal())
	}

	// Over the ceiling: the sender is charged on what's actually covered,
	// not on what they typed. Charging a premium against an amount that
	// could never be paid out is the defect this pair of methods exists
	// to make impossible — they must cap at the same number.
	if got := tier.CoverageFee(kes(40000)); got != kes(300) {
		t.Errorf("CoverageFee(40000) = %s, want 300.00 (50 flat + 1%% of the 25000 ceiling)", got.Decimal())
	}
	if got := tier.CoveredAmount(kes(40000)); got != kes(25000) {
		t.Errorf("CoveredAmount(40000) = %s, want the 25000.00 ceiling", got.Decimal())
	}

	// A free tier stays free.
	basic := ParcelCoverageTier{Name: "Basic", MaxCoverKes: money.AmountFromKES(5000)}
	if got := basic.CoverageFee(kes(5000)); got != 0 {
		t.Errorf("a zero-fee tier should cost nothing, got %s", got.Decimal())
	}
}

// A fee percentage that lands off-cent must resolve to an exact cent
// rather than to whatever a float happened to hold. 0.35% of 1,999.99 is
// 6.999965, which the old float path carried forward unrounded into a
// value destined for a Decimal(12,2) column.
func TestCoverageFeeLandsOnAnExactCent(t *testing.T) {
	tier := ParcelCoverageTier{
		Name:        "Odd",
		MaxCoverKes: money.AmountFromKES(100000),
		FeeKes:      money.AmountFromKES(0),
		FeePct:      0.35,
	}
	got := tier.CoverageFee(money.FromKES(1999.99))
	if got != money.Cents(700) {
		t.Errorf("CoverageFee = %s (%d cents), want 7.00", got.Decimal(), got)
	}
	if got.Decimal() != "7.00" {
		t.Errorf("Decimal() = %q, want \"7.00\"", got.Decimal())
	}
}

// The cap is the one place these two methods must agree: a sender may
// never be charged a premium against an amount larger than a claim could
// pay out. Checked across the boundary rather than at one point.
func TestCoverageFeeNeverPricesAboveWhatIsCovered(t *testing.T) {
	tier := ParcelCoverageTier{
		Name:        "Standard",
		MaxCoverKes: money.AmountFromKES(25000),
		FeeKes:      money.AmountFromKES(50),
		FeePct:      1,
	}
	for _, declared := range []float64{0, 1, 24999.99, 25000, 25000.01, 40000, 1000000} {
		d := money.FromKES(declared)
		covered := tier.CoveredAmount(d)
		if covered > tier.MaxCoverKes.Cents() {
			t.Errorf("declared %v: covered %s exceeds the ceiling", declared, covered.Decimal())
		}
		// The fee must equal the fee computed on the covered amount —
		// i.e. the premium is never charged on the uncovered excess.
		if tier.CoverageFee(d) != tier.CoverageFee(covered) {
			t.Errorf("declared %v: fee on declared (%s) != fee on covered (%s)",
				declared, tier.CoverageFee(d).Decimal(), tier.CoverageFee(covered).Decimal())
		}
	}
}

func TestSplitParcelRevenueAlwaysReconciles(t *testing.T) {
	// The invariant that matters: the two halves add back up to the
	// price, exactly, for every input. A rounding remainder stranded
	// between them is how a settlement report quietly stops balancing.
	prices := []float64{0, 1, 99.99, 250, 333.33, 585, 1000.01, 7700.55}
	pcts := []float64{0, 7.5, 12.25, 15, 33.333, 100}
	for _, price := range prices {
		for _, pct := range pcts {
			fee, earnings := SplitParcelRevenue(price, pct)
			if diff := (fee + earnings) - price; diff > 0.005 || diff < -0.005 {
				t.Errorf("SplitParcelRevenue(%v, %v) = %v + %v, which is %v off the price",
					price, pct, fee, earnings, diff)
			}
			if fee < 0 || earnings < 0 {
				t.Errorf("SplitParcelRevenue(%v, %v) produced a negative share: %v / %v",
					price, pct, fee, earnings)
			}
		}
	}
}

func TestSplitParcelRevenueClampsAndRounds(t *testing.T) {
	// A nonsense commission must not produce a negative payout — the
	// company would be invoicing Esoqo for the privilege of delivering.
	fee, earnings := SplitParcelRevenue(500, 140)
	if fee != 500 || earnings != 0 {
		t.Errorf("a >100%% commission should clamp to the whole price, got %v / %v", fee, earnings)
	}
	fee, earnings = SplitParcelRevenue(500, -10)
	if fee != 0 || earnings != 500 {
		t.Errorf("a negative commission should clamp to zero, got %v / %v", fee, earnings)
	}
	// 15% of 585 is 87.75 — exact cents, not a float tail.
	if fee, earnings = SplitParcelRevenue(585, 15); fee != 87.75 || earnings != 497.25 {
		t.Errorf("SplitParcelRevenue(585, 15) = %v / %v, want 87.75 / 497.25", fee, earnings)
	}
}

// The wire contract this type now promises. Asserted directly, because
// the whole point of the change is the shape a client receives, and
// nothing else in the suite would notice if MarshalJSON regressed to a
// number.
func TestCoverageTierSerialisesMoneyAsDecimalStrings(t *testing.T) {
	tier := ParcelCoverageTier{
		ID:          "t1",
		Name:        "Standard",
		MaxCoverKes: money.AmountFromKES(25000),
		FeeKes:      money.AmountFromKES(50),
		FeePct:      1.5,
		Active:      true,
		SortOrder:   2,
	}
	encoded, err := json.Marshal(tier)
	if err != nil {
		t.Fatal(err)
	}
	got := string(encoded)

	for _, want := range []string{
		`"maxCoverKes":"25000.00"`,
		`"feeKes":"50.00"`,
		// feePct is a rate, not an amount — it stays a JSON number, and a
		// client that starts parsing it as a decimal string is wrong.
		`"feePct":1.5`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("marshalled tier missing %s\n  got: %s", want, got)
		}
	}
}
