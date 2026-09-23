package dbx

import "testing"

// ShortenPassengerName is applied in two places that must never
// disagree — the printed tag and the public scan projection — and both
// would drift in the same direction if they drifted at all: toward
// printing more of someone's name on a bag that rides in the open.
func TestShortenPassengerNameKeepsSurnameAndInitial(t *testing.T) {
	for in, want := range map[string]string{
		"Mary Wanjiku":         "WANJIKU M.",
		"mary wanjiku":         "WANJIKU M.",
		"John Kamau Otieno":    "OTIENO J.",
		"  Grace   Achieng   ": "ACHIENG G.",
	} {
		if got := ShortenPassengerName(in); got != want {
			t.Errorf("ShortenPassengerName(%q) = %q, want %q", in, got, want)
		}
	}
}

// A single name is common enough (a conductor typing fast enters one
// word) that it has to be handled rather than crash or produce "  .".
func TestShortenPassengerNameHandlesASingleName(t *testing.T) {
	if got := ShortenPassengerName("Wanjiku"); got != "WANJIKU" {
		t.Fatalf("single name should pass through uppercased, got %q", got)
	}
	if got := ShortenPassengerName("   "); got != "" {
		t.Fatalf("blank should yield blank, got %q", got)
	}
	if got := ShortenPassengerName(""); got != "" {
		t.Fatalf("empty should yield empty, got %q", got)
	}
}

// The property that actually matters: whatever else changes, a middle
// name or a second given name must never survive onto the tag.
func TestShortenPassengerNameDropsEverythingBetween(t *testing.T) {
	got := ShortenPassengerName("Mary Nyambura Wanjiku Kamau")
	if got != "KAMAU M." {
		t.Fatalf("only the surname and a leading initial may survive, got %q", got)
	}
}

func TestValidClaimMethods(t *testing.T) {
	// OVERRIDE is deliberately a first-class method rather than a
	// failure: refusing it would not stop a crew member handing a bag
	// over without its stub, it would only stop the handover being
	// recorded — which is strictly worse. See ClaimLuggage.
	for _, m := range []string{"STUB_SCAN", "CODE_TYPED", "TICKET_MATCH", "OVERRIDE"} {
		if !validClaimMethods[m] {
			t.Errorf("%s must be an accepted claim method", m)
		}
	}
	for _, m := range []string{"", "stub_scan", "GUESS", "FORCE"} {
		if validClaimMethods[m] {
			t.Errorf("%q must not be an accepted claim method", m)
		}
	}
}

// maxPieces guards a tap-and-hold "+" button, not a passenger's right
// to carry luggage. If it ever starts reading as a policy limit, the
// answer is the parcel domain, not a bigger number here.
func TestMaxPiecesIsAFatFingerGuardNotAPolicy(t *testing.T) {
	if maxPieces < 10 {
		t.Fatalf("maxPieces = %d is low enough to refuse a real family's luggage", maxPieces)
	}
	if maxPieces > 50 {
		t.Fatalf("maxPieces = %d no longer guards anything", maxPieces)
	}
}
