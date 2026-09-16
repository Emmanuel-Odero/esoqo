package phone

import "testing"

// TestNormaliseAcceptsEveryFormAKenyanTypes — the whole point of the
// package. All four of these are the same human, and must come out as
// one string, because that string is their identity (see the package
// comment).
func TestNormaliseAcceptsEveryFormAKenyanTypes(t *testing.T) {
	for _, raw := range []string{
		"+254712345678",
		"254712345678",
		"0712345678",
		"712345678",
		"0712 345 678",
		"+254-712-345-678",
		"(0712) 345678",
		"  0712345678  ",
	} {
		got, ok := Normalise(raw)
		if !ok {
			t.Errorf("Normalise(%q) rejected a valid Kenyan number", raw)
			continue
		}
		if got != "+254712345678" {
			t.Errorf("Normalise(%q) = %q, want +254712345678", raw, got)
		}
	}

	// The 01x range is a real Kenyan mobile range, not a typo.
	if got, ok := Normalise("0110345678"); !ok || got != "+254110345678" {
		t.Errorf("Normalise(0110345678) = %q, %v; want +254110345678, true", got, ok)
	}
}

func TestNormaliseRejectsWhatIsNotAKenyanMobile(t *testing.T) {
	for _, raw := range []string{
		"",
		"   ",
		"0812345678",     // 08x is not a mobile range
		"071234567",      // one digit short
		"07123456789",    // one digit too long
		"+255712345678",  // Tanzania
		"+254712345678x", // trailing junk — a typo, and truncating it
		"not a number",   // would route someone else's OTP
		"0712345678 or 0722000111",
	} {
		if got, ok := Normalise(raw); ok {
			t.Errorf("Normalise(%q) = %q, accepted something that isn't a Kenyan mobile", raw, got)
		}
	}
}

// TestNormaliseIsIdempotent — an already-stored number re-submitted
// (an edit form round-trip) must not drift.
func TestNormaliseIsIdempotent(t *testing.T) {
	once, _ := Normalise("0712345678")
	twice, ok := Normalise(once)
	if !ok || twice != once {
		t.Errorf("re-normalising %q gave %q (ok=%v)", once, twice, ok)
	}
}

func TestNormaliseInPlace(t *testing.T) {
	v := "0712345678"
	if !NormaliseInPlace(&v) || v != "+254712345678" {
		t.Errorf("NormaliseInPlace left %q", v)
	}

	// Left untouched on failure so the error message can quote back what
	// the user actually typed.
	bad := "nonsense"
	if NormaliseInPlace(&bad) {
		t.Error("NormaliseInPlace accepted nonsense")
	}
	if bad != "nonsense" {
		t.Errorf("NormaliseInPlace mangled an invalid input to %q", bad)
	}

	if NormaliseInPlace(nil) {
		t.Error("NormaliseInPlace(nil) should report failure, not panic or pass")
	}
}

// TestNormaliseOptionalTreatsAbsenceAsFine — an optional field that
// wasn't supplied must not manufacture a validation error, or every
// caller that legitimately omits it starts failing.
func TestNormaliseOptionalTreatsAbsenceAsFine(t *testing.T) {
	var absent *string
	if !NormaliseOptional(&absent) || absent != nil {
		t.Error("a nil optional msisdn should pass through untouched")
	}

	blank := "   "
	p := &blank
	if !NormaliseOptional(&p) {
		t.Error("a whitespace-only optional msisdn should pass as 'not supplied'")
	}

	supplied := "0712345678"
	sp := &supplied
	if !NormaliseOptional(&sp) || *sp != "+254712345678" {
		t.Errorf("a supplied optional msisdn should normalise, got %q", *sp)
	}

	// Supplied but wrong is still an error — a half-typed number is a
	// mistake worth surfacing, not worth storing.
	bad := "0812345678"
	bp := &bad
	if NormaliseOptional(&bp) {
		t.Error("a supplied-but-invalid optional msisdn should fail")
	}
}
