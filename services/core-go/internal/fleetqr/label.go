package fleetqr

import "strings"

// Signing a printed parcel label.
//
// A label is the one artefact this system puts into the world on
// adhesive. It travels in the open, gets photographed, and is trivial
// to photocopy — so a lookalike sticker printed by anyone is otherwise
// indistinguishable from ours, both on the box and on the page someone
// lands on after scanning it.
//
// What the signature is NOT: authorisation. The database decides
// whether a code may be booked, who owns the stock, and whether the pad
// was withdrawn (see dbx.BookParcel's existingCode path). This adds
// three things that check cannot:
//
//   - a forgery fails offline, at the scanner, before any request is
//     made, so mass-printed lookalikes never reach our infrastructure;
//   - a printed sticker becomes verifiable as genuinely ours by a
//     member of the public holding a phone, which is a consumer-facing
//     trust claim rather than only an internal control;
//   - the failure is loud. An invalid signature renders an explicit
//     "this is not a genuine label" page rather than a tracking page,
//     which makes counterfeiting our labels actively counterproductive.

// LabelSigScope namespaces the HMAC so a label signature can never be
// replayed as a trip or voucher one — they share a secret.
const LabelSigScope = "parcel-label"

// LabelSigLength — how much of the hex MAC is printed.
//
// 10 hex chars is 40 bits. Short enough to keep the QR's module count
// down (it has to stay scannable at 32mm from a phone held by someone
// who is not being careful), long enough that forging one is not worth
// anybody's afternoon — and the signature is only ever a fast pre-check
// in front of a database that makes the real decision.
const LabelSigLength = 10

// SignLabel returns the truncated MAC printed on a label as `k=`.
//
// Bound to the owning company and the batch, not just the code, so the
// signature also carries *which pad this came off* — a stolen batch's
// labels remain individually well-formed, which is correct: they are
// genuine labels, and it is the database that knows they were
// withdrawn. Signing the batch means a future offline scanner could
// hold a small recall list rather than needing the whole code space.
//
// Empty orgID and batchID are legitimate (the shared Esoqo pool,
// pre-batch stock) and are signed as empty rather than skipped, so the
// field separator still pins each value's position.
func SignLabel(secret, code, orgID, batchID string) string {
	sig := Sign(secret, LabelSigScope, strings.Join([]string{code, orgID, batchID}, "|"))
	if len(sig) < LabelSigLength {
		return sig
	}
	return sig[:LabelSigLength]
}

// VerifyLabel checks a printed `k=` against what the code, owner and
// batch should produce.
//
// An empty sig is NOT a failure — it returns false, and callers treat
// absent and wrong differently on purpose. Codes are typed by hand off
// the printed text and read aloud down phone lines, and every label
// printed before signing existed carries no `k=` at all. Absent means
// "unverifiable, fall back to the database"; wrong means "somebody
// made this up", and only the second deserves a red page.
func VerifyLabel(secret, code, orgID, batchID, sig string) bool {
	if sig == "" {
		return false
	}
	want := SignLabel(secret, code, orgID, batchID)
	// Compared through Verify's constant-time path by re-signing to full
	// length and truncating both sides identically — rather than a
	// string ==, which leaks how many leading characters matched.
	return constantTimeEqualHex(want, strings.ToLower(sig))
}

// constantTimeEqualHex compares two short hex strings without leaking
// their shared prefix length through timing.
func constantTimeEqualHex(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := 0; i < len(a); i++ {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}
