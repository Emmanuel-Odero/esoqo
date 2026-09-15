package dbx

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
)

// FraudSummary is the ops overview for the pilot: verification outcomes
// in the last 24h plus the current reuse suspects. Staff-only
// (ticketorg.read global grant) — never exposed to crew or passengers.
type FraudSummary struct {
	WindowHours        int            `json:"windowHours"`
	TotalVerifications int            `json:"totalVerifications"`
	Valid              int            `json:"valid"`
	Expired            int            `json:"expired"`
	NotFound           int            `json:"notFound"`
	WrongTrip          int            `json:"wrongTrip"`
	SuspectReuse       int            `json:"suspectReuse"`
	Pending            int            `json:"pending"`
	TopSuspects        []ReuseSuspect `json:"topSuspects"`
	RecentExpired      []RecentVerify `json:"recentExpired"`
}

// ReuseSuspect is one fare shown an abnormal number of times.
type ReuseSuspect struct {
	FareID      string  `json:"fareId"`
	AmountKES   string  `json:"amountKes"`
	ReceiptCode *string `json:"receiptCode"`
	TripID      string  `json:"tripId"`
	VerifyCount int     `json:"verifyCount"`
}

// RecentVerify is a single flagged attempt for the ops table.
type RecentVerify struct {
	FareID     string  `json:"fareId"`
	Result     string  `json:"result"`
	ScopeTrip  *string `json:"scopeTripId"`
	OccurredAt string  `json:"occurredAt"`
}

func requireFraudReader(c authsvc.Ctx) error {
	return authsvc.RequireCapability(c, "ticketorg.read", nil)
}

// GetFraudSummary aggregates fare_verification outcomes (24h window) and
// the top fares by all-time verify count (reuse suspects at >= 3 shows).
func GetFraudSummary(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx) (*FraudSummary, error) {
	if err := requireFraudReader(c); err != nil {
		return nil, err
	}
	s := &FraudSummary{WindowHours: 24}
	row := pool.QueryRow(ctx, `
		SELECT
		  COUNT(*),
		  COUNT(*) FILTER (WHERE result = 'VALID'),
		  COUNT(*) FILTER (WHERE result = 'EXPIRED'),
		  COUNT(*) FILTER (WHERE result = 'NOT_FOUND'),
		  COUNT(*) FILTER (WHERE result = 'WRONG_TRIP'),
		  COUNT(*) FILTER (WHERE result = 'SUSPECT_REUSE'),
		  COUNT(*) FILTER (WHERE result = 'PENDING')
		FROM fare_verification WHERE "createdAt" > now() - interval '24 hours'`)
	if err := row.Scan(&s.TotalVerifications, &s.Valid, &s.Expired, &s.NotFound, &s.WrongTrip, &s.SuspectReuse, &s.Pending); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT f.id::text, f."amountKes"::text, f."mpesaReceiptCode", f."tripId"::text, COUNT(v.id)::int AS n
		FROM fare_verification v JOIN fare_payment f ON f.id = v."fareId"
		GROUP BY f.id, f."amountKes", f."mpesaReceiptCode", f."tripId"
		HAVING COUNT(v.id) >= 3
		ORDER BY n DESC LIMIT 20`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r ReuseSuspect
		if err := rows.Scan(&r.FareID, &r.AmountKES, &r.ReceiptCode, &r.TripID, &r.VerifyCount); err != nil {
			return nil, err
		}
		s.TopSuspects = append(s.TopSuspects, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows2, err := pool.Query(ctx, `
		SELECT "fareId"::text, result, "scopeTripId"::text, "createdAt"::text
		FROM fare_verification WHERE result IN ('EXPIRED','SUSPECT_REUSE','WRONG_TRIP')
		ORDER BY "createdAt" DESC LIMIT 20`)
	if err != nil {
		return nil, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var r RecentVerify
		if err := rows2.Scan(&r.FareID, &r.Result, &r.ScopeTrip, &r.OccurredAt); err != nil {
			return nil, err
		}
		s.RecentExpired = append(s.RecentExpired, r)
	}
	if s.TopSuspects == nil {
		s.TopSuspects = []ReuseSuspect{}
	}
	if s.RecentExpired == nil {
		s.RecentExpired = []RecentVerify{}
	}
	return s, rows2.Err()
}
