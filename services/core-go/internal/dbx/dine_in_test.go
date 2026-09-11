package dbx

import "testing"

// validDineInStatus is the enum guard in front of the DineInStatus
// column, checked in Go before the write reaches Postgres — same
// reasoning as validTripEndStatus in fleet_test.go.
func TestValidDineInStatus(t *testing.T) {
	for _, ok := range []string{"ORDERED", "PREPARING", "SERVED", "PAYING", "CLOSED"} {
		if !validDineInStatus[ok] {
			t.Errorf("expected %q to be a valid DineInStatus", ok)
		}
	}
	for _, bad := range []string{"", "ordered", "preparing", "DONE", "SERVED "} {
		if validDineInStatus[bad] {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}
