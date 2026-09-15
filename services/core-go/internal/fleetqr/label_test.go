package fleetqr

import "testing"

const testSecret = "test-secret-not-a-real-one"

func TestSignLabelIsDeterministicAndScoped(t *testing.T) {
	a := SignLabel(testSecret, "PKG-ABC12X", "org-1", "batch-1")
	b := SignLabel(testSecret, "PKG-ABC12X", "org-1", "batch-1")
	if a != b {
		t.Fatalf("same inputs gave different signatures: %q vs %q", a, b)
	}
	if len(a) != LabelSigLength {
		t.Errorf("signature length = %d, want %d — the QR's density budget depends on this", len(a), LabelSigLength)
	}
	// A different secret must not produce our signature, or the whole
	// thing is decoration.
	if SignLabel("some-other-secret", "PKG-ABC12X", "org-1", "batch-1") == a {
		t.Error("a different secret produced the same signature")
	}
}

// Every signed field must actually change the signature. If one didn't,
// a label could be re-attributed to another company or batch while
// still verifying.
func TestSignLabelCoversEveryField(t *testing.T) {
	base := SignLabel(testSecret, "PKG-ABC12X", "org-1", "batch-1")
	for _, v := range []struct {
		what             string
		code, org, batch string
	}{
		{"code", "PKG-ZZZ99Y", "org-1", "batch-1"},
		{"org", "PKG-ABC12X", "org-2", "batch-1"},
		{"batch", "PKG-ABC12X", "org-1", "batch-2"},
	} {
		if SignLabel(testSecret, v.code, v.org, v.batch) == base {
			t.Errorf("changing the %s did not change the signature", v.what)
		}
	}
}

// The field separator must genuinely separate. Without it, ("ab","c")
// and ("a","bc") would sign identically and a code could be shifted
// into the org field.
func TestSignLabelFieldsCannotBeShifted(t *testing.T) {
	if SignLabel(testSecret, "AB", "C", "") == SignLabel(testSecret, "A", "BC", "") {
		t.Error("adjacent fields are ambiguous; the separator is not doing its job")
	}
}

func TestVerifyLabelAcceptsOnlyTheRealThing(t *testing.T) {
	sig := SignLabel(testSecret, "PKG-ABC12X", "org-1", "batch-1")
	if !VerifyLabel(testSecret, "PKG-ABC12X", "org-1", "batch-1", sig) {
		t.Error("a genuine signature failed to verify")
	}
	// Case-insensitive: the value survives being read off paper and
	// retyped, or upper-cased by a scanner.
	if !VerifyLabel(testSecret, "PKG-ABC12X", "org-1", "batch-1", upper(sig)) {
		t.Error("an upper-cased signature failed; codes get retyped off paper")
	}
	// A forgery, a truncation, and a signature for a different parcel.
	for _, bad := range []string{
		"0000000000", sig[:len(sig)-1], sig + "a",
		SignLabel(testSecret, "PKG-OTHER1", "org-1", "batch-1"),
	} {
		if VerifyLabel(testSecret, "PKG-ABC12X", "org-1", "batch-1", bad) {
			t.Errorf("VerifyLabel accepted %q", bad)
		}
	}
}

// Absent is not the same as wrong, and the distinction is load-bearing:
// every label printed before signing existed carries no k= at all, and
// a hand-typed code never will. Those must fall back to the database,
// not render "this is a forgery".
func TestVerifyLabelTreatsAbsentAsUnverified(t *testing.T) {
	if VerifyLabel(testSecret, "PKG-ABC12X", "org-1", "batch-1", "") {
		t.Error("an empty signature verified; absent must never read as valid")
	}
}

// The shared Esoqo pool has no owning org, and pre-batch stock has no
// batch. Both are legitimate and must still sign and verify.
func TestSignLabelHandlesUnownedStock(t *testing.T) {
	sig := SignLabel(testSecret, "PKG-ABC12X", "", "")
	if !VerifyLabel(testSecret, "PKG-ABC12X", "", "", sig) {
		t.Error("an unowned, pre-batch label could not verify its own signature")
	}
	// It must not collide with an owned label of the same code.
	if sig == SignLabel(testSecret, "PKG-ABC12X", "org-1", "") {
		t.Error("unowned and owned labels of the same code signed identically")
	}
}

func upper(s string) string {
	out := []byte(s)
	for i, c := range out {
		if c >= 'a' && c <= 'f' {
			out[i] = c - 32
		}
	}
	return string(out)
}
