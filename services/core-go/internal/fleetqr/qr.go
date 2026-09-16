// Package fleetqr signs and verifies QR payloads for trip boarding codes
// and voucher cards. Payloads are opaque text rendered by clients with
// qr_flutter / web QR libs — Go never generates images. Signature is
// HMAC-SHA256 over the canonical id with FLEET_QR_SECRET; scanners must
// resolve through Go (which re-checks the MAC + trip/voucher status)
// and never trust a raw id from the payload.
package fleetqr

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math/big"
	"strings"
)

// Alphabet is the unambiguous code alphabet: no 0/O, 1/I or L — the
// characters most often mistyped on a keypad or USSD handset. Every
// human-typable short code in the product (trip, voucher, ticket,
// pickup, payment id) draws from this same set so one resolver grammar
// covers them all.
const Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// Prefix is one registered code kind. A short-code prefix is the first
// thing a scanner sees — BUS-/TRIP- (boarding), VCH- (vouchers),
// TKT- (event tickets), PKP- (store pickup), ESK- (payment id) — so
// every mint MUST go through a registered prefix to keep the smuggler
// exact. Prefixes are uppercase by convention.
type Prefix string

// Registered prefixes — the single namespace table for short codes.
const (
	PrefixTrip      Prefix = "TRIP" // trip token, rotated per trip
	PrefixBus       Prefix = "BUS"  // passenger-facing boarding code
	PrefixVoucher   Prefix = "VCH"
	PrefixTicket    Prefix = "TKT"
	PrefixPickup    Prefix = "PKP"
	PrefixPaymentID Prefix = "ESK"
	PrefixParcel    Prefix = "PKG"
	// PrefixServiceTicket — Parcel.serviceTicketNumber's own prefix,
	// deliberately distinct from PKG so the two can never be confused
	// side by side on a printed slip or a counter screen.
	PrefixServiceTicket Prefix = "TCK"
)

// ValidPrefix reports whether p is a registered code prefix.
func ValidPrefix(p Prefix) bool {
	switch p {
	case PrefixTrip, PrefixBus, PrefixVoucher, PrefixTicket, PrefixPickup, PrefixPaymentID, PrefixParcel, PrefixServiceTicket:
		return true
	}
	return false
}

// ShortCode returns a human-typable fallback code with n random
// characters (default 6), e.g. BUS-4F8K2Q. Sampling is unbiased (see
// RandomSegment) and the code stays the same shape as the codes already
// in the database, so old short codes and new ones resolve identically.
func ShortCode(prefix Prefix, ns ...int) string {
	n := 6
	if len(ns) > 0 && ns[0] > 0 {
		n = ns[0]
	}
	return string(prefix) + "-" + RandomSegment(n)
}

// RandomSegment returns n cryptographically random characters drawn
// uniformly from Alphabet. Uniformity matters at scale: the previous
// byte-modulo sampling skewed ~8 of the 31 letters slightly more often
// than the others, which measurably raises collision odds over millons
// of codes.
func RandomSegment(n int) string {
	if n <= 0 {
		return ""
	}
	max := big.NewInt(int64(len(Alphabet)))
	out := make([]byte, n)
	for i := range out {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			return prefixFallback(n)
		}
		out[i] = Alphabet[int(v.Int64())]
	}
	return string(out)
}

// WithCheck appends a single weighted checksum character (mod the
// alphabet length, positionally weighted) so a mistyped code — a single
// wrong character or a swap — is rejected without a database round-trip.
// The check is safe to add to NEW codes only; the resolvers deliberately
// treat checked and unchecked shapes alike because older rows carry the
// unchecked 6-char form.
func WithCheck(segment string) string {
	if segment == "" {
		return ""
	}
	total := 0
	for i := 0; i < len(segment); i++ {
		idx := strings.IndexByte(Alphabet, segment[i])
		if idx < 0 {
			idx = i % len(Alphabet)
		}
		total = (total + idx*(i+1)) % len(Alphabet)
	}
	return segment + string(Alphabet[total])
}

