package authsvc

import "testing"

// TestParcelStaffCapabilitiesForRole pins the role→bundle mapping that
// gates the courier-company console.
//
// The RIDER floor for unrecognised titles is deliberate (an invented
// label must never widen access). What this guards is the other half:
// the owner titles a company actually types — CEO, Owner — must resolve
// to the MANAGER bundle, or a founder signs in with rider access and
// can't see their own team, pricing or earnings.
func TestParcelStaffCapabilitiesForRole(t *testing.T) {
	contains := func(caps []string, want string) bool {
		for _, c := range caps {
			if c == want {
				return true
			}
		}
		return false
	}

	if got := ParcelStaffCapabilitiesForRole("MANAGER", nil); !contains(got, CapParcelOrgWrite) {
		t.Errorf("MANAGER should be able to write, got %v", got)
	}
	if got := ParcelStaffCapabilitiesForRole("RIDER", nil); contains(got, CapParcelOrgWrite) {
		t.Errorf("RIDER must not be able to write, got %v", got)
	}

	// Case/whitespace-insensitive, and every owner title maps to MANAGER.
	for _, role := range []string{"CEO", "ceo", " Owner ", "Founder", "Director", "Proprietor", "admin"} {
		got := ParcelStaffCapabilitiesForRole(role, nil)
		if !contains(got, CapParcelOrgWrite) {
			t.Errorf("owner title %q should map to the full bundle, got %v", role, got)
		}
	}

	if got := ParcelStaffCapabilitiesForRole("CHIEF VIBES OFFICER", nil); contains(got, CapParcelOrgWrite) {
		t.Errorf("an invented title must still floor at RIDER, got %v", got)
	}

	// A caller mutating the result must not corrupt the shared preset.
	got := ParcelStaffCapabilitiesForRole("MANAGER", nil)
	got[0] = "mutated"
	if again := ParcelStaffCapabilitiesForRole("MANAGER", nil); again[0] == "mutated" {
		t.Error("ParcelStaffCapabilitiesForRole returned the shared slice, not a copy")
	}
}

// TestParcelStaffCapabilitiesOverride covers the custom-role path: a
// hand-picked permission set replaces the role bundle, and the filter
// against AllParcelOrgCapabilities is what keeps a custom role from
// granting anything outside the parcel domain.
func TestParcelStaffCapabilitiesOverride(t *testing.T) {
	contains := func(caps []string, want string) bool {
		for _, c := range caps {
			if c == want {
				return true
			}
		}
		return false
	}

	// Explicit permissions win over the role name entirely.
	got := ParcelStaffCapabilitiesForRole("RIDER", []string{CapParcelOrgCollection, CapParcelOrgRead})
	if !contains(got, CapParcelOrgCollection) {
		t.Errorf("explicit capability dropped: %v", got)
	}
	if contains(got, CapParcelOrgCarry) {
		t.Errorf("role bundle leaked into explicit override: %v", got)
	}

	// Unknown/foreign/duplicate strings are stripped, order canonicalised.
	cleaned := SanitizeParcelCapabilities([]string{
		"*", "store.write:own", CapParcelOrgEarnings, CapParcelOrgEarnings, CapParcelOrgRead,
	})
	if len(cleaned) != 2 || cleaned[0] != CapParcelOrgRead || cleaned[1] != CapParcelOrgEarnings {
		t.Errorf("sanitize should keep only the two known caps in order, got %v", cleaned)
	}

	// Nothing valid -> nil, so the role fallback still applies.
	if cleaned := SanitizeParcelCapabilities([]string{"*", "ticketorg.write:own"}); cleaned != nil {
		t.Errorf("all-invalid input should return nil, got %v", cleaned)
	}
}
