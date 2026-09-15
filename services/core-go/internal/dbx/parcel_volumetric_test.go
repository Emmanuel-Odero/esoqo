package dbx

import "testing"

// The rule that decides what a bulky parcel costs. Wrong here means
// either money left on the table on every oversized box, or a customer
// overcharged for air — and neither shows up in any report, because
// nothing else records what should have been charged.

func TestVolumetricKg(t *testing.T) {
	// The worked example from the proposal: a 60×40×30 flat-pack.
	// 72,000cm³ / 5000 = 14.4kg.
	if got := VolumetricKg(60, 40, 30, 5000); got != 14.4 {
		t.Errorf("VolumetricKg(60,40,30,5000) = %v, want 14.4", got)
	}
	// Road's gentler divisor on the same box.
	if got := VolumetricKg(60, 40, 30, 6000); got != 12 {
		t.Errorf("VolumetricKg(60,40,30,6000) = %v, want 12", got)
	}
	// An envelope's volume rounds to almost nothing, which is correct —
	// it should never out-weigh its own mass.
	if got := VolumetricKg(30, 20, 1, 5000); got != 0.12 {
		t.Errorf("VolumetricKg(30,20,1,5000) = %v, want 0.12", got)
	}
}

// An unmeasured or half-measured box must not be priced on invented
// volume. Two dimensions is not a volume, and guessing the third would
// attach a customer's money to a number nobody recorded.
func TestVolumetricKgRefusesPartialMeasurements(t *testing.T) {
	for _, dims := range [][3]float64{
		{0, 40, 30}, {60, 0, 30}, {60, 40, 0},
		{-1, 40, 30}, {60, -1, 30}, {60, 40, -1},
		{0, 0, 0},
	} {
		if got := VolumetricKg(dims[0], dims[1], dims[2], 5000); got != 0 {
			t.Errorf("VolumetricKg(%v) = %v, want 0 — a missing dimension is not a volume", dims, got)
		}
	}
}

// A misconfigured divisor must not divide by zero and must not produce
// an absurd charge; it falls back to the documented default.
func TestVolumetricKgSurvivesABadDivisor(t *testing.T) {
	want := VolumetricKg(60, 40, 30, DefaultVolumetricDivisor)
	for _, divisor := range []float64{0, -5000} {
		if got := VolumetricKg(60, 40, 30, divisor); got != want {
			t.Errorf("VolumetricKg with divisor %v = %v, want the default's %v", divisor, got, want)
		}
	}
}

func TestChargeableKgTakesTheGreater(t *testing.T) {
	cases := []struct{ actual, volumetric, want float64 }{
		// Bulky and light: volume wins. This is the case that was
		// silently losing money.
		{4.2, 14.4, 14.4},
		// Dense and small: mass wins. A car battery is not cheap freight.
		{18, 2.1, 18},
		// Unmeasured: falls back to actual, i.e. exactly the old
		// behaviour, so nothing already in flight reprices.
		{7.5, 0, 7.5},
		// Unweighed but measured: volume is all we have.
		{0, 14.4, 14.4},
		// Neither known: 0, and the sender's chosen bracket stands.
		{0, 0, 0},
		// Exactly equal: no reason to prefer either.
		{10, 10, 10},
	}
	for _, c := range cases {
		if got := ChargeableKg(c.actual, c.volumetric); got != c.want {
			t.Errorf("ChargeableKg(%v, %v) = %v, want %v", c.actual, c.volumetric, got, c.want)
		}
	}
}

// The counter has to be able to explain the price, so "is this being
// charged on bulk?" must be answerable — and must not claim bulk
// pricing on a parcel nobody measured.
func TestVolumetricApplies(t *testing.T) {
	if !VolumetricApplies(4.2, 14.4) {
		t.Error("a bulky light parcel is charged on volume; the counter must be able to say so")
	}
	if VolumetricApplies(18, 2.1) {
		t.Error("a dense parcel is charged on mass, not volume")
	}
	if VolumetricApplies(7.5, 0) {
		t.Error("an unmeasured parcel must not be reported as charged on volume")
	}
	if VolumetricApplies(10, 10) {
		t.Error("equal weights give volume no claim to explain the price")
	}
}
