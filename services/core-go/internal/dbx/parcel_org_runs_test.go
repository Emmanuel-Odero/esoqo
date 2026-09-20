package dbx

import "testing"

// Crew roles are display text, never capabilities — so the sanitizer's
// contract is "never fail a save, always render something sensible".
func TestSanitizeDispatchRoleKeepsKnownRoles(t *testing.T) {
	for _, role := range []string{"DRIVER", "TOUT", "LOADER", "driver", " tout "} {
		got, custom := sanitizeRunRole(role, "")
		if custom != nil {
			t.Errorf("sanitizeRunRole(%q) set a custom title %q, want nil", role, *custom)
		}
		switch got {
		case RunRoleDriver, RunRoleTout, RunRoleLoader:
		default:
			t.Errorf("sanitizeRunRole(%q) = %q, want a known role", role, got)
		}
	}
}

func TestSanitizeDispatchRoleFoldsUnknownToOther(t *testing.T) {
	got, custom := sanitizeRunRole("MECHANIC", "")
	if got != RunRoleOther {
		t.Errorf("sanitizeRunRole(MECHANIC) = %q, want OTHER", got)
	}
	if custom == nil || *custom != "MECHANIC" {
		t.Errorf("sanitizeRunRole(MECHANIC) custom = %v, want MECHANIC", custom)
	}

	// An explicit custom title wins over the raw role text.
	got, custom = sanitizeRunRole("OTHER", "Spare driver")
	if got != RunRoleOther || custom == nil || *custom != "Spare driver" {
		t.Errorf("sanitizeRunRole(OTHER, Spare driver) = %q, %v — lost the title", got, custom)
	}
}

func TestDispatchCrewRoleLabel(t *testing.T) {
	if got := RunCrewRoleLabel("DRIVER", ""); got != "Driver" {
		t.Errorf("label(DRIVER) = %q, want Driver", got)
	}
	if got := RunCrewRoleLabel("OTHER", "Mechanic"); got != "Mechanic" {
		t.Errorf("label(OTHER, Mechanic) = %q, want the custom title", got)
	}
	if got := RunCrewRoleLabel("OTHER", ""); got != "Crew" {
		t.Errorf("label(OTHER, empty) = %q, want the Crew fallback", got)
	}
}
