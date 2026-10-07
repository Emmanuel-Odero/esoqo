package dbx

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PendingParcelCheckoutID returns the payment key of a parcel still awaiting
// payment, or "" when there is none (already booked, never pushed, or only a
// bare reservation token — callers filter those by prefix).
func PendingParcelCheckoutID(ctx context.Context, pool *pgxpool.Pool, code string) (string, error) {
	var id *string
	err := pool.QueryRow(ctx, `
		SELECT "paymentCheckoutRequestId" FROM parcel
		WHERE code = $1 AND status = 'DRAFT_PENDING_PAYMENT'`, code).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) || id == nil {
		return "", nil
	}
	return *id, err
}

// ReleaseParcelPaymentByCheckoutID frees the payment slot after the provider
// reports the push definitively failed (customer cancelled, wrong PIN,
// insufficient funds), so the sender can start another. Guarded on status so
// a parcel that was confirmed in the meantime is never touched.
func ReleaseParcelPaymentByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE parcel SET "paymentCheckoutRequestId" = NULL, "paymentReservationAt" = NULL
		WHERE "paymentCheckoutRequestId" = $1 AND status = 'DRAFT_PENDING_PAYMENT'`, checkoutID)
	return err
}
