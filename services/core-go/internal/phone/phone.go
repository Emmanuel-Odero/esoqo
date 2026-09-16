// Package phone — Kenyan MSISDN normalisation at the API boundary.
//
// Identity in Esoqo IS the phone number: a Person is looked up by
// msisdn, an OTP is sent to it, a parcel's receiver is matched on it.
// So "+254712345678" and "0712345678" being stored as two different
// strings doesn't just look untidy — it makes one human into two
// people, and sends their OTP to a number the gateway can't route.
// Everything is therefore stored in E.164 (+2547XXXXXXXX or
// +2541XXXXXXXX) and normalised on the way in, never on the way out.
//
// This is the Go mirror of packages/domain/src/phone.ts's
// normaliseMsisdn. The two must accept the same set of inputs, because
// the same human types into a Next.js form one day and the Flutter app
// the next, and has to come out as the same person. If you change the
// accepted shapes here, change them there.
package phone

import (
	"regexp"
	"strings"
)

// keMobile — the four forms people actually type, which is the whole
// point of this package:
//
//	+254712345678  (E.164, what we store)
//	254712345678   (the gateway's own wire format, pasted back in)
//	0712345678     (how a Kenyan writes their number)
//	712345678      (what's left when someone drops the leading zero)
//
// Both Safaricom/Airtel 07x and the newer 01x ranges. Deliberately
// anchored: a number with trailing junk is a typo, not a number, and
// silently truncating it would route someone else's OTP.
var keMobile = regexp.MustCompile(`^(?:\+?254|0)?(7\d{8}|1\d{8})$`)

// separators a human puts in a phone number and a form field faithfully
// preserves — "0712 345 678", "+254-712-345-678", "(0712) 345678".
var separators = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", " ", "")

// Normalise converts any accepted form to E.164, reporting whether the
// input was a Kenyan mobile number at all. An empty or unrecognised
// input returns ok=false — callers decide whether that's a validation
// error (a required field) or simply nothing to do (an optional one).
func Normalise(raw string) (string, bool) {
	cleaned := separators.Replace(strings.TrimSpace(raw))
	m := keMobile.FindStringSubmatch(cleaned)
	if m == nil {
		return "", false
	}
	return "+254" + m[1], true
}

// NormaliseInPlace rewrites a required field, reporting whether it was
// valid. The field is left untouched when invalid so an error message
// can quote what the user actually typed back at them.
func NormaliseInPlace(field *string) bool {
	if field == nil {
		return false
	}
	n, ok := Normalise(*field)
	if !ok {
		return false
	}
	*field = n
	return true
}

// NormaliseOptional rewrites an optional field. A nil pointer, or one
// holding only whitespace, is "not supplied" and passes — the field was
// optional, and inventing a validation failure for an absent value
// would break every caller that legitimately omits it. Anything
// actually typed still has to be a real number: a half-entered one is a
// mistake worth surfacing, not worth storing.
func NormaliseOptional(field **string) bool {
	if field == nil || *field == nil {
		return true
	}
	if strings.TrimSpace(**field) == "" {
		return true
	}
	n, ok := Normalise(**field)
	if !ok {
		return false
	}
	*field = &n
	return true
}
