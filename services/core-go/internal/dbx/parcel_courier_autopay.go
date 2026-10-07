// Package dbx (parcel_courier_autopay.go) — automatic courier payouts.
//
// The lifecycle of one automatic payout:
//
//	PreparePendingPayouts  creates it PENDING and links the owed parcels, so
//	                       neither the next tick nor a manual PayCourier can
//	                       pay the same earnings again
//	(bank call)            B2C send
//	SettleAutoPayout       bank says success → PAID, ledger posted
//	FailAutoPayout         bank says failure → FAILED, parcels unlinked so the
//	                       earnings are owed again
//
// Money only moves on the ledger at SettleAutoPayout, so the books always
// agree with a transfer that actually happened.
package dbx

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/ledger"
)

// AutoPayout is one payout this process is responsible for sending or
// confirming.
type AutoPayout struct {
	ID             string
	Reference      string
	CourierPartyID string
	Msisdn         string
	AmountKes      float64
	ExpectedKes    float64
}

// autoPayoutRetryBackoff is how long a courier is left alone after a FAILED
// payout, so a persistent problem (bad number, empty source account) is not
// hammered every tick.
const autoPayoutRetryBackoff = 30 * time.Minute

// TryAdvisoryLock takes a session-level Postgres advisory lock on a dedicated
// connection so only one replica runs the payout tick at a time. The returned
// release must always be called; ok=false means another process holds it.
func TryAdvisoryLock(ctx context.Context, pool *pgxpool.Pool, key int64) (release func(), ok bool, err error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, false, err
	}
	var got bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, key).Scan(&got); err != nil || !got {
		conn.Release()
		return nil, false, err
	}
	return func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, key)
		conn.Release()
	}, true, nil
}

// PreparePendingPayouts creates a PENDING payout for every courier who is
// owed at least minKes (whole shillings after rounding) and has a phone
// number, skipping couriers who already have a payout in flight or one that
// failed recently. Each courier is its own transaction.
//
// amountKes is the owed total rounded to whole shillings — M-Pesa pays whole
// shillings — and expectedKes keeps the exact figure, which is precisely what
// those two columns exist to reconcile.
func PreparePendingPayouts(ctx context.Context, pool *pgxpool.Pool, minKes int64) ([]AutoPayout, error) {
	rows, err := pool.Query(ctx, `
		SELECT p."currentHolderPartyId"::text, pr.msisdn
		FROM parcel p
		JOIN person pr ON pr."partyId" = p."currentHolderPartyId"
		WHERE p."courierEarningsKes" IS NOT NULL AND p."courierPayoutId" IS NULL
		  AND pr.msisdn IS NOT NULL AND pr.msisdn <> ''
		  AND NOT EXISTS (
		      SELECT 1 FROM parcel_courier_payout x
		      WHERE x."courierPartyId" = p."currentHolderPartyId"
		        AND x."coopReference" IS NOT NULL
		        AND (x.status = 'PENDING'
		             OR (x.status = 'FAILED' AND x."settledAt" > now() - make_interval(secs => $1))))
		GROUP BY p."currentHolderPartyId", pr.msisdn`,
		autoPayoutRetryBackoff.Seconds())
	if err != nil {
		return nil, err
	}
	type cand struct{ party, msisdn string }
	var cands []cand
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.party, &c.msisdn); err != nil {
			rows.Close()
			return nil, err
		}
		cands = append(cands, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var out []AutoPayout
	for _, c := range cands {
		p, err := preparePayoutFor(ctx, pool, c.party, c.msisdn, minKes)
		if err != nil {
			return out, err
		}
		if p != nil {
			out = append(out, *p)
		}
	}
	return out, nil
}

func preparePayoutFor(ctx context.Context, pool *pgxpool.Pool, party, msisdn string, minKes int64) (*AutoPayout, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO parcel_courier_payout
			(id, "courierPartyId", "amountKes", "expectedKes", note, status, "destinationMsisdn", "createdAt")
		VALUES (gen_random_uuid(), $1, 0, 0, 'Automatic Co-op B2C payout', 'PENDING', $2, now())
		RETURNING id::text`, party, msisdn).Scan(&id); err != nil {
		return nil, err
	}
	// Linking is the claim: a parcel with courierPayoutId set is invisible to
	// every other payer. Guarded on NULL so a concurrent manual payout and
	// this one cannot both take the same parcel.
	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET "courierPayoutId" = $1
		WHERE "currentHolderPartyId" = $2 AND "courierEarningsKes" IS NOT NULL
		  AND "courierPayoutId" IS NULL`, id, party); err != nil {
		return nil, err
	}
	var amount, expected float64
	var ref string
	if err := tx.QueryRow(ctx, `
		UPDATE parcel_courier_payout SET
			"expectedKes"   = COALESCE((SELECT SUM("courierEarningsKes") FROM parcel WHERE "courierPayoutId" = $1), 0),
			"amountKes"     = ROUND(COALESCE((SELECT SUM("courierEarningsKes") FROM parcel WHERE "courierPayoutId" = $1), 0), 0),
			"coopReference" = 'CPO' || substr(replace($1::text, '-', ''), 1, 14)
		WHERE id = $1
		RETURNING "amountKes"::float8, "expectedKes"::float8, "coopReference"`, id).Scan(&amount, &expected, &ref); err != nil {
		return nil, err
	}
	if amount < float64(minKes) {
		return nil, nil // not worth a transfer yet — rollback leaves everything untouched
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &AutoPayout{ID: id, Reference: ref, CourierPartyID: party, Msisdn: msisdn, AmountKes: amount, ExpectedKes: expected}, nil
}

