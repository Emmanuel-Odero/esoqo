package dbx

import "testing"

func TestNormalizePurpose(t *testing.T) {
	cases := map[string]string{
		"fuel":    "FUEL",
		"Fuel":    "FUEL",
		"travel":  "TRAVEL",
		"Travel":  "TRAVEL",
		"FUEL":    "FUEL",
		"GENERAL": "GENERAL",
		"":        "",
	}
	for in, want := range cases {
		if got := normalizePurpose(in); got != want {
			t.Errorf("normalizePurpose(%q) = %q, want %q", in, got, want)
		}
	}
}
