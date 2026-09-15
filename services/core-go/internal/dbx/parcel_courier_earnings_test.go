package dbx

import (
	"testing"

	"github.com/esoqo/core-go/internal/money"
)

// kes is a local shorthand so these assertions read in shillings while
// the type underneath stays exact cents.
func kesC(v float64) money.Cents { return money.FromKES(v) }

// The pure rule that decides a courier's pay. Everything else in the
// earnings chain is bookkeeping on top of it, so if this is wrong the
// ledger is wrong in a way no status column would reveal.

func TestCourierTariffComponentsStack(t *testing.T) {
	// Flat plus percentage, which is the point of having both: neither
	// component needs a mode flag, and zero expresses "not this one".
	both := ParcelCourierTariff{PerDeliveryKes: money.AmountFromKES(50), PctOfPrice: 40, MaxPerDeliveryKes: money.AmountFromKES(2000)}
	if got := both.EarningsFor(kesC(500)); got != kesC(250) {
		t.Errorf("EarningsFor(500) = %v, want 250 (50 flat + 40%% of 500)", got)
	}

	flatOnly := ParcelCourierTariff{PerDeliveryKes: money.AmountFromKES(120), MaxPerDeliveryKes: money.AmountFromKES(2000)}
	if got := flatOnly.EarningsFor(kesC(500)); got != kesC(120) {
		t.Errorf("a flat-only tariff should ignore the price, got %v", got)
	}

	pctOnly := ParcelCourierTariff{PctOfPrice: 60, MaxPerDeliveryKes: money.AmountFromKES(2000)}
	if got := pctOnly.EarningsFor(kesC(500)); got != kesC(300) {
		t.Errorf("EarningsFor(500) at 60%% = %v, want 300", got)
	}
}

func TestCourierTariffNeverPaysMoreThanTheSenderPaid(t *testing.T) {
	// The guard that matters. A mistyped rate must cost Esoqo its margin
	// on a parcel and nothing worse — never turn a delivery into a net
	// transfer out of the platform.
	generous := ParcelCourierTariff{PerDeliveryKes: money.AmountFromKES(900), PctOfPrice: 90, MaxPerDeliveryKes: money.AmountFromKES(5000)}
	if got := generous.EarningsFor(kesC(200)); got != kesC(200) {
		t.Errorf("earnings must cap at the price paid, got %v for a KES 200 parcel", got)
	}

	// The explicit ceiling applies before that, and independently.
	capped := ParcelCourierTariff{PctOfPrice: 100, MaxPerDeliveryKes: money.AmountFromKES(300)}
	if got := capped.EarningsFor(kesC(5000)); got != kesC(300) {
		t.Errorf("earnings must cap at maxPerDeliveryKes, got %v", got)
	}
}

func TestCourierTariffDegradesQuietly(t *testing.T) {
	tariff := ParcelCourierTariff{PerDeliveryKes: money.AmountFromKES(50), PctOfPrice: 40, MaxPerDeliveryKes: money.AmountFromKES(2000)}

	// An unpriced parcel earns nothing rather than paying out the flat
	// component against a price that was never collected.
	if got := tariff.EarningsFor(kesC(0)); got != kesC(0) {
		t.Errorf("an unpriced parcel should earn nothing, got %v", got)
	}
	if got := tariff.EarningsFor(kesC(-10)); got != kesC(0) {
		t.Errorf("a negative price should earn nothing, got %v", got)
	}

	// An unconfigured tariff — the zero value GetCourierTariff returns
	// when no row exists — accrues nothing at all, rather than erroring
	// in the middle of closing a delivery.
	var unset ParcelCourierTariff
	if got := unset.EarningsFor(kesC(500)); got != kesC(0) {
		t.Errorf("an unconfigured tariff should earn nothing, got %v", got)
	}
}

func TestCourierTariffRoundsToWholeCents(t *testing.T) {
	// 33.333% of 910.55 is 303.5106... — money, not a float tail.
	tariff := ParcelCourierTariff{PctOfPrice: 33.333, MaxPerDeliveryKes: money.AmountFromKES(2000)}
	got := tariff.EarningsFor(kesC(910.55))
	if got != kesC(303.51) {
		t.Errorf("EarningsFor(910.55) = %v, want 303.51", got)
	}
	// It is a whole number of cents by construction now — money.Cents has
	// no sub-cent state to be in. What is worth asserting instead is that
	// it renders as the exact two-place decimal the column will hold.
	if got.Decimal() != "303.51" {
		t.Errorf("Decimal() = %q, want \"303.51\"", got.Decimal())
	}
}
