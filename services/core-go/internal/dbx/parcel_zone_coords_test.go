package dbx

import (
	"testing"
	"time"
)

// A zone's lat/lng is the origin every price and every "same
// neighbourhood" sort is measured from, so an off-globe one doesn't fail
// — it quietly quotes nonsense and sorts wrong, invisibly. Decimal(9,6)
// accepts 900.000000 happily, so the column is not the check.

func TestValidateZoneCoordsAcceptsRealPlaces(t *testing.T) {
	// Nairobi and its antipode-ish extremes, the poles, the
	// antimeridian, and 0,0 — which is a real coordinate (Gulf of
	// Guinea) and must not be rejected just because it looks like a
	// missing value. Note ParcelAgentInput rejects 0,0 separately for
	// its own reason; this function must not.
	cases := []struct {
		name     string
		lat, lng float64
	}{
		{"nairobi", -1.2921, 36.8219},
		{"north pole", 90, 0},
		{"south pole", -90, 0},
		{"antimeridian east", 0, 180},
		{"antimeridian west", 0, -180},
		{"null island", 0, 0},
		{"precision edge", -89.999999, 179.999999},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateZoneCoords(tc.lat, tc.lng); err != nil {
				t.Errorf("validateZoneCoords(%v, %v) = %v, want nil", tc.lat, tc.lng, err)
			}
		})
	}
}

func TestValidateZoneCoordsRejectsOffGlobe(t *testing.T) {
	cases := []struct {
		name     string
		lat, lng float64
	}{
		{"latitude past the pole", 90.000001, 0},
		{"latitude backwards", -90.000001, 0},
		{"latitude typed as a percentage", 900, 0},
		{"longitude past the antimeridian", 0, 180.000001},
		{"longitude backwards", 0, -180.000001},
		{"both absurd", 1000, 1000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateZoneCoords(tc.lat, tc.lng)
			if err == nil {
				t.Fatalf("validateZoneCoords(%v, %v) = nil, want a rejection", tc.lat, tc.lng)
			}
			if err.Code != "BAD_INPUT" {
				t.Errorf("Code = %q, want BAD_INPUT", err.Code)
			}
		})
	}
}

// Known limitation, pinned so nobody "fixes" it by assuming it's covered:
// a transposed pair is NOT caught. Lat and lng ranges overlap almost
// entirely, so (36.82, -1.29) — Nairobi with the fields the wrong way
// round — is a perfectly valid coordinate in Spain and passes. Only a
// plausibility check against where the platform actually operates could
// reject it, and that would refuse legitimate zones the day the platform
// expands. The map on the admin screen is the real defence against this
// class of typo; range validation only rules out the values that are not
// on the globe at all.
func TestValidateZoneCoordsCannotCatchTransposedPairs(t *testing.T) {
	if err := validateZoneCoords(36.8219, -1.2921); err != nil {
		t.Errorf("validateZoneCoords(36.8219, -1.2921) = %v, want nil — documented limitation: a swap is in range and undetectable here", err)
	}
}

// The boundary is inclusive, and off-by-one here is a support ticket
// about a shop in Mombasa that "won't save".
func TestValidateZoneCoordsBoundaryIsInclusive(t *testing.T) {
	if err := validateZoneCoords(90, 180); err != nil {
		t.Errorf("(90, 180) = %v, want nil — the boundary itself is a real place", err)
	}
	if err := validateZoneCoords(-90, -180); err != nil {
		t.Errorf("(-90, -180) = %v, want nil", err)
	}
}

// DeliveryCodeThrottle exists so a spent allowance can't be waited out
// between bursts. Pin it to a duration that actually does that: if this
// ever drops below the window a courier's own round takes, the lock
// expires between two of their own attempts and the throttle is theatre.
func TestDeliveryCodeThrottleOutlastsARound(t *testing.T) {
	if DeliveryCodeThrottle < 4*time.Hour {
		t.Errorf("DeliveryCodeThrottle = %v, want at least 4h so the lock survives a courier's own round", DeliveryCodeThrottle)
	}
}
