package fleetqr

import (
	"strings"
	"testing"
)

func TestShortCodeShape(t *testing.T) {
	code := ShortCode(PrefixBus)
	if !strings.HasPrefix(code, "BUS-") {
		t.Fatalf("expected BUS- prefix, got %q", code)
	}
	body := strings.TrimPrefix(code, "BUS-")
	if len(body) != 6 {
		t.Fatalf("expected 6 random chars, got %q", body)
	}
	for _, r := range body {
		if !strings.ContainsRune(Alphabet, r) {
			t.Fatalf("char %q not in alphabet", r)
		}
	}
}

func TestShortCodeLengthOverride(t *testing.T) {
	if got := ShortCode(PrefixTicket, 10); len(got) != 14 { // TKT- + 10
		t.Fatalf("expected length 14, got %q", got)
	}
}

func TestRandomSegmentUnbiasedAlphabet(t *testing.T) {
	for i := 0; i < 1000; i++ {
		seg := RandomSegment(20)
		if len(seg) != 20 {
			t.Fatalf("unexpected length %d", len(seg))
		}
		for _, r := range seg {
			if !strings.ContainsRune(Alphabet, r) {
				t.Fatalf("char %q outside alphabet", r)
			}
		}
	}
}

func TestWithCheckDeterministicAndSensitive(t *testing.T) {
	a := WithCheck("4F8K2Q")
	b := WithCheck("4F8K2Q")
	if a != b {
		t.Fatalf("checksum must be deterministic: %q vs %q", a, b)
	}
	// A single flipped character must change the check char.
	flipped := WithCheck("4F8K2R")
	if a == flipped {
		t.Fatalf("checksum must not survive a character flip")
	}
	// The check char must be in the alphabet and the code one char longer.
	if len(a) != 7 || !strings.ContainsRune(Alphabet, rune(a[6])) {
		t.Fatalf("bad checked code %q", a)
	}
}

func TestCheckedShape(t *testing.T) {
	if !CheckedShape(PrefixVoucher, ShortCodeChecked(PrefixVoucher, 6), 6) {
		t.Fatal("valid checked code must pass CheckedShape")
	}
	// Old unchecked shape (no check char) is not the checked shape, but
	// it also isn't a typo — it must still be resolvable downstream.
	old := "VCH-" + RandomSegment(6)
	if CheckedShape(PrefixVoucher, old, 6) {
		t.Fatal("unchecked code must not pass the checked-shape guard")
	}
	bad := ShortCodeChecked(PrefixVoucher, 6)
	corrupted := bad[:len(bad)-1] + flipChar(bad[len(bad)-1])
	if CheckedShape(PrefixVoucher, corrupted, 6) {
		t.Fatal("corrupted checksum must fail CheckedShape")
	}
}

func flipChar(c byte) string {
	idx := strings.IndexByte(Alphabet, c)
	if idx < 0 {
		return "A"
	}
	return string(Alphabet[(idx+1)%len(Alphabet)])
}

func TestPrefixRegistry(t *testing.T) {
	for _, p := range []Prefix{
		PrefixTrip, PrefixBus, PrefixVoucher, PrefixTicket, PrefixPickup,
		PrefixPaymentID, PrefixParcel, PrefixServiceTicket, PrefixLuggage,
	} {
		if !ValidPrefix(p) {
			t.Fatalf("prefix %q must be registered", p)
		}
	}
	if ValidPrefix("XYZ") {
		t.Fatal("unknown prefix must not validate")
	}
}

// A LUG- code is typed by hand off a paper stub more than any other
// code in the product, so its checksum is the difference between a
// mistyped character failing loudly at the scanner and a lookup that
// quietly finds nothing while a passenger waits.
func TestLuggageCodesAreCheckedShape(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		code := ShortCodeChecked(PrefixLuggage, LuggageCodeLen)
		if !CheckedShape(PrefixLuggage, code, LuggageCodeLen) {
			t.Fatalf("minted luggage code %q must satisfy its own checksum", code)
		}
		if seen[code] {
			t.Fatalf("duplicate luggage code %q in 200 mints", code)
		}
		seen[code] = true
	}
}

func TestLuggageChecksumRejectsASingleWrongCharacter(t *testing.T) {
	code := ShortCodeChecked(PrefixLuggage, LuggageCodeLen)
	// Swap one character of the random segment for a different one from
	// the alphabet — the fat-finger case this guards.
	body := []byte(code)
	idx := len("LUG-")
	for _, c := range []byte(Alphabet) {
		if c != body[idx] {
			body[idx] = c
			break
		}
	}
	if CheckedShape(PrefixLuggage, string(body), LuggageCodeLen) {
		t.Fatalf("a single mistyped character must not pass the checksum: %q -> %q", code, body)
	}
}

func TestSignVerify(t *testing.T) {
	sig := Sign("secret", "trip", "abc-123")
	if !Verify("secret", "trip", "abc-123", sig) {
		t.Fatal("valid signature must verify")
	}
	if Verify("secret", "voucher", "abc-123", sig) {
		t.Fatal("scope must be bound into the signature")
	}
	if Verify("secret2", "trip", "abc-123", sig) {
		t.Fatal("wrong secret must not verify")
	}
	if Verify("secret", "trip", "abc-124", sig) {
		t.Fatal("tampered id must not verify")
	}
}

func TestPayloadRoundTrip(t *testing.T) {
	p := TripPayload("trip-uuid", "sig-value")
	id, sig := ParseTripPayload(p)
	if id != "trip-uuid" || sig != "sig-value" {
		t.Fatalf("trip payload round-trip failed: %q %q", id, sig)
	}
	v := VoucherPayload("voucher-uuid", "sig-value")
	vid, vsig := ParseVoucherPayload(v)
	if vid != "voucher-uuid" || vsig != "sig-value" {
		t.Fatalf("voucher payload round-trip failed: %q %q", vid, vsig)
	}
	if _, s := ParseTripPayload("esoqo://v?random"); s != "" {
		t.Fatal("cross-kind parse must fail")
	}
	if _, s := ParseTripPayload("esoko://v?random"); s != "" {
		t.Fatal("cross-kind parse must fail under the legacy scheme too")
	}

	// Every QR printed before the Esoqo rename carries esoko://, and
	// those buses and table tents are not getting reprinted — parsing
	// must keep accepting the old spelling even though minting doesn't
	// produce it any more.
	lid, lsig := ParseTripPayload("esoko://t?v=1&trip=trip-uuid&sig=sig-value")
	if lid != "trip-uuid" || lsig != "sig-value" {
		t.Fatalf("legacy trip payload must still parse: %q %q", lid, lsig)
	}
	lvid, lvsig := ParseVoucherPayload("esoko://v?v=1&id=voucher-uuid&sig=sig-value")
	if lvid != "voucher-uuid" || lvsig != "sig-value" {
		t.Fatalf("legacy voucher payload must still parse: %q %q", lvid, lvsig)
	}
}