// ShortCodeChecked is [ShortCode] plus a trailing checksum character —
// PREFIX-ABCDEFG. The random part is the same length as unchecked codes,
// so the DB columns never change size, only the minted value.
func ShortCodeChecked(prefix Prefix, n int) string {
	return string(prefix) + "-" + WithCheck(RandomSegment(n))
}

// CheckedShape reports whether code looks like a CURRENT-format checked
// short code for prefix: PREFIX- + n random chars + 1 check char. Old
// unchecked rows (PREFIX- + n) return false — they're still resolvable,
// just not checksum-verifiable. Callers use this to pre-reject obvious
// typos in the typed-code path.
func CheckedShape(prefix Prefix, code string, n int) bool {
	head := string(prefix) + "-"
	if len(code) != len(head)+n+1 {
		return false
	}
	seg := code[len(head) : len(head)+n]
	rest := WithCheck(seg)
	return code == head+rest
}

func prefixFallback(n int) string {
	out := make([]byte, n)
	for i := range out {
		out[i] = '0'
	}
	return string(out)
}

// Sign returns hex(HMAC(secret, scope + ":" + id)).
func Sign(secret, scope, id string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(scope + ":" + id))
	return hex.EncodeToString(m.Sum(nil))
}

// Verify checks a hex signature in constant time.
func Verify(secret, scope, id, sig string) bool {
	want := Sign(secret, scope, id)
	a, errA := hex.DecodeString(strings.ToLower(sig))
	b, errB := hex.DecodeString(want)
	if errA != nil || errB != nil {
		return false
	}
	return hmac.Equal(a, b)
}

// Scheme is the deep-link scheme new payloads are minted under.
// LegacyScheme is the pre-rebrand spelling: QR codes carrying it are
// already printed on buses, shelves and table tents, so every parser
// below keeps accepting it. Only minting moved to the new name.
const (
	Scheme       = "esoqo://"
	LegacyScheme = "esoko://"
)

// TrimScheme strips <scheme>://<path>? from a payload, accepting either
// spelling. ok is false when the payload is not one of ours.
func TrimScheme(payload, path string) (query string, ok bool) {
	p := strings.TrimSpace(payload)
	for _, prefix := range []string{Scheme + path + "?", LegacyScheme + path + "?"} {
		if strings.HasPrefix(p, prefix) {
			return strings.TrimPrefix(p, prefix), true
		}
	}
	return "", false
}

// TripPayload builds the scan string stuck in the bus / shown on the
// tout's phone: esoqo://t?v=1&trip=<uuid>&sig=<mac>.
func TripPayload(tripID, sig string) string {
	return Scheme + "t?v=1&trip=" + tripID + "&sig=" + sig
}

// ParseTripPayload extracts trip id + sig; empty trip means not ours.
func ParseTripPayload(payload string) (tripID, sig string) {
	q, ok := TrimScheme(payload, "t")
	if !ok {
		return "", ""
	}
	for _, part := range strings.Split(q, "&") {
		k, v, _ := strings.Cut(part, "=")
		switch k {
		case "trip":
			tripID = v
		case "sig":
			sig = v
		}
	}
	return tripID, sig
}

// VoucherPayload is the payer's proof: esoqo://v?v=1&id=<uuid>&sig=<mac>.
func VoucherPayload(voucherID, sig string) string {
	return Scheme + "v?v=1&id=" + voucherID + "&sig=" + sig
}

// ParseVoucherPayload extracts voucher id + sig.
func ParseVoucherPayload(payload string) (voucherID, sig string) {
	q, ok := TrimScheme(payload, "v")
	if !ok {
		return "", ""
	}
	for _, part := range strings.Split(q, "&") {
		k, v, _ := strings.Cut(part, "=")
		switch k {
		case "id":
			voucherID = v
		case "sig":
			sig = v
		}
	}
	return voucherID, sig
}
