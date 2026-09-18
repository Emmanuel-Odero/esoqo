package dbx

import "testing"

// Crew roles are display text, never capabilities — so the sanitizer's
// contract is "never fail a save, always render something sensible".
func TestSanitizeDispatchRoleKeepsKnownRoles(t *testing.T) {
	for _, role := range []string{"DRIVER", "TOUT", "LOADER", "driver", " tout "} {
		got, custom := sanitizeDispatchRole(role, "")
		if custom != nil {
			t.Errorf("sanitizeDispatchRole(%q) set a custom title %q, want nil", role, *custom)
		}
		switch got {
		case DispatchRoleDriver, DispatchRoleTout, DispatchRoleLoader:
		default:
			t.Errorf("sanitizeDispatchRole(%q) = %q, want a known role", role, got)
		}
	}
}

func TestSanitizeDispatchRoleFoldsUnknownToOther(t *testing.T) {
	got, custom := sanitizeDispatchRole("MECHANIC", "")
	if got != DispatchRoleOther {
		t.Errorf("sanitizeDispatchRole(MECHANIC) = %q, want OTHER", got)
	}
	if custom == nil || *custom != "MECHANIC" {
		t.Errorf("sanitizeDispatchRole(MECHANIC) custom = %v, want MECHANIC", custom)
	}

	// An explicit custom title wins over the raw role text.
	got, custom = sanitizeDispatchRole("OTHER", "Spare driver")
	if got != DispatchRoleOther || custom == nil || *custom != "Spare driver" {
		t.Errorf("sanitizeDispatchRole(OTHER, Spare driver) = %q, %v — lost the title", got, custom)
	}
}

func TestDispatchCrewRoleLabel(t *testing.T) {
	if got := DispatchCrewRoleLabel("DRIVER", ""); got != "Driver" {
		t.Errorf("label(DRIVER) = %q, want Driver", got)
	}
	if got := DispatchCrewRoleLabel("OTHER", "Mechanic"); got != "Mechanic" {
		t.Errorf("label(OTHER, Mechanic) = %q, want the custom title", got)
	}
	if got := DispatchCrewRoleLabel("OTHER", ""); got != "Crew" {
		t.Errorf("label(OTHER, empty) = %q, want the Crew fallback", got)
	}
}
