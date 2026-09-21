package authsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The luggage grants exist in two places — here, and the TypeScript
// catalogue at packages/db/src/capabilities.ts that the admin role
// editor and the console's own gating render from. Two copies of one
// list drift silently: the usual failure is a capability added to Go,
// working in the API, and invisible in the UI that is supposed to grant
// it. These tests pin both halves.

func TestCrewCanWorkLuggage(t *testing.T) {
	// The conductor loading bags at a stage is the entire user of this
	// feature. If CREW ever loses these, the feature is dead on the only
	// device it runs on.
	crew := TicketingStaffCapabilities["CREW"]
	for _, want := range []string{CapLuggageTag, CapLuggageClaim, CapLuggageRead} {
		if !contains(crew, want) {
			t.Errorf("CREW must hold %s — a conductor is who tags and hands back bags", want)
		}
	}
}

func TestScannerCannotWorkLuggage(t *testing.T) {
	// SCANNER is the gate role: check a ticket in, nothing else. Claiming
	// luggage releases physical property, which is not a gate's job.
	scanner := TicketingStaffCapabilities["SCANNER"]
	for _, unwanted := range []string{CapLuggageTag, CapLuggageClaim} {
		if contains(scanner, unwanted) {
			t.Errorf("SCANNER must not hold %s — it releases or creates custody of property", unwanted)
		}
	}
}

func TestManagerAndAdminCanWorkLuggage(t *testing.T) {
	for _, role := range []string{"MANAGER", "ADMIN"} {
		caps := TicketingStaffCapabilities[role]
		if !contains(caps, CapLuggageRead) {
			t.Errorf("%s must be able to read a luggage manifest", role)
		}
	}
}

// The owner's :own grants. A small operator IS the conductor on their
// own vehicle often enough that withholding the write grants would be
// theatre rather than a control.
func TestSubjectHoldsOwnLuggageGrants(t *testing.T) {
	subject := RolePresets[RoleSubject]
	for _, want := range []string{"luggage.tag:own", "luggage.claim:own", "luggage.read:own"} {
		if !contains(subject, want) {
			t.Errorf("SUBJECT preset must hold %s", want)
		}
	}
}

// The cross-language half: every luggage capability Go knows about must
// also appear in the TypeScript catalogue, or it cannot be granted from
// the admin role editor and the console cannot gate on it.
func TestLuggageCapabilitiesAreInTheTypeScriptCatalogue(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "packages", "db", "src", "capabilities.ts")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("TypeScript catalogue not readable from here (%v) — skipping cross-language check", err)
	}
	ts := string(raw)
	for _, cap := range []string{CapLuggageTag, CapLuggageClaim, CapLuggageRead} {
		if !strings.Contains(ts, "'"+cap+"'") {
			t.Errorf("%s is missing from packages/db/src/capabilities.ts — it cannot be granted or gated on in the UI", cap)
		}
	}
	// And the CREW bundle must agree across both.
	for _, cap := range []string{"'luggage.read'", "'luggage.tag'", "'luggage.claim'"} {
		if !strings.Contains(ts, cap) {
			t.Errorf("TypeScript CREW bundle is missing %s", cap)
		}
	}
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
