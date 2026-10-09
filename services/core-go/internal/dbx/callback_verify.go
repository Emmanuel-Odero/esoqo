package dbx

import (
	"context"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrCheckoutUnknown means no pending row in any Go-owned domain claims
// this checkout id — the callback is either foreign (registration or
// donation, still TS-only) or fabricated. The webhook treats it the same
// way it always has: dispatch proceeds and ultimately forwards to TS.
var ErrCheckoutUnknown = errors.New("dbx: no pending payment for checkout id")

// ExpectedAmountForCheckout returns the KES amount this checkout id was
// raised for, looked up across every domain the STK webhook can confirm.
//
// This exists because Daraja authenticates nothing: the callback body is
// plain JSON over HTTP with no signature, so "a row exists with this
// CheckoutRequestID" was previously the entire basis for crediting an
// order. The secret callback path (see httpapi.callbackTokenOK) is the
// primary control; this is the second one, and the one that still holds
// if that URL ever leaks — a forged callback must now also state the
// exact amount the pending row was created with, which the attacker does
// not control and cannot lower.
//
// The amount columns differ per domain, so each arm names its own; all
// are cast to text because the rest of dbx parses numerics that way.
func ExpectedAmountForCheckout(ctx context.Context, pool *pgxpool.Pool, checkoutID string) (float64, error) {
	const q = `
		SELECT amount FROM (
			SELECT "totalKes"::text   AS amount FROM store_order       WHERE "mpesaCheckoutRequestId"  = $1
			UNION ALL
			SELECT "amountKes"::text            FROM booking_payment    WHERE "mpesaCheckoutRequestId"  = $1
			UNION ALL
			SELECT "totalKes"::text             FROM booking            WHERE "mpesaCheckoutRequestId"  = $1
			UNION ALL
			SELECT "amountKes"::text            FROM group_contribution WHERE "checkoutRequestId"       = $1
			UNION ALL
			SELECT "priceKes"::text             FROM parcel             WHERE "paymentCheckoutRequestId" = $1
			UNION ALL
			SELECT "amountKes"::text            FROM fare_payment       WHERE "mpesaCheckoutRequestId"  = $1
			UNION ALL
			SELECT "kesEquiv"::text             FROM voucher_ledger_entry
				WHERE kind = 'LOAD_MPESA_PENDING' AND "refId" = $1
			UNION ALL
			SELECT ("amountPerEmployeeKes" * COALESCE(
				CASE
					WHEN jsonb_typeof("employeePartyIds") = 'array' THEN jsonb_array_length("employeePartyIds")
					ELSE 0
				END, 0))::text
				FROM voucher_batch      WHERE "mpesaCheckoutRequestId"  = $1
			UNION ALL
			SELECT "amountKes"::text            FROM bill_contribution  WHERE "mpesaCheckoutRequestId"  = $1
			UNION ALL
			-- One checkout can cover several seats (see CreateBusBooking),
			-- all sharing this checkout id, so the expected amount is
			-- their combined fare, not any single seat's — summed rather
			-- than selected bare like every other arm above. HAVING
			-- excludes the one all-NULL row sum() still returns with no
			-- matching rows, keeping this arm's "0 rows if no match"
			-- behaviour consistent with the rest of the union.
			SELECT sum("priceKes")::text        FROM bus_booking        WHERE "mpesaCheckoutRequestId"  = $1
				HAVING count(*) > 0
		) AS claims
		LIMIT 1`

	var text string
	if err := pool.QueryRow(ctx, q, checkoutID).Scan(&text); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrCheckoutUnknown
		}
		return 0, err
	}
	return strconv.ParseFloat(text, 64)
}
