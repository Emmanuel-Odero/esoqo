package seed

import (
	"context"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
)

// ProdSeedOrgSlug returns the parcel_org slug an operator asked to plant
// the parcel demo data into, from SEED_PROD_ORG. Empty means dev-only
// tenants (demo-swift-riders + esoqo-shippers). Production pushes opt in
// explicitly — the LOCAL_TEST_PROD comment in cmd/seed/main.go stands.
func ProdSeedOrgSlug() string {
	return strings.TrimSpace(os.Getenv("SEED_PROD_ORG"))
}

// IsProdSeed reports whether this run is a production push (targets a
// real company account instead of the dev tenants).
func IsProdSeed() bool {
	return ProdSeedOrgSlug() != ""
}

// OrgSlug resolves which parcel_org slug a demo section targets: the
// tagged production org when SEED_PROD_ORG is set, otherwise the
// developer default.
func OrgSlug(def string) string {
	if s := ProdSeedOrgSlug(); s != "" {
		return s
	}
	return def
}

// ProdSeedConfirmed guards the production push — SEED_CONFIRM=1 is the
// explicit "yes, write demo data into a live account" acknowledgment.
func ProdSeedConfirmed() bool {
	return strings.TrimSpace(os.Getenv("SEED_CONFIRM")) == "1"
}

// EnsurePersonParty upserts a demo Person+Party by msisdn (same natural
// key as the rest of core-go's auth) and sets/resets their PIN — mirrors
// seed-demo.ts's upsertSubject. Returns the partyID.
func EnsurePersonParty(ctx context.Context, pool *pgxpool.Pool, msisdn, officialName, knownAs, county, pin string) (string, error) {
	var partyID string
	err := pool.QueryRow(ctx, `SELECT "partyId" FROM person WHERE msisdn = $1`, msisdn).Scan(&partyID)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO party (id, kind, county, "sourceSystem", "updatedAt")
			VALUES (gen_random_uuid(), 'PERSON', $1, 'ESOKO', now())
			RETURNING id`, county).Scan(&partyID)
		if err != nil {
			return "", err
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO person ("partyId", "officialName", "knownAs", msisdn, "msisdnVerifiedAt")
			VALUES ($1, $2, $3, $4, now())`, partyID, officialName, knownAs, msisdn)
		if err != nil {
			return "", err
		}
	} else {
		_, err = pool.Exec(ctx, `
			UPDATE person SET "officialName" = $1, "knownAs" = $2 WHERE "partyId" = $3`,
			officialName, knownAs, partyID)
		if err != nil {
			return "", err
		}
	}

	pinHash, err := authsvc.HashPin(pin)
	if err != nil {
		return "", err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO user_credential ("personId", "pinHash", "pinSetAt", "failedAttempts", "lockedUntil", "updatedAt")
		VALUES ($1, $2, now(), 0, NULL, now())
		ON CONFLICT ("personId") DO UPDATE SET "pinHash" = $2, "pinSetAt" = now(), "failedAttempts" = 0, "lockedUntil" = NULL, "updatedAt" = now()`,
		partyID, pinHash)
	return partyID, err
}

// EnsureEnterprise upserts an Enterprise for a Party by (partyId,
// workRaw) — mirrors upsertEnterprise.
func EnsureEnterprise(ctx context.Context, pool *pgxpool.Pool, partyID, workRaw string) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		SELECT id FROM enterprise WHERE "partyId" = $1 AND "workRaw" = $2`, partyID, workRaw).Scan(&id)
	if err == nil {
		return id, nil
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO enterprise (id, "partyId", "workRaw", "isRegistered", "hasKraPin", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, true, true, now())
		RETURNING id`, partyID, workRaw).Scan(&id)
	return id, err
}
