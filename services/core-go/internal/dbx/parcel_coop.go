package dbx

import (
	"context"
	"errors"
	"time"

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
		WHERE code = $1 AND "paidAt" IS NULL
		  AND (status = 'DRAFT_PENDING_PAYMENT' OR "paymentMethod" = 'PAY_AT_COUNTER')
		  AND "paymentCheckoutRequestId" IS NOT NULL
		  AND "paymentReservationAt" IS NULL`, code).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) || id == nil {
		return "", nil
	}
	return *id, err
}

// PendingCounterPush is a counter settlement (SettleCounterParcelStk) whose
// M-Pesa prompt has gone out but not been paid.
type PendingCounterPush struct {
	ParcelID    string
	Ref         string
	RequestedAt *time.Time // nil only for pushes sent before the column existed
}

// GetPendingCounterPush finds the unpaid prompt on a PAY_AT_COUNTER parcel,
// by code or ticket number. nil when there is none — never pushed, already
// paid, or only a reservation token mid-push. orgScope nil = Esoqo staff.
func GetPendingCounterPush(ctx context.Context, pool *pgxpool.Pool, code string, orgScope *string) (*PendingCounterPush, error) {
	var p PendingCounterPush
	var ref *string
	err := pool.QueryRow(ctx, `
		SELECT id, "paymentCheckoutRequestId", "paymentRequestedAt" FROM parcel
		WHERE (code = $1 OR "serviceTicketNumber" = $1)
		  AND "paymentMethod" = 'PAY_AT_COUNTER' AND "paidAt" IS NULL
		  AND "paymentReservationAt" IS NULL
		  AND ($2::uuid IS NULL OR "parcelOrgId" = $2::uuid)`, code, orgScope).Scan(&p.ParcelID, &ref, &p.RequestedAt)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && ref == nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Ref = *ref
	return &p, nil
}

// CancelCounterPush frees a counter parcel's payment slot so the clerk can
// prompt again or take cash. Matched on the exact ref so a newer push, or a
// payment that confirmed in the meantime, is never touched. The caller
// decides whether the prompt is old enough to be dead.
func CancelCounterPush(ctx context.Context, pool *pgxpool.Pool, parcelID, ref string) (bool, error) {
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET "paymentCheckoutRequestId" = NULL, "paymentReservationAt" = NULL, "paymentRequestedAt" = NULL
		WHERE id = $1 AND "paymentCheckoutRequestId" = $2 AND "paidAt" IS NULL AND "paymentReservationAt" IS NULL`,
		parcelID, ref)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// CoopPendingPush is one unresolved Co-op prompt, booking or counter.
type CoopPendingPush struct {
	Ref         string
	RequestedAt time.Time
}

// ListCoopPushesToReconcile returns every parcel prompt still waiting on
// Co-op. A Co-op push is only ever settled by our own enquiry, so without
// this a payment approved after the clerk (or sender) closed the screen —
// or whose callback never reached us — would be paid and never recorded.
// Pushes sent before paymentRequestedAt existed read as long ago.
func ListCoopPushesToReconcile(ctx context.Context, pool *pgxpool.Pool, prefix string, limit int) ([]CoopPendingPush, error) {
	rows, err := pool.Query(ctx, `
		SELECT "paymentCheckoutRequestId", COALESCE("paymentRequestedAt", 'epoch'::timestamp)
		FROM parcel
		WHERE "paymentCheckoutRequestId" LIKE $1 || '%'
		  AND "paymentReservationAt" IS NULL AND "paidAt" IS NULL
		  AND (status = 'DRAFT_PENDING_PAYMENT' OR "paymentMethod" = 'PAY_AT_COUNTER')
		ORDER BY "paymentRequestedAt" NULLS FIRST
		LIMIT $2`, prefix, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CoopPendingPush
	for rows.Next() {
		var p CoopPendingPush
		if err := rows.Scan(&p.Ref, &p.RequestedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ReleaseParcelPaymentByCheckoutID frees the payment slot after the provider
// reports the push definitively failed (customer cancelled, wrong PIN,
// insufficient funds), so the sender or clerk can start another. Guarded so
// a parcel that was confirmed in the meantime is never touched: a booking
// must still be a draft, a counter settlement must still be unpaid.
func ReleaseParcelPaymentByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE parcel SET "paymentCheckoutRequestId" = NULL, "paymentReservationAt" = NULL, "paymentRequestedAt" = NULL
		WHERE "paymentCheckoutRequestId" = $1
		  AND (status = 'DRAFT_PENDING_PAYMENT' OR ("paymentMethod" = 'PAY_AT_COUNTER' AND "paidAt" IS NULL))`, checkoutID)
	return err
}
