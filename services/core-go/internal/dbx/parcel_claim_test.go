package dbx

import "testing"

// The comparison that decides whether someone holding a tracking code
// gets shown a name and an address. A false positive here hands a
// stranger a stranger's details.

func TestConstantTimeEqualMatchesOnlyExactly(t *testing.T) {
	const real = "+254712345678"

	if !constantTimeEqual(real, real) {
		t.Error("a number must match itself, or no genuine party can ever claim their parcel")
	}

	for _, other := range []string{
		"+254712345679", // last digit off
		"+254712345677",
		"+254712345670",
		"+254812345678", // a different network, same tail
	} {
		if constantTimeEqual(real, other) {
			t.Errorf("constantTimeEqual(%q, %q) matched; a near miss is still a different person", real, other)
		}
	}
}

// A prefix must never match. Without the length guard, a comparison
// that stopped at the shorter string would let "+2547" claim every
// Safaricom number on the platform.
func TestConstantTimeEqualRejectsPrefixes(t *testing.T) {
	const real = "+254712345678"
	for _, prefix := range []string{"+2547", "+254712345", "+254712345678 ", "+254712345678\n"} {
		if constantTimeEqual(real, prefix) {
			t.Errorf("constantTimeEqual(%q, %q) matched; a prefix or padded form is not the number", real, prefix)
		}
	}
}

// Empty is never a party. A parcel with a blank stored number must not
// be claimable by someone submitting a blank one — that would make
// every incompletely-recorded parcel world-readable.
func TestConstantTimeEqualRejectsEmpty(t *testing.T) {
	if constantTimeEqual("", "") {
		t.Error("two blanks matched; a parcel missing a stored number must not be claimable by submitting nothing")
	}
	if constantTimeEqual("+254712345678", "") {
		t.Error("a blank submission matched a real number")
	}
	if constantTimeEqual("", "+254712345678") {
		t.Error("a real number matched a blank stored value")
	}
}

// last4 is what a verified party sees of their counterparty's number.
// It must never return the whole thing, and must not panic on the short
// or malformed values a free-text contact field can hold.
func TestLast4(t *testing.T) {
	if got := last4("+254712345678"); got != "5678" {
		t.Errorf("last4 = %q, want \"5678\"", got)
	}
	// Anything too short to have four digits yields nothing rather than
	// leaking what little there is.
	for _, short := range []string{"", "7", "78", "678"} {
		if got := last4(short); got != "" {
			t.Errorf("last4(%q) = %q, want empty", short, got)
		}
	}
	if got := last4("5678"); got != "5678" {
		t.Errorf("last4 of an exactly-4 value = %q, want \"5678\"", got)
	}
}
