// Package money holds KES as an exact integer count of cents.
//
// The database is already correct: every money column is Decimal(12,2),
// and the ledger is Decimal(18,2). Precision was being lost above it —
// float64 in Go, double in Dart — and then written back into those
// Decimal columns. This package is the Go half of closing that; the
// mobile half is mobile/esoqo_app/lib/core/money/money.dart, and the two
// deliberately mirror each other so a rounding rule means the same thing
// on both sides of the wire.
//
// # WHAT THIS PACKAGE IS FOR, AND WHAT IT IS NOT FOR YET
//
// It is for *arithmetic*. Anywhere a fee is derived, a total accumulated,
// or a split computed, the decision of which cent a value lands on
// belongs here rather than in a `math.Round(x*100)/100` written inline.
// dbx had eleven such expressions, each independently correct and
// collectively a set of rounding rules nobody could state in one place.
//
// It is NOT yet the type on the struct fields that cross the wire. Those
// are still float64 because core-go's JSON contract says so, and changing
// that requires the five web apps to move in lockstep — see step 3 of
// docs/proposals/money-representation.md. So the conversion functions
// below are boundary adapters on purpose, not a smell: exact in the
// middle, float64 at the edges, until the edges can move.
package money

import (
	"errors"
	"fmt"
	"math"
	"strings"
)

// Cents is KES × 100. Arithmetic on Cents is ordinary integer
// arithmetic and therefore exact; the only places a rounding decision is
// made are FromKES, ParseKES, Percent and Points, each of which names its
// rule.
type Cents int64

// Zero is the identity for addition and the safe default for a missing
// amount.
const Zero Cents = 0

// FromKES converts a float64 KES amount to exact cents, rounding half
// away from zero.
//
// Half away from zero rather than Go's default banker's rounding: a
// customer-facing half-cent should round the same way every time and in
// the direction a person expects, and the existing dbx call sites all
// used math.Round, which is half-away-from-zero. Preserving that keeps
// this a representation change, not a behaviour change.
func FromKES(kes float64) Cents {
	if math.IsNaN(kes) || math.IsInf(kes, 0) {
		return Zero
	}
	return Cents(math.Round(kes * 100))
}

// KES renders the amount back to float64, for the struct fields and
// JSON payloads that are still typed that way.
//
// Lossy only in the sense that float64 cannot represent every decimal;
// the value returned is the nearest float64 to an exact cent amount,
// which is the best any float64-typed boundary can carry. Crucially the
// *rounding decision* was already made, in integer space, before this is
// called.
func (c Cents) KES() float64 { return float64(c) / 100 }

// Decimal renders an exact 2dp decimal string — what to send when the
// receiver can take a string (Postgres numeric, Prisma Decimal, and
// eventually the JSON contract itself).
func (c Cents) Decimal() string {
	neg := c < 0
	abs := c
	if neg {
		abs = -abs
	}
	s := fmt.Sprintf("%d.%02d", int64(abs)/100, int64(abs)%100)
	if neg {
		return "-" + s
	}
	return s
}

// ParseKES parses a decimal string without going through float64 —
// which is what makes it exact. Accepts an optional sign, thousands
// separators and surrounding whitespace. More than two decimal places
// round to the nearest cent, half away from zero.
//
// Use this in preference to strconv.ParseFloat + FromKES anywhere the
// source is already a string: core-go reads most money out of Postgres
// as ::text precisely so the decimal survives the trip, and parsing it
// into a float first throws that away again.
func ParseKES(s string) (Cents, error) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ",", "")
	if s == "" {
		return Zero, errors.New("money: empty amount")
	}

	neg := false
	switch s[0] {
	case '-':
		neg, s = true, s[1:]
	case '+':
		s = s[1:]
	}
	if s == "" {
		return Zero, errors.New("money: no digits")
	}

	whole, frac, hasFrac := strings.Cut(s, ".")
	if strings.Contains(frac, ".") {
		return Zero, fmt.Errorf("money: malformed amount %q", s)
	}
	if whole == "" {
		whole = "0"
	}

	var total int64
	for _, r := range whole {
		if r < '0' || r > '9' {
			return Zero, fmt.Errorf("money: malformed amount %q", s)
		}
		total = total*10 + int64(r-'0')
	}
	total *= 100

	if hasFrac && frac != "" {
		for _, r := range frac {
			if r < '0' || r > '9' {
				return Zero, fmt.Errorf("money: malformed amount %q", s)
			}
		}
		switch {
		case len(frac) == 1:
			total += int64(frac[0]-'0') * 10
		default:
			total += int64(frac[0]-'0')*10 + int64(frac[1]-'0')
			if len(frac) > 2 && frac[2] >= '5' {
				total++
			}
		}
	}

	if neg {
		total = -total
	}
	return Cents(total), nil
}

// MustParseKES is ParseKES for values already known to be well-formed —
// notably Postgres ::text output of a Decimal column. Returns Zero on a
// parse failure rather than panicking: a malformed amount in a read path
// should surface as a wrong total somewhere visible, not take the
// process down.
func MustParseKES(s string) Cents {
	c, err := ParseKES(s)
	if err != nil {
		return Zero
	}
	return c
}

// Percent returns pct percent of c, rounded to the nearest cent (half
// away from zero). pct is the percentage itself — 15 for 15%, matching
// how every commission/fee column in the schema is expressed.
func (c Cents) Percent(pct float64) Cents {
	if math.IsNaN(pct) || math.IsInf(pct, 0) {
		return Zero
	}
	return Cents(math.Round(float64(c) * pct / 100))
}

// Scale multiplies by an arbitrary non-money factor, rounding to the
// nearest cent (half away from zero).
//
// This is the rate × quantity operation: a per-km charge over a
// distance, a unit price over a weight. Distinct from Percent (which
// divides by 100) and from a plain integer multiply (which takes a
// count). Named rather than written as `Cents(math.Round(...))` inline
// so the rounding happens in one place and reads the same everywhere.
func (c Cents) Scale(factor float64) Cents {
	if math.IsNaN(factor) || math.IsInf(factor, 0) {
		return Zero
	}
	return Cents(math.Round(float64(c) * factor))
}

// Min returns whichever of c and other is smaller — the cap operation
// that fee tiers and part-payments both need.
func (c Cents) Min(other Cents) Cents {
	if other < c {
		return other
	}
	return c
}

// IsPositive reports c > 0. Named rather than written inline so shortfall
// and overpayment checks read the same way everywhere, and so no call
// site is tempted to reintroduce an epsilon.
func (c Cents) IsPositive() bool { return c > 0 }

// Points converts an amount to Esoqo loyalty/voucher points at the fixed
// rate of 10 points per KES, i.e. one point per 10 cents.
//
// Rounds half up, exactly reproducing the `int(kes*10 + 0.5)` expression
// this replaces at four call sites (fleet.go, store.go, ticketing.go,
// voucher_batch.go). Preserving that rule matters: points are spent
// against a balance, and quietly rounding a half-point the other way
// would make a voucher that used to cover a purchase stop covering it.
func (c Cents) Points() int {
	if c < 0 {
		return -int((-c + 5) / 10)
	}
	return int((c + 5) / 10)
}

// Sum adds amounts without the fold-with-a-float-zero footgun.
func Sum(amounts ...Cents) Cents {
	var total Cents
	for _, a := range amounts {
		total += a
	}
	return total
}
