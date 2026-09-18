package dbx

import (
	"testing"

	"github.com/esoqo/core-go/internal/money"
)

// TestOrgPriceBoundsBracketThePlatformCard — a courier company's own
// rate has to stay in sight of the platform band it forks from. The
// hole this closes: the only validation used to be minKes > 0, so a
// tenant could set KES 1 (starving the commission Esoqo earns on every
// parcel) or KES 1,000,000 (quoted to a real sender as the real price).
func TestOrgPriceBoundsBracketThePlatformCard(t *testing.T) {
	platformMin, platformMax := money.FromKES(200), money.FromKES(500)
	floor, ceiling := OrgPriceBounds(platformMin, platformMax)

	if floor != money.FromKES(100) {
		t.Errorf("floor = %d cents, want half the platform min (10000)", floor)
	}
	if ceiling != money.FromKES(1000) {
		t.Errorf("ceiling = %d cents, want double the platform max (100000)", ceiling)
	}

	// The platform's own band must always be a legal choice — a company
	// that simply accepts the card can't be rejected by the guardrail
	// that exists to police departures from it.
	if platformMin < floor || platformMax > ceiling {
		t.Errorf("the platform band itself falls outside the permitted range [%d, %d]", floor, ceiling)
	}

	for _, tc := range []struct {
		name       string
		min, max   money.Cents
		wantInside bool
	}{
		{"matches the card", platformMin, platformMax, true},
		{"undercuts within reach", money.FromKES(120), money.FromKES(400), true},
		{"premium within reach", money.FromKES(400), money.FromKES(900), true},
		{"race to the bottom", money.FromKES(1), money.FromKES(400), false},
		{"absurd ceiling", money.FromKES(200), money.FromKES(1000000), false},
	} {
		inside := tc.min >= floor && tc.max <= ceiling
		if inside != tc.wantInside {
			t.Errorf("%s: inside = %v, want %v (bounds [%d, %d])", tc.name, inside, tc.wantInside, floor, ceiling)
		}
	}
}

func TestNextHandoffStatus(t *testing.T) {
	// A carrier scan: a first scan on a scheduled pickup is a collection,
	// and any later scan is just another leg.
	for in, want := range map[string]string{
		"BOOKED":              "PICKED_UP",
		"RECEIVED_AT_COUNTER": "PICKED_UP",
		"PICKED_UP":           "IN_TRANSIT",
		"IN_TRANSIT":          "IN_TRANSIT",
	} {
		if got := nextHandoffStatus(in, false); got != want {
			t.Errorf("nextHandoffStatus(%q, false) = %q, want %q", in, got, want)
		}
	}
	// A counter receipt: the first scan on a self-drop-off or an Esoqo
	// desk confirmation lands at the counter, not on a courier.
	if got := nextHandoffStatus("BOOKED", true); got != "RECEIVED_AT_COUNTER" {
		t.Errorf("nextHandoffStatus(BOOKED, true) = %q, want RECEIVED_AT_COUNTER", got)
	}
	// A carrier taking a parcel already sitting at a counter collects it.
	if got := nextHandoffStatus("RECEIVED_AT_COUNTER", false); got != "PICKED_UP" {
		t.Errorf("nextHandoffStatus(RECEIVED_AT_COUNTER, false) = %q, want PICKED_UP", got)
	}
}

func TestTrackEventLabel(t *testing.T) {
	// Public tracking labels are guest-safe sentences, never the raw
	// enum, and an empty status (a handoff row written before the
	// status column existed) still gets a neutral, non-broken label.
	cases := map[string]string{
		"RECEIVED_AT_COUNTER": "Received at counter",
		"PICKED_UP":           "Collected",
		"IN_TRANSIT":          "In transit",
		"HELD_AT_AGENT":       "Ready for collection",
		"DELIVERED":           "Delivered",
		"":                    "Custody transfer",
	}
	for in, want := range cases {
		if got := trackEventLabel(in); got != want {
			t.Errorf("trackEventLabel(%q) = %q, want %q", in, got, want)
		}
	}
}
