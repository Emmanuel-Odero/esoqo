package seed

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/dbx"
)

// SeedBusinessPaymentIDs gives every organisation that lacks one an
// Esoqo Payment ID.
//
// Businesses are what /pay resolves a payee to, and dal/business-payment.ts
// refuses any organisation without a live ID — correctly, since paying
// the wrong entity is worse than saying "not found". But nothing in the
// seed path can mint one: issueEsoqoPaymentId is person-only (it demands
// an MSISDN_VERIFIED attestation, which an ORGANISATION has no phone to
// earn), and the TypeScript backfill is an operator action, not a seed
// step. Without this, a freshly seeded database has three registered
// organisations and not one of them can be paid.
//
// Idempotent, like everything else here: organisations that already hold
// an ID keep it, so re-seeding never invalidates a printed QR stand.
func SeedBusinessPaymentIDs(ctx context.Context, pool *pgxpool.Pool) error {
	orgs, err := organisationsWithoutPaymentID(ctx, pool)
	if err != nil {
		return err
	}
	for _, org := range orgs {
		code, err := dbx.EnsureBusinessPaymentID(ctx, pool, org.partyID)
		if err != nil {
			return fmt.Errorf("payment id for %q: %w", org.name, err)
		}
		fmt.Printf("  %-16s %s (%s)\n", code, org.name, org.county)
	}
	return nil
}

type orgNeedingID struct {
	partyID string
	name    string
	county  string
}

func organisationsWithoutPaymentID(ctx context.Context, pool *pgxpool.Pool) ([]orgNeedingID, error) {
	rows, err := pool.Query(ctx, `
		SELECT o."partyId", COALESCE(o."knownAs", o."officialName"), p.county
		FROM organisation o
		JOIN party p ON p.id = o."partyId"
		WHERE p."deletedAt" IS NULL
		  AND NOT EXISTS (SELECT 1 FROM esoko_payment_id e WHERE e."partyId" = o."partyId")
		ORDER BY COALESCE(o."knownAs", o."officialName")`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []orgNeedingID
	for rows.Next() {
		var o orgNeedingID
		if err := rows.Scan(&o.partyID, &o.name, &o.county); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
