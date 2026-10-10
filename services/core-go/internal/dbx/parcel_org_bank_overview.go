// parcel_org_bank_overview.go — the admin "bank overview" page's
// read models: how much each courier company has actually been paid,
// how much is still moving through Co-op/Daraja, and how much is stuck
// waiting on a human. Pure rollups of parcel_org_payout — the same
// table every automatic and manual payout path already writes — so
// this never needs its own write path or its own notion of "paid".
package dbx

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ParcelOrgPayoutOverviewRow is one courier company's payout summary.
type ParcelOrgPayoutOverviewRow struct {
	ParcelOrgID   string  `json:"parcelOrgId"`
	ParcelOrgName string  `json:"parcelOrgName"`
	CommissionPct float64 `json:"commissionPct"`
	// PaidKes — CONFIRMED payouts: money that has actually left for
	// this company.
	PaidKes float64 `json:"paidKes"`
	// InFlightKes — PENDING/PROCESSING: a payout has been created, or a
	// B2C/B2B/PesaLink request is already out with Daraja or Co-op,
	// waiting on its result.
	InFlightKes float64 `json:"inFlightKes"`
	// NeedsActionKes/Count — FAILED/MANUAL: nothing automatic will ever
	// clear these on its own; see the admin manual-payouts page.
	NeedsActionKes   float64 `json:"needsActionKes"`
	NeedsActionCount int     `json:"needsActionCount"`
	LastPayoutAt     *string `json:"lastPayoutAt"`
}

// ListParcelOrgPayoutOverview rolls every courier company's payouts up
// by status — one row per company, zeros for one that has never
// settled a parcel or bus ticket yet (the LEFT JOIN), alphabetical so
// the page reads the same way the companies list already does.
func ListParcelOrgPayoutOverview(ctx context.Context, pool *pgxpool.Pool) ([]ParcelOrgPayoutOverviewRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT o.id, o.name, o."commissionPct"::text,
		       COALESCE(SUM(po."amountKes") FILTER (WHERE po.status = 'CONFIRMED'), 0)::text,
		       COALESCE(SUM(po."amountKes") FILTER (WHERE po.status IN ('PENDING', 'PROCESSING')), 0)::text,
		       COALESCE(SUM(po."amountKes") FILTER (WHERE po.status IN ('FAILED', 'MANUAL')), 0)::text,
		       COUNT(*) FILTER (WHERE po.status IN ('FAILED', 'MANUAL')),
		       MAX(po."confirmedAt")::text
		FROM parcel_org o
		LEFT JOIN parcel_org_payout po ON po."parcelOrgId" = o.id
		GROUP BY o.id, o.name, o."commissionPct"
		ORDER BY o.name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ParcelOrgPayoutOverviewRow
	for rows.Next() {
		var r ParcelOrgPayoutOverviewRow
		var commissionText, paidText, inFlightText, needsActionText string
		if err := rows.Scan(&r.ParcelOrgID, &r.ParcelOrgName, &commissionText,
			&paidText, &inFlightText, &needsActionText,
			&r.NeedsActionCount, &r.LastPayoutAt); err != nil {
			return nil, err
		}
		if r.CommissionPct, err = parseFloatOrZero(commissionText); err != nil {
			return nil, err
		}
		if r.PaidKes, err = parseFloatOrZero(paidText); err != nil {
			return nil, err
		}
		if r.InFlightKes, err = parseFloatOrZero(inFlightText); err != nil {
			return nil, err
		}
		if r.NeedsActionKes, err = parseFloatOrZero(needsActionText); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
