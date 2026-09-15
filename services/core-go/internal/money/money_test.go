package money

import (
	"math"
	"testing"
)

func TestFromKESRoundsHalfAwayFromZero(t *testing.T) {
	cases := []struct {
		kes  float64
		want Cents
	}{
		{0, 0},
		{1, 100},
		{250.50, 25050},
		{-45.20, -4520},
		{0.01, 1},
		{0.005, 1},
		{-0.005, -1},
		{0.004, 0},
		// The float the old parcel pricing produced: 51 * (1 - 5/100)
		// is 48.449999999999996, not 48.45. Rounding recovers the cent
		// that was meant; truncation would short it.
		{51 * (1 - 5.0/100), 4845},
		{99.99 * 3, 29997},
	}
	for _, tc := range cases {
		if got := FromKES(tc.kes); got != tc.want {
			t.Errorf("FromKES(%v) = %d, want %d", tc.kes, got, tc.want)
		}
	}
}

func TestFromKESHandlesNonFinite(t *testing.T) {
	for _, f := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if got := FromKES(f); got != Zero {
			t.Errorf("FromKES(%v) = %d, want 0", f, got)
		}
	}
}

func TestParseKESIsExact(t *testing.T) {
	cases := []struct {
		in   string
		want Cents
	}{
		{"0", 0},
		{"1", 100},
		{"250.50", 25050},
		{"250.5", 25050},
		{"0.05", 5},
		{" 1,250.50 ", 125050},
		{"-45.20", -4520},
		{"+7", 700},
		{".5", 50},
		{"7.", 700},
		// Beyond 2dp rounds to the nearest cent.
		{"10.005", 1001},
		{"10.004", 1000},
		{"10.999", 1100},
	}
	for _, tc := range cases {
		got, err := ParseKES(tc.in)
		if err != nil {
			t.Errorf("ParseKES(%q) errored: %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("ParseKES(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestParseKESRejectsMalformed(t *testing.T) {
	for _, in := range []string{"", "   ", "1.2.3", "12a.00", "-", "abc"} {
		if _, err := ParseKES(in); err == nil {
			t.Errorf("ParseKES(%q) = nil error, want an error", in)
		}
	}
}

func TestMustParseKESFallsBackToZero(t *testing.T) {
	if got := MustParseKES("not-a-number"); got != Zero {
		t.Errorf("MustParseKES(bad) = %d, want 0", got)
	}
	if got := MustParseKES("12.34"); got != 1234 {
		t.Errorf("MustParseKES(\"12.34\") = %d, want 1234", got)
	}
}

func TestDecimalRoundTrips(t *testing.T) {
	for _, in := range []string{"0.00", "1.05", "999.99", "-45.20", "1250.00"} {
		c := MustParseKES(in)
		if got := c.Decimal(); got != in {
			t.Errorf("%q -> %d -> %q", in, c, got)
		}
	}
	if got := Cents(1).Decimal(); got != "0.01" {
		t.Errorf("Cents(1).Decimal() = %q, want \"0.01\"", got)
	}
	if got := Cents(-1).Decimal(); got != "-0.01" {
		t.Errorf("Cents(-1).Decimal() = %q, want \"-0.01\"", got)
	}
}

// The property that makes the dbx conversions safe: a value that came in
// as float64 and goes back out as float64 must survive unchanged.
func TestKESRoundTripsThroughFloat(t *testing.T) {
	for _, kes := range []float64{0, 1, 0.01, 250.50, 1234.56, -45.20, 99999.99} {
		c := FromKES(kes)
		if back := FromKES(c.KES()); back != c {
			t.Errorf("round trip of %v: %d -> %v -> %d", kes, c, c.KES(), back)
		}
	}
}

func TestPercent(t *testing.T) {
	price := FromKES(1000)
	if got := price.Percent(15); got != 15000 {
		t.Errorf("1000.Percent(15) = %d, want 15000", got)
	}
	// 33.33% of 10.00 = 3.333 -> 3.33
	if got := FromKES(10).Percent(33.33); got != 333 {
		t.Errorf("10.Percent(33.33) = %d, want 333", got)
	}
	// 12.345% of 100.00 = 12.345 -> 12.35 half away from zero
	if got := FromKES(100).Percent(12.345); got != 1235 {
		t.Errorf("100.Percent(12.345) = %d, want 1235", got)
	}
	if got := FromKES(100).Percent(math.NaN()); got != Zero {
		t.Errorf("Percent(NaN) = %d, want 0", got)
	}
}

// A split derived as (whole, whole-part) must always reconcile — this is
// the anti-stranded-cent property SplitParcelRevenue and
// AllocateCodCollection both depend on.
func TestPercentSplitAlwaysReconciles(t *testing.T) {
	prices := []Cents{0, 1, 99, 100, 12345, 99999, 100000, 3333333}
	pcts := []float64{0, 0.5, 1, 7.5, 12.345, 15, 33.33, 50, 99.9, 100}
	for _, price := range prices {
		for _, pct := range pcts {
			fee := price.Percent(pct)
			rest := price - fee
			if fee+rest != price {
				t.Errorf("price=%d pct=%v: fee %d + rest %d != %d", price, pct, fee, rest, price)
			}
		}
	}
}

// Points must reproduce the int(kes*10 + 0.5) expression it replaces at
// four call sites, including the half-up boundary.
func TestPointsMatchesTheExpressionItReplaces(t *testing.T) {
	for _, kes := range []float64{
		0, 1, 0.05, 0.1, 12.34, 250.50, 250.55, 250.54, 999.99, 1000,
	} {
		want := int(kes*10 + 0.5)
		if got := FromKES(kes).Points(); got != want {
			t.Errorf("FromKES(%v).Points() = %d, want %d (int(kes*10+0.5))", kes, got, want)
		}
	}
}

func TestPointsHandlesNegatives(t *testing.T) {
	if got := Cents(-25055).Points(); got != -2506 {
		t.Errorf("Cents(-25055).Points() = %d, want -2506", got)
	}
}

func TestMinAndIsPositive(t *testing.T) {
	if got := FromKES(500).Min(FromKES(300)); got != 30000 {
		t.Errorf("Min = %d, want 30000", got)
	}
	if got := FromKES(300).Min(FromKES(500)); got != 30000 {
		t.Errorf("Min = %d, want 30000", got)
	}
	if !Cents(1).IsPositive() {
		t.Error("Cents(1).IsPositive() = false")
	}
	if Zero.IsPositive() || Cents(-1).IsPositive() {
		t.Error("zero/negative reported as positive")
	}
}

func TestSum(t *testing.T) {
	if got := Sum(); got != Zero {
		t.Errorf("Sum() = %d, want 0", got)
	}
	// Ten lots of 0.10 — the accumulation that drifts in float64.
	tenths := make([]Cents, 10)
	for i := range tenths {
		tenths[i] = 10
	}
	if got := Sum(tenths...); got != 100 {
		t.Errorf("Sum(10 x 0.10) = %d, want 100", got)
	}

	var viaFloat float64
	for i := 0; i < 10; i++ {
		viaFloat += 0.1
	}
	if viaFloat == 1.0 {
		t.Error("test setup: the float accumulation no longer drifts, so this guards nothing")
	}
}

func TestScaleIsRateTimesQuantity(t *testing.T) {
	perKm := FromKES(12.50)
	cases := []struct {
		km   float64
		want Cents
	}{
		{0, 0},
		{1, 1250},
		{2, 2500},
		{3.5, 4375},
		// 12.50 x 7.3 = 91.25 exactly
		{7.3, 9125},
		// 12.50 x 0.333 = 4.1625 -> 4.16
		{0.333, 416},
	}
	for _, tc := range cases {
		if got := perKm.Scale(tc.km); got != tc.want {
			t.Errorf("12.50.Scale(%v) = %d cents, want %d", tc.km, got, tc.want)
		}
	}
	if got := perKm.Scale(math.NaN()); got != Zero {
		t.Errorf("Scale(NaN) = %d, want 0", got)
	}
}

// Scale always lands on a whole cent, including on the half-cent
// boundary, where the result is otherwise decided by whichever way the
// float product happened to fall. The per-km charge is written into a
// Decimal(12,2) column, so a half-cent has to resolve the same way every
// time rather than by luck.
func TestScaleResolvesTheHalfCentBoundary(t *testing.T) {
	// 8.15/km over 3.3km is 26.895 — exactly half a cent. Half away from
	// zero makes that 26.90, never 26.89.
	if got := FromKES(8.15).Scale(3.3); got != Cents(2690) {
		t.Errorf("8.15/km x 3.3km = %s, want 26.90", got.Decimal())
	}
	// Same boundary, and the float product here carries visible noise
	// (896.5000000000001) — it must still land on the same cent.
	if got := FromKES(8.15).Scale(1.1); got != Cents(897) {
		t.Errorf("8.15/km x 1.1km = %s, want 8.97", got.Decimal())
	}
	// Negative distances are not a thing, but the rounding rule must stay
	// symmetric so Scale can never be a source of asymmetry.
	if got := FromKES(-8.15).Scale(3.3); got != Cents(-2690) {
		t.Errorf("-8.15 x 3.3 = %s, want -26.90", got.Decimal())
	}
}
