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

// SpendFromParty debits loyalty points for a voucher load. Fails when
// balance is insufficient. Caller must hold the surrounding tx semantics;
// this is a single INSERT guarded by a balance check.
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
