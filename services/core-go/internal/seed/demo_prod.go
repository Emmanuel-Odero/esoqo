// Package seed (demo_prod.go) — the production data push.
//
// SeedProdParcelData is the escape hatch an operator uses to plant the
// ESOQO-family parcel demo set (zones, showcase parcels, stations,
// teams, dispatch fleet, labels) onto ONE real company account — the
// SEED_PROD_ORG slug — instead of the two dev tenants. It deliberately
// does NOT touch ticketing, stores, the pilot SACCO or the
// unified-identity parade, and it does NOT create the synthetic
// "Demo Swift Riders" tenant, so a live account gains a lived-in parcel
// operation without any "Demo " junk or sign-in-able strays from other
// verticals.
//
// The account's own profile, commission split and existing real staff
// are never overwritten: showcase only ensures acceptsWalkIn, teams
// upserts staff matched by (org, lower(name)) which cannot collide with
// existing names, and the dispatch fleet keys runs by vehicle plate per
// org. Riders and desk roles get the same credentials as everywhere else
// (PIN = last six digits) so a tester can sign in immediately.
package seed

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SeedProdParcelData runs the production parcel push. Call after
// SeedReferenceData; safe to re-run — every section upserts
// idempotently.
func SeedProdParcelData(ctx context.Context, pool *pgxpool.Pool) ([]DemoAccount, error) {
	slug := ProdSeedOrgSlug()
	var orgName string
	if err := pool.QueryRow(ctx, `SELECT name FROM parcel_org WHERE slug = $1`, slug).Scan(&orgName); err != nil {
		return nil, fmt.Errorf("prod org %q: %w", slug, err)
	}

	fmt.Printf("  prod seed: org %q (%s)\n", slug, orgName)

	if err := ensureDemoParcelZones(ctx, pool); err != nil {
		return nil, fmt.Errorf("prod zones: %w", err)
	}
	if err := SeedDemoParcelShowcase(ctx, pool); err != nil {
		return nil, err
	}
	if err := SeedDemoParcelTeams(ctx, pool); err != nil {
		return nil, err
	}
	if err := SeedDemoDispatchFleet(ctx, pool); err != nil {
		return nil, err
	}

	var accounts []DemoAccount
	for _, s := range eshipTeamOrg.staff {
		if s.msisdn != "" {
			accounts = append(accounts, DemoAccount{
				Msisdn: s.msisdn, Pin: s.pin, Name: s.name,
				Description: "Rider — phone + PIN",
			})
		} else {
			accounts = append(accounts, DemoAccount{
				Msisdn: "(desk)", Pin: s.pin, Name: s.name,
				Description: "Desk login — name + PIN, no phone",
			})
		}
	}
	return accounts, nil
}