// ListPendingAutoPayouts — payouts sent to the bank and awaiting an outcome.
// A PENDING row with no bank reference cannot exist (the reference is written
// in the same statement that sizes it), so the filter is just status.
func ListPendingAutoPayouts(ctx context.Context, pool *pgxpool.Pool) ([]AutoPayout, error) {
	rows, err := pool.Query(ctx, `
		SELECT x.id::text, x."coopReference", x."courierPartyId"::text, COALESCE(pr.msisdn, ''),
		       x."amountKes"::float8, x."expectedKes"::float8
		FROM parcel_courier_payout x
		LEFT JOIN person pr ON pr."partyId" = x."courierPartyId"
		WHERE x.status = 'PENDING' AND x."coopReference" IS NOT NULL
		ORDER BY x."createdAt"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AutoPayout
	for rows.Next() {
		var p AutoPayout
		if err := rows.Scan(&p.ID, &p.Reference, &p.CourierPartyID, &p.Msisdn, &p.AmountKes, &p.ExpectedKes); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetPendingAutoPayoutByRef resolves a bank reference to its payout, nil when
// there is no pending one (unknown, or already settled).
func GetPendingAutoPayoutByRef(ctx context.Context, pool *pgxpool.Pool, ref string) (*AutoPayout, error) {
	var p AutoPayout
	err := pool.QueryRow(ctx, `
		SELECT x.id::text, x."coopReference", x."courierPartyId"::text, COALESCE(pr.msisdn, ''),
		       x."amountKes"::float8, x."expectedKes"::float8
		FROM parcel_courier_payout x
		LEFT JOIN person pr ON pr."partyId" = x."courierPartyId"
		WHERE x."coopReference" = $1 AND x.status = 'PENDING'`, ref).
		Scan(&p.ID, &p.Reference, &p.CourierPartyID, &p.Msisdn, &p.AmountKes, &p.ExpectedKes)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// SettleAutoPayout marks a PENDING payout PAID and posts the ledger entry.
// Returns false when it was not pending (a replayed callback or a second
// replica) so the caller does not notify twice. The status flip is the
// idempotency guard; the ledger key is the backstop.
func SettleAutoPayout(ctx context.Context, pool *pgxpool.Pool, p AutoPayout, receipt string) (bool, error) {
	var rcpt *string
	if receipt != "" {
		rcpt = &receipt
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_courier_payout SET status = 'PAID', reference = COALESCE($2, reference), "settledAt" = now()
		WHERE id = $1 AND status = 'PENDING'`, p.ID, rcpt)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if p.AmountKes <= 0 {
		return true, nil
	}
	payableAcct, err := ledger.EnsureAccount(ctx, pool, &p.CourierPartyID, "PARCEL_COURIER_PAYABLE", "KES")
	if err != nil {
		return true, err
	}
	settlementAcct, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return true, err
	}
	// Same account pair and key shape as the manual PayCourier, so the books
	// cannot tell the two kinds of payout apart.
	_, err = ledger.PostEntry(ctx, pool,
		"parcel-courier-payout:"+p.ID, "Courier earnings paid out (Co-op B2C)",
		"core-go:parcel-courier-payout:"+p.ID,
		[]ledger.Posting{
			{AccountID: payableAcct, AmountCents: ledger.CentsFromKES(p.AmountKes)},
			{AccountID: settlementAcct, AmountCents: ledger.CentsFromKES(-p.AmountKes)},
		})
	return true, err
}

// FailAutoPayout marks a PENDING payout FAILED and unlinks its parcels so the
// earnings are owed again. settledAt doubles as "failed at" and drives the
// retry backoff.
func FailAutoPayout(ctx context.Context, pool *pgxpool.Pool, payoutID, reason string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `
		UPDATE parcel_courier_payout SET status = 'FAILED', "failureReason" = $2, "settledAt" = now()
		WHERE id = $1 AND status = 'PENDING'`, payoutID, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil // already settled one way or the other
	}
	if _, err := tx.Exec(ctx, `UPDATE parcel SET "courierPayoutId" = NULL WHERE "courierPayoutId" = $1`, payoutID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
