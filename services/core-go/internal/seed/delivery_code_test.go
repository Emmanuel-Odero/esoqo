package seed

import (
	"fmt"
	"strings"
	"testing"
)

// The showcase seed's delivery code is a credential and is now unique
// across the whole table, so the derivation has two obligations that
// pull against each other: it must not collide (a collision aborts the
// seed on the unique index), and it must be stable (a code that changes
// on every re-seed invalidates whatever demo label shows it). These tests
// pin both.

// Every derived code has to be exactly six digits, or DeliverParcel's
// numeric comparison stops matching it.
func TestShowcaseDeliveryCodeIsSixDigits(t *testing.T) {
	for _, code := range []string{"PKG-DEMO-101", "PKG-ESHIP-101", "PKG-ESHIP-122", "PKG-PROD-999"} {
		got := fmt.Sprintf("%06d", showcaseDeliveryCodeBase(code))
		if len(got) != 6 {
			t.Errorf("code for %s = %q (%d digits), want 6", code, got, len(got))
		}
		for _, r := range got {
			if r < '0' || r > '9' {
				t.Errorf("code for %s = %q, contains a non-digit", code, got)
				break
			}
		}
	}
}

// The same parcel code must always derive the same digits. Re-seeding is
// an upsert on parcel code, so a drifting derivation would rewrite the
// delivery code of a parcel a demo receiver may already have been given.
func TestShowcaseDeliveryCodeIsStable(t *testing.T) {
	first := showcaseDeliveryCodeBase("PKG-DEMO-101")
	for i := 0; i < 100; i++ {
		if got := showcaseDeliveryCodeBase("PKG-DEMO-101"); got != first {
			t.Fatalf("derivation is not stable: got %d then %d", first, got)
		}
	}
}

// The two seeded orgs re-point the same templates at different parcel
// codes. If the derivation ignored the prefix they would share codes,
// which is the exact twin collision the unique index exists to prevent.
func TestShowcaseDeliveryCodeDiffersPerOrg(t *testing.T) {
	for _, n := range []string{"101", "107", "114", "122"} {
		demo := showcaseDeliveryCodeBase("PKG-DEMO-" + n)
		eship := showcaseDeliveryCodeBase("PKG-ESHIP-" + n)
		if demo == eship {
			t.Errorf("template %s: both orgs derive %d", n, demo)
		}
	}
}

// A hash is not injective, so the walk has to be what actually
// guarantees uniqueness. Point every candidate at "taken" and the walk
// must keep stepping rather than returning a duplicate.
func TestWalkStepsPastATakenCode(t *testing.T) {
	const parcelCode = "PKG-DEMO-101"
	base := showcaseDeliveryCodeBase(parcelCode)

	// The first three candidates are occupied; the fourth is free.
	blocked := map[string]bool{
		fmt.Sprintf("%06d", base%showcaseDeliveryCodeSpace):     true,
		fmt.Sprintf("%06d", (base+1)%showcaseDeliveryCodeSpace): true,
		fmt.Sprintf("%06d", (base+2)%showcaseDeliveryCodeSpace): true,
	}
	got, free, err := walkShowcaseDeliveryCode(parcelCode, map[string]bool{}, func(code string) (bool, error) {
		return blocked[code], nil
	})
	if err != nil {
		t.Fatalf("walk returned an error: %v", err)
	}
	if !free {
		t.Fatal("walk gave up although a free code existed three probes on")
	}
	want := fmt.Sprintf("%06d", (base+3)%showcaseDeliveryCodeSpace)
	if got != want {
		t.Errorf("walk chose %q, want %q", got, want)
	}
}

// A row inserted earlier in this same seed run is not yet visible to the
// next reserve call's database check in a way that can be relied on, so
// the handed set is the only thing preventing two parcels in one pass
// from being given the same code.
func TestWalkRespectsCodesHandedOutThisRun(t *testing.T) {
	const parcelCode = "PKG-ESHIP-122"
	base := showcaseDeliveryCodeBase(parcelCode)

	handed := map[string]bool{fmt.Sprintf("%06d", base%showcaseDeliveryCodeSpace): true}
	// The database says the next code is free — it is, this parcel just
	// has not been written yet.
	got, free, err := walkShowcaseDeliveryCode(parcelCode, handed, func(string) (bool, error) {
		return false, nil
	})
	if err != nil {
		t.Fatalf("walk returned an error: %v", err)
	}
	if !free {
		t.Fatal("walk gave up although a free code existed")
	}
	if got == fmt.Sprintf("%06d", base%showcaseDeliveryCodeSpace) {
		t.Error("walk handed back a code already given to another parcel this run")
	}
}

// Exhausting the probe budget must fail loudly. Silently returning a
// taken code would either abort the seed on the unique index or, worse,
// hand two parcels the same credential.
func TestWalkFailsRatherThanRepeatingACode(t *testing.T) {
	_, free, err := walkShowcaseDeliveryCode("PKG-DEMO-114", map[string]bool{}, func(string) (bool, error) {
		return true, nil // everything is occupied
	})
	if err != nil {
		t.Fatalf("walk returned an error: %v", err)
	}
	if free {
		t.Error("walk claimed a free code from a table with none free")
	}
}

// The walk steps forward with modular arithmetic, so a parcel whose base
// sits at the very top of the space must wrap to 000000 rather than
// produce an eight-digit code. This is reached by probing, not by the
// base landing there, which no fixed parcel code can be relied on to do.
func TestCandidateWrapsWithinSixDigits(t *testing.T) {
	last := showcaseDeliveryCodeSpace - 1
	if got := showcaseDeliveryCodeAt(last, 0); got != "999999" {
		t.Errorf("candidate at the top of the space = %q, want 999999", got)
	}
	if got := showcaseDeliveryCodeAt(last, 1); got != "000000" {
		t.Errorf("candidate past the top of the space = %q, want 000000", got)
	}
	// And it must stay six digits at the seam rather than trimming or
	// growing.
	if got := showcaseDeliveryCodeAt(last, 2); got != "000001" {
		t.Errorf("candidate two past the top = %q, want 000001", got)
	}
}

// The whole point of deriving from the parcel code is that a template
// seeded under two orgs produces two codes. Check it across the real
// template set rather than a hand-picked pair.
func TestShowcaseTemplatesDeriveDistinctCodesPerOrg(t *testing.T) {
	seen := map[string]string{}
	for _, p := range showcaseParcels {
		for _, prefix := range []string{"PKG-DEMO-", "PKG-ESHIP-"} {
			code := strings.Replace(p.code, "PKG-DEMO-", prefix, 1)
			got := fmt.Sprintf("%06d", showcaseDeliveryCodeBase(code))
			if prev, dup := seen[got]; dup {
				t.Errorf("%s and %s both derive %s", prev, code, got)
			}
			seen[got] = code
		}
	}
}