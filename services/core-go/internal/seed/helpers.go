package seed

import (
	"context"
	"fmt"
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

// showcaseDeliveryCodeSpace — six digits, and the same space
// dbx.generateDeliveryCode draws from. Kept as a named constant so the
// seed's derivation cannot silently drift out of range if the other side
// changes format.
const showcaseDeliveryCodeSpace = 1000000

// showcaseDeliveryCodeProbes — how many times to walk forward from the
// derived code before giving up. One step is enough for any realistic
// collision; the bound exists so a pathological input fails loudly
// instead of spinning.
const showcaseDeliveryCodeProbes = 64

// reserveShowcaseDeliveryCode picks the delivery code for a seeded
// parcel. Deriving it from the parcel's own code is what keeps the seed
// idempotent — the code is a pure function of the parcel code, which is
// the seed's upsert key, so a re-seed lands on the same digits instead
// of invalidating a credential already printed on a demo label.
//
// The derivation is a hash, so it is not injective: two parcel codes can
// land on the same six digits. With ~22 showcase parcels per org and
// two orgs that is unlikely, but "unlikely" is doing real work in a
// function whose failure mode is a unique-violation aborting the whole
// seed run. So the derived code is a starting point, not an answer: if
// it is taken, the next code in sequence is tried, and the one after
// that. Stepping forward from a deterministic base keeps the result
// stable for a given database state, which is the property that matters
// for re-seeds — a seed that re-rolls randomly would rewrite codes on
// every run.
//
// handed tracks what this run has already handed out. The database is
// checked too, but it cannot see this run's own uncommitted intent, so
// without it two parcels seeded back to back can both be told the same
// code is free. A parcel that already exists keeps its stored code
// rather than being probed again — that code is the one its label shows.
func reserveShowcaseDeliveryCode(ctx context.Context, pool *pgxpool.Pool, parcelCode string, handed map[string]bool) (string, error) {
	var existing string
	err := pool.QueryRow(ctx, `SELECT "deliveryCode" FROM parcel WHERE code = $1`, parcelCode).Scan(&existing)
	if err == nil && existing != "" {
		// Keep the code this parcel already has. It is the one printed on
		// its label, and re-deriving it would be the whole problem.
		handed[existing] = true
		return existing, nil
	}

	candidate, free, err := walkShowcaseDeliveryCode(parcelCode, handed, func(code string) (bool, error) {
		var taken bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM parcel WHERE "deliveryCode" = $1)`, code,
		).Scan(&taken); err != nil {
			return false, err
		}
		return taken, nil
	})
	if err != nil {
		return "", err
	}
	if !free {
		return "", fmt.Errorf("no free delivery code for showcase parcel %s after %d probes", parcelCode, showcaseDeliveryCodeProbes)
	}
	handed[candidate] = true
	return candidate, nil
}

// walkShowcaseDeliveryCode steps forward from the derived code until
// taken reports the candidate free. Split out from the database call so
// the walk — the part with the actual logic — is testable without a
// live database.
//
// taken must consult both the parcel table and the codes handed out
// earlier in this run; see reserveShowcaseDeliveryCode.
func walkShowcaseDeliveryCode(parcelCode string, handed map[string]bool, taken func(code string) (bool, error)) (candidate string, free bool, err error) {
	base := showcaseDeliveryCodeBase(parcelCode)
	for probe := 0; probe < showcaseDeliveryCodeProbes; probe++ {
		candidate = showcaseDeliveryCodeAt(base, probe)
		// Checked before the database: a code this run already promised
		// away is taken, and asking the table about it would only
		// re-learn what is already known.
		if handed[candidate] {
			continue
		}
		isTaken, err := taken(candidate)
		if err != nil {
			return "", false, err
		}
		if isTaken {
			continue
		}
		return candidate, true, nil
	}
	return "", false, nil
}

// showcaseDeliveryCodeAt — the probe-th candidate for a base, wrapping
// at the end of the six-digit space so the walk can never emit an
// eight-digit code.
func showcaseDeliveryCodeAt(base, probe int) string {
	return fmt.Sprintf("%06d", (base+probe)%showcaseDeliveryCodeSpace)
}

// showcaseDeliveryCodeBase — FNV-1a over the parcel code, folded into the
// six-digit space. Deterministic by construction; the offset walk in
// reserveShowcaseDeliveryCode is what handles the non-injective part.
func showcaseDeliveryCodeBase(parcelCode string) int {
	var h uint32 = 2166136261 // FNV-1a offset basis
	for i := 0; i < len(parcelCode); i++ {
		h ^= uint32(parcelCode[i])
		h *= 16777619
	}
	return int(h % uint32(showcaseDeliveryCodeSpace))
}
