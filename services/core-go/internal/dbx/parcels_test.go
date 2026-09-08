package dbx

import "testing"

func TestNextHandoffStatus(t *testing.T) {
	cases := map[string]string{
		"BOOKED":     "PICKED_UP",
		"PICKED_UP":  "IN_TRANSIT",
		"IN_TRANSIT": "IN_TRANSIT",
	}
	for in, want := range cases {
		if got := nextHandoffStatus(in); got != want {
			t.Errorf("nextHandoffStatus(%q) = %q, want %q", in, got, want)
		}
	}
}
