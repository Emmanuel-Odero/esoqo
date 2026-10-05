// Package loyalty is the unified party loyalty engine.
//
// Rules (product decision, single place):
//   - 10 loyalty points == KES 1 (PointsPerKES = 10).
//   - Every confirmed transactional spend earns floor(KES * 10%) points.
//     KES 100 -> 10 pts (≈ KES 1, ~1% effective cashback).
//   - Earn writes to party_loyalty_entry (canonical). Legacy
//     store/ticket loyalty tables stay for read-compat only.
package loyalty

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PointsPerKES converts KES to points on load: KES 1 = 10 pts.
const PointsPerKES = 10

// EarnPointsForKES returns floor(kes * 10%) in points.
func EarnPointsForKES(kes float64) int {
	if kes <= 0 {
		return 0
	}
	return int(kes * 0.1)
}

// KesForPoints converts points back to KES.
func KesForPoints(points int) float64 {
	if points <= 0 {
		return 0
	}
	return float64(points) / PointsPerKES
}

// PointsForKES converts a KES load amount to voucher points.
func PointsForKES(kes float64) int {
	if kes <= 0 {
		return 0
	}
	return int(kes*PointsPerKES + 0.5)
}

// EarnForSpend credits loyalty for a confirmed spend. No-op when disabled
// or when earn rounds to zero. Idempotent per refId via kind+refId guard.
func EarnForSpend(ctx context.Context, pool *pgxpool.Pool, partyID string, kes float64, refID string, enabled bool) error {
	if !enabled || partyID == "" {
		return nil
	}
	pts := EarnPointsForKES(kes)
	if pts <= 0 {
		return nil
	}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM party_loyalty_entry WHERE "partyId" = $1 AND kind = 'EARN' AND "refId" = $2)`, partyID, refID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err := pool.Exec(ctx, `INSERT INTO party_loyalty_entry (id, "partyId", points, kind, "refId", "createdAt") VALUES (gen_random_uuid(), $1, $2, 'EARN', $3, now())`, partyID, pts, refID)
	return err
}

// PartyPoints sums the unified ledger for a party.
func PartyPoints(ctx context.Context, pool *pgxpool.Pool, partyID string) (int, error) {
	var pts int
	err := pool.QueryRow(ctx, `SELECT COALESCE(SUM(points),0)::int FROM party_loyalty_entry WHERE "partyId" = $1`, partyID).Scan(&pts)
	return pts, err
}

// RefundToParty credits back the exact points a cancelled purchase
// spent — distinct from EarnForSpend, which only ever credits the 10%
// cashback rate. Idempotent per refId, same guard shape EarnForSpend
// uses, so a retried cancellation can never double-refund.
func RefundToParty(ctx context.Context, pool *pgxpool.Pool, partyID string, points int, refID string) error {
	if partyID == "" || points <= 0 {
		return nil
	}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM party_loyalty_entry WHERE "partyId" = $1 AND kind = 'REFUND' AND "refId" = $2)`, partyID, refID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err := pool.Exec(ctx, `INSERT INTO party_loyalty_entry (id, "partyId", points, kind, "refId", "createdAt") VALUES (gen_random_uuid(), $1, $2, 'REFUND', $3, now())`, partyID, points, refID)
	return err
}

// RefundToPartyTx is RefundToParty inside a caller's transaction, so the
// refund and the state change that earns it commit together.
//
// This is what makes CancelParcel safe. Refunded outside its
// transaction — the shape RefundToParty alone gives — a crash before the
// parcel's status write leaves the sender's points credited and the
// parcel still live: the parcel ships AND the sender keeps back the
// value of having paid for it in points. Nothing reconciles that,
// because both sides individually look correct. The duplicate-refund
// guard also moves inside the transaction, so a retried cancellation
// cannot double-credit against the same refId.
func RefundToPartyTx(ctx context.Context, tx pgx.Tx, partyID string, points int, refID string) error {
	if partyID == "" || points <= 0 {
		return nil
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM party_loyalty_entry WHERE "partyId" = $1 AND kind = 'REFUND' AND "refId" = $2)`, partyID, refID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO party_loyalty_entry (id, "partyId", points, kind, "refId", "createdAt") VALUES (gen_random_uuid(), $1, $2, 'REFUND', $3, now())`, partyID, points, refID)
	return err
}

// SpendFromParty debits loyalty points for a voucher load. Fails when
// balance is insufficient. Caller must hold the surrounding tx semantics;
// this is a single INSERT guarded by a balance check.
//
// The check-then-insert here is only safe while nothing else debits the
// same party at the same time — that is why PayParcelWithPoints uses
// SpendFromPartyTx, which takes the balance's lock. Use this form only
// where the caller's own transaction already serialises the party (see
// voucher.go, whose load is single-shot).
func SpendFromParty(ctx context.Context, pool *pgxpool.Pool, partyID string, points int, refID string) error {
	var bal int
	if err := pool.QueryRow(ctx, `SELECT COALESCE(SUM(points),0)::int FROM party_loyalty_entry WHERE "partyId" = $1`, partyID).Scan(&bal); err != nil {
		return err
	}
	if bal < points {
		return ErrInsufficientLoyalty
	}
	_, err := pool.Exec(ctx, `INSERT INTO party_loyalty_entry (id, "partyId", points, kind, "refId", "createdAt") VALUES (gen_random_uuid(), $1, $2, 'CONVERT_TO_VOUCHER', $3, now())`, partyID, -points, refID)
	return err
}

// SpendFromPartyTx is SpendFromParty inside a caller-supplied
// transaction, with the balance lock actually taken.
//
// FOR UPDATE on the party's own ledger rows is what makes the
// check-then-insert atomic against a concurrent debit: without it two
// spends can each read the same pre-spend balance, each pass the
// `bal < points` test, and together overdraw a balance that was only
// ever meant to cover one of them. Row locks on the entries don't stop a
// brand-new balance from being read before either INSERT lands, so the
// lock is taken on the party row itself.
func SpendFromPartyTx(ctx context.Context, tx pgx.Tx, partyID string, points int, refID string) error {
	// Serialise on the party row. Exists purely as the lock target; the
	// real balance is still the sum of its entries.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM party WHERE id = $1 FOR UPDATE`, partyID); err != nil {
		return err
	}
	var bal int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(SUM(points),0)::int FROM party_loyalty_entry WHERE "partyId" = $1`, partyID).Scan(&bal); err != nil {
		return err
	}
	if bal < points {
		return ErrInsufficientLoyalty
	}
	_, err := tx.Exec(ctx, `INSERT INTO party_loyalty_entry (id, "partyId", points, kind, "refId", "createdAt") VALUES (gen_random_uuid(), $1, $2, 'CONVERT_TO_VOUCHER', $3, now())`, partyID, -points, refID)
	return err
}
