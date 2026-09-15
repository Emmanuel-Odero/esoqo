package money

import (
	"bytes"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strconv"
)

// Amount is [Cents] with JSON behaviour attached: it unmarshals from
// EITHER a JSON string ("254.15") or a JSON number (254.15), and always
// marshals to a decimal string.
//
// # WHY BOTH ON THE WAY IN
//
// core-go and the TypeScript endpoints disagree about how money looks on
// the wire. Prisma serialises Decimal as a string, so anything TS-served
// already sends "254.15"; core-go's float64 fields send 254.15. Mobile
// had to learn both (see Money.fromJson in
// mobile/esoqo_app/lib/core/money/money.dart). Converging on the string
// form is the goal — it is the only shape that survives a JavaScript
// client, whose `number` is a float64 too.
//
// Swapping a *request* field from float64 to Amount is strictly
// non-breaking: every existing caller keeps sending numbers and keeps
// working, while a caller that has moved on can send an exact decimal
// string. That asymmetry is the whole point — it lets the input side
// converge immediately, with no coordinated release.
//
// # WHY OUTPUT IS A SEPARATE DECISION
//
// Marshalling as a string DOES break a consumer expecting a number, and
// there are 587 money-field reads across 112 TypeScript files in this
// repo. So a response field must only move to Amount together with the
// TS code that reads it — endpoint by endpoint, never as a sweep. See
// step 3 of docs/proposals/money-representation.md.
type Amount Cents

// Cents returns the underlying exact amount.
func (a Amount) Cents() Cents { return Cents(a) }

// AmountOf wraps cents for JSON output.
func AmountOf(c Cents) Amount { return Amount(c) }

// AmountFromKES wraps a float64 KES amount, rounding to the nearest cent.
func AmountFromKES(kes float64) Amount { return Amount(FromKES(kes)) }

// KES returns the amount as float64, for handlers still passing money
// into float64-typed dbx functions.
func (a Amount) KES() float64 { return Cents(a).KES() }

// MarshalJSON always emits a quoted decimal string with exactly two
// places — the shape Prisma already produces, so a client that has
// learned to read TS-served money needs no second code path.
func (a Amount) MarshalJSON() ([]byte, error) {
	return []byte(strconv.Quote(Cents(a).Decimal())), nil
}

// UnmarshalJSON accepts a JSON string, a JSON number, or null.
//
// A number is parsed via its own text rather than through float64:
// encoding/json hands over the raw bytes, and "254.15" parsed as a
// decimal string is exact where ParseFloat then scaling is not. This
// matters most for the values that arrive from a JavaScript client,
// which cannot have sent anything but a float64 and whose intent is
// nonetheless unambiguous in the literal it wrote.
func (a *Amount) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		*a = 0
		return nil
	}

	// String form: "254.15".
	if data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return fmt.Errorf("money: %w", err)
		}
		c, err := ParseKES(s)
		if err != nil {
			return err
		}
		*a = Amount(c)
		return nil
	}

	// Number form: 254.15. Parse the literal text, not a float64 built
	// from it — 254.15 the literal is exact, 254.15 the float64 is not.
	if c, err := ParseKES(string(data)); err == nil {
		*a = Amount(c)
		return nil
	}
	// ...but JSON numbers may also be written in scientific notation
	// (1e3, 2.5E-2), which the decimal parser deliberately does not
	// accept. Nothing in this codebase emits money that way; a client
	// library might. Falling back to float64 loses the exactness the
	// branch above preserves, which is acceptable precisely because the
	// sender already had a float64 to write it from.
	f, ferr := strconv.ParseFloat(string(data), 64)
	if ferr != nil {
		return fmt.Errorf("money: %q is not a valid amount", string(data))
	}
	*a = AmountFromKES(f)
	return nil
}

// String makes Amount print as its decimal form in logs and %v.
func (a Amount) String() string { return Cents(a).Decimal() }

// Scan implements sql.Scanner so an Amount can be read straight out of a
// Decimal column with rows.Scan, without a string variable in between.
//
// pgx honours sql.Scanner, and a numeric column arrives as a string or
// []byte — which is the exact decimal, so it is parsed as one. Without
// this, `rows.Scan(&row.EarnedKes)` compiles perfectly (Scan takes any)
// and fails at runtime, which is a worse failure mode than not
// compiling.
func (a *Amount) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*a = 0
		return nil
	case string:
		c, err := ParseKES(v)
		if err != nil {
			return err
		}
		*a = Amount(c)
		return nil
	case []byte:
		c, err := ParseKES(string(v))
		if err != nil {
			return err
		}
		*a = Amount(c)
		return nil
	case float64:
		*a = AmountFromKES(v)
		return nil
	case int64:
		// A whole-number column: KES, not cents.
		*a = Amount(Cents(v) * 100)
		return nil
	default:
		return fmt.Errorf("money: cannot scan %T into Amount", src)
	}
}

// Value implements driver.Valuer, writing the exact decimal string so a
// Decimal column receives what it was given rather than a float
// round-trip.
func (a Amount) Value() (driver.Value, error) { return Cents(a).Decimal(), nil }

// KESPtr bridges an optional Amount to the *float64 that dbx input
// structs still use, preserving the nil/present distinction those
// fields exist to carry (a nil declared value means "the sender did not
// declare one", which is not the same as declaring zero).
//
// Disappears with the rest of the float64 boundary once dbx takes
// Cents directly.
func (a *Amount) KESPtr() *float64 {
	if a == nil {
		return nil
	}
	f := a.KES()
	return &f
}
