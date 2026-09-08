package dbx

import "testing"

// crewOwnsTrip is the actual authorisation decision behind
// trip.close:own (see CloseTrip) — a CREW AGENT session may close a
// trip only if it's the one it's driving/conducting. No live Postgres
// pool needed; every other CloseTrip codepath is pool-backed and left
// for an integration-test pass once this package has one.
func TestCrewOwnsTrip(t *testing.T) {
	driver := "crew-1"
	conductor := "crew-2"
	other := "crew-3"

	cases := []struct {
		name         string
		crewMemberID string
		driverID     *string
		conductorID  *string
		want         bool
	}{
		{"driver matches", driver, &driver, &conductor, true},
		{"conductor matches", conductor, &driver, &conductor, true},
		{"neither matches — a different crew member entirely", other, &driver, &conductor, false},
		{"no crewMemberId linked at all — fails closed, not open", "", &driver, &conductor, false},
		{"trip has no driver/conductor assigned yet", driver, nil, nil, false},
		{"driver assigned, conductor slot empty", driver, &driver, nil, true},
		{"conductor assigned, driver slot empty", conductor, nil, &conductor, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := crewOwnsTrip(tc.crewMemberID, tc.driverID, tc.conductorID)
			if got != tc.want {
				t.Errorf("crewOwnsTrip(%q, %v, %v) = %v, want %v",
					tc.crewMemberID, deref(tc.driverID), deref(tc.conductorID), got, tc.want)
			}
		})
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

// validTripEndStatus — the enum guard in front of the TripEndStatus
// column, checked in Go before the write reaches Postgres so a bad
// value comes back as a clean 400 (FleetError BAD_INPUT) instead of a
// raw database error surfacing through the API.
func TestValidTripEndStatus(t *testing.T) {
	for _, ok := range []string{"OK", "NEEDS_FUEL", "NEEDS_REPAIR"} {
		if !validTripEndStatus[ok] {
			t.Errorf("expected %q to be a valid TripEndStatus", ok)
		}
	}
	for _, bad := range []string{"", "ok", "needs_fuel", "BROKEN", "NEEDS_FUEL "} {
		if validTripEndStatus[bad] {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}
