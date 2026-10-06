// Package dbx (parcel_counter_cash.go) — accountability for cash taken
// at a walk-in counter, ParcelCodRemittance's counterpart for a station
// desk instead of a rider's delivery round.
//
// Where a rider's held cash is keyed by partyId (RecordCodCollection /
// RemitCod), a clerk's is keyed by their parcel_org_staff row instead —
// counter clerks are frequently office-only logins with no linked
// party, and tenancy already comes from the org relationship, not a
// person record. The ledger account itself still has to key off a
// partyId (Account.partyId is a real foreign key), so a clerk being
// counted in has the same precondition RiderCashPanel already imposes
// on a rider: a linked party.
package dbx

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/ledger"
	"github.com/esoqo/core-go/internal/money"
)

// RemitCounterCash records a manager counting a clerk's counter cash
// in — same batch-reconciliation shape RemitCod uses for a rider's
// round: every PAY_AT_COUNTER parcel that clerk settled in cash and
// hasn't yet been remitted closes out together, counted and expected
// are allowed to disagree (with a note), and the ledger moves from the
// clerk's held account into Esoqo's settlement account.
//
// Only genuine cash is swept up here: a parcel the same clerk settled
// by taking a client's M-Pesa code always carries a mpesaReceiptCode,
// which excludes it — that money already landed electronically, never
// in the clerk's pocket.
func RemitCounterCash(ctx context.Context, pool *pgxpool.Pool, orgID, collectedByStaffID, receivedByStaffID string, amountKes float64, note *string) (remittanceID string, expectedKes float64, err error) {
	if orgID == "" || collectedByStaffID == "" {
		return "", 0, &ParcelError{"BAD_INPUT", "Say whose cash this is"}
	}
	if receivedByStaffID == "" {
		return "", 0, &ParcelError{"BAD_INPUT", "Record who received the cash"}
	}
	if amountKes < 0 {
		return "", 0, &ParcelError{"BAD_INPUT", "That isn't a valid amount"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var clerkPartyID *string
	err = tx.QueryRow(ctx, `
		SELECT "partyId"::text FROM parcel_org_staff WHERE id = $1 AND "orgId" = $2`,
		collectedByStaffID, orgID).Scan(&clerkPartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, &ParcelError{"NOT_FOUND", "That team member was not found"}
	}
	if err != nil {
		return "", 0, err
	}
	if clerkPartyID == nil || *clerkPartyID == "" {
		return "", 0, &ParcelError{"BAD_INPUT", "That team member has no linked person yet — add one under Settings → Team before counting their cash in"}
	}

	// Same reasoning RemitCod's own comment gives: locked and summed
	// inside the transaction so a settlement landing mid-count can't be
	// swept into a batch computed before it existed, and the aggregate
	// is taken in Go because Postgres rejects FOR UPDATE on one.
	rows, err := tx.Query(ctx, `
		SELECT "priceKes"::text
		FROM parcel
		WHERE "paidByStaffId" = $1 AND "parcelOrgId" = $2
		  AND "paymentMethod" = 'PAY_AT_COUNTER' AND "paidAt" IS NOT NULL
		  AND "mpesaReceiptCode" IS NULL AND "counterCashRemittanceId" IS NULL
		FOR UPDATE`, collectedByStaffID, orgID)
	if err != nil {
		return "", 0, err
	}
	var expected money.Cents
	parcelCount := 0
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			rows.Close()
			return "", 0, err
		}
		expected += money.MustParseKES(text)
		parcelCount++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", 0, err
	}
	if parcelCount == 0 {
		return "", 0, &ParcelError{"BAD_INPUT", "That team member isn't holding any counter cash"}
	}
	expectedKes = expected.KES()

	counted := money.Cents(ledger.CentsFromKES(amountKes))
	if counted != expected {
		if note == nil || strings.TrimSpace(*note) == "" {
			if counted < expected {
				return "", 0, &ParcelError{"BAD_INPUT", "That's less than the parcels say was taken — record what happened"}
			}
			return "", 0, &ParcelError{"BAD_INPUT", "That's more than the parcels say was taken — record where the extra came from"}
		}
	}

	if err := tx.QueryRow(ctx, `
		INSERT INTO parcel_counter_cash_remittance (
			id, "orgId", "collectedByStaffId", "receivedByStaffId",
			"amountKes", "expectedKes", note, "createdAt"
		) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
		RETURNING id`,
		orgID, collectedByStaffID, receivedByStaffID,
		counted.Decimal(), expected.Decimal(), note).
		Scan(&remittanceID); err != nil {
		return "", 0, err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE parcel SET "counterCashRemittanceId" = $1
		WHERE "paidByStaffId" = $2 AND "parcelOrgId" = $3
		  AND "paymentMethod" = 'PAY_AT_COUNTER' AND "paidAt" IS NOT NULL
		  AND "mpesaReceiptCode" IS NULL AND "counterCashRemittanceId" IS NULL`,
		remittanceID, collectedByStaffID, orgID)
	if err != nil {
		return "", 0, err
	}
	if int(tag.RowsAffected()) != parcelCount {
		return "", 0, &ParcelError{"CONFLICT", "That team member's cash changed while this was being recorded — try again"}
	}

	if counted > 0 {
		heldAcct, aerr := ledger.EnsureAccount(ctx, pool, clerkPartyID, "PARCEL_COUNTER_CASH_HELD", "KES")
		if aerr != nil {
			return "", 0, aerr
		}
		settlementAcct, aerr := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
		if aerr != nil {
			return "", 0, aerr
		}
		if _, perr := ledger.PostEntryTx(ctx, tx,
			"parcel-counter-cash-remittance:"+remittanceID, "Clerk remitted counter cash",
			"core-go:parcel-counter-cash-remit:"+remittanceID,
			[]ledger.Posting{
				{AccountID: settlementAcct, AmountCents: int64(counted)},
				{AccountID: heldAcct, AmountCents: -int64(counted)},
			}); perr != nil {
			return "", 0, perr
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", 0, err
	}
	return remittanceID, expectedKes, nil
}
