package dbx

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Every query below spells out camelCase column names in double quotes.
// Prisma's schema.prisma maps table names to snake_case (@@map("person"),
// etc.) but leaves individual columns at their default camelCase field
// name — so, unlike a conventional snake_case Postgres schema, an
// unquoted identifier here would be folded to lowercase by Postgres and
// silently miss the real column.

type PersonAuth struct {
	PartyID        string
	OfficialName   string
	KnownAs        *string
	Msisdn         *string
	PinHash        *string
	FailedAttempts int
	LockedUntil    *time.Time
	FrozenAt       *time.Time
}

// FindPersonByMsisdn — the pre-auth lookup, deliberately not
// capability-gated (mirrors auth-credential.ts's findSubjectCredential).
func FindPersonByMsisdn(ctx context.Context, pool *pgxpool.Pool, msisdn string) (*PersonAuth, error) {
	return findPersonByWhere(ctx, pool, `pr.msisdn = $1`, msisdn)
}

// FindPersonByIdentifier — phone (E.164) or email, whichever the string
// looks like. Same "@" sniff auth-credential.ts's findSubjectCredential
// uses, since the web sign-in form accepts either.
func FindPersonByIdentifier(ctx context.Context, pool *pgxpool.Pool, identifier string) (*PersonAuth, error) {
	trimmed := strings.TrimSpace(identifier)
	if strings.Contains(trimmed, "@") {
		return findPersonByWhere(ctx, pool, `pr.email = $1`, strings.ToLower(trimmed))
	}
	return findPersonByWhere(ctx, pool, `pr.msisdn = $1`, trimmed)
}

func findPersonByWhere(ctx context.Context, pool *pgxpool.Pool, whereClause, arg string) (*PersonAuth, error) {
	var p PersonAuth
	err := pool.QueryRow(ctx, `
		SELECT pr."partyId", pr."officialName", pr."knownAs", pr.msisdn,
		       uc."pinHash", uc."failedAttempts", uc."lockedUntil", uc."frozenAt"
		FROM person pr
		LEFT JOIN user_credential uc ON uc."personId" = pr."partyId"
		WHERE `+whereClause, arg).
		Scan(&p.PartyID, &p.OfficialName, &p.KnownAs, &p.Msisdn, &p.PinHash, &p.FailedAttempts, &p.LockedUntil, &p.FrozenAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// FindOrCreatePersonByMsisdn — used after a successful OTP verification.
// Creates a bare Party+Person if this is the first time this number has
// signed in. county is a required, non-nullable column on Party in the
// existing schema (asked during a fuller onboarding elsewhere); Phase 0's
// mobile-first sign-up doesn't collect it yet, so it's recorded as
// "Unknown" and left for a later profile-completion step to fill in —
// tracked as a known gap, not a permanent design choice.
func FindOrCreatePersonByMsisdn(ctx context.Context, pool *pgxpool.Pool, msisdn string) (partyID string, err error) {
	existing, err := FindPersonByMsisdn(ctx, pool, msisdn)
	if err != nil {
		return "", err
	}
	if existing != nil {
		return existing.PartyID, nil
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Prisma's @updatedAt is a client-side behaviour, not a DB default or
	// trigger — a raw INSERT has to set it explicitly or Postgres rejects
	// the row for violating the NOT NULL constraint on the column.
	err = tx.QueryRow(ctx, `
		INSERT INTO party (id, kind, county, "sourceSystem", "updatedAt")
		VALUES (gen_random_uuid(), 'PERSON', 'Unknown', 'ESOKO', now())
		RETURNING id`).Scan(&partyID)
	if err != nil {
		return "", err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO person ("partyId", "officialName", msisdn, "msisdnVerifiedAt")
		VALUES ($1, $2, $2, now())`, partyID, msisdn)
	if err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return partyID, nil
}

func MarkMsisdnVerified(ctx context.Context, pool *pgxpool.Pool, partyID string) error {
	_, err := pool.Exec(ctx, `UPDATE person SET "msisdnVerifiedAt" = now() WHERE "partyId" = $1`, partyID)
	return err
}

// UpsertPin — sets or replaces a person's PIN credential, clearing any
// lockout, same as setSubjectPin's effect in auth-credential.ts.
func UpsertPin(ctx context.Context, pool *pgxpool.Pool, partyID, pinHash string) error {
	// createdAt has a DB default (@default(now())) but updatedAt
	// (@updatedAt) does not — Prisma applies that one client-side only,
	// so a raw upsert must set it explicitly on both the insert and
	// update branches.
	_, err := pool.Exec(ctx, `
		INSERT INTO user_credential ("personId", "pinHash", "pinSetAt", "failedAttempts", "lockedUntil", "updatedAt")
		VALUES ($1, $2, now(), 0, NULL, now())
		ON CONFLICT ("personId") DO UPDATE
		SET "pinHash" = EXCLUDED."pinHash", "pinSetAt" = now(), "failedAttempts" = 0, "lockedUntil" = NULL, "updatedAt" = now()`,
		partyID, pinHash)
	return err
}

// ErrPersonNotFound mirrors auth-credential.ts's SetPinError('NOT_FOUND') —
// the PIN-reset flow only ever sets a PIN for a Person that already
// exists (they proved control of the number via OTP first); it never
// creates one, unlike FindOrCreatePersonByMsisdn's sign-up path.
var ErrPersonNotFound = errors.New("no Esoko account found with that number")

// SetSubjectPinByMsisdn — same contract as auth-credential.ts's
// setSubjectPin: upserts UserCredential (a freshly registered Person may
// have none yet) but only for a Person that already exists.
func SetSubjectPinByMsisdn(ctx context.Context, pool *pgxpool.Pool, msisdn, pinHash string) (partyID string, err error) {
	err = pool.QueryRow(ctx, `SELECT "partyId" FROM person WHERE msisdn = $1`, msisdn).Scan(&partyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrPersonNotFound
	}
	if err != nil {
		return "", err
	}
	if err := UpsertPin(ctx, pool, partyID, pinHash); err != nil {
		return "", err
	}
	return partyID, nil
}

const (
	signInMaxFailedAttempts = 5
	signInLockoutDuration   = 15 * time.Minute
)

// RecordSignInSuccess resets the lockout counter, mirroring
// auth-credential.ts's recordSignInSuccess.
func RecordSignInSuccess(ctx context.Context, pool *pgxpool.Pool, partyID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE user_credential SET "failedAttempts" = 0, "lockedUntil" = NULL, "updatedAt" = now() WHERE "personId" = $1`, partyID)
	return err
}

// RecordSignInFailure — 5-strike lockout, 15 minutes, same thresholds as
// auth-credential.ts's recordSignInFailure.
func RecordSignInFailure(ctx context.Context, pool *pgxpool.Pool, partyID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE user_credential
		SET "failedAttempts" = "failedAttempts" + 1,
		    "lockedUntil" = CASE WHEN "failedAttempts" + 1 >= $2 THEN now() + $3::interval ELSE "lockedUntil" END,
		    "updatedAt" = now()
		WHERE "personId" = $1`,
		partyID, signInMaxFailedAttempts, signInLockoutDuration.String())
	return err
}

type PersonProfile struct {
	PartyID      string
	OfficialName string
	KnownAs      *string
	Msisdn       *string
	Email        *string
}

// UpdateKnownAs sets the caller's display name ("what people actually
// call them" — the product's day-to-day name). Empty clears it back to
// the official name. Self-scoped by partyID: no capability beyond a
// valid subject session.
func UpdateKnownAs(ctx context.Context, pool *pgxpool.Pool, partyID, knownAs string) error {
	knownAs = strings.TrimSpace(knownAs)
	if len(knownAs) > 80 {
		return errors.New("name too long")
	}
	var stored *string
	if knownAs != "" {
		stored = &knownAs
	}
	res, err := pool.Exec(ctx, `UPDATE person SET "knownAs" = $1 WHERE "partyId" = $2`, stored, partyID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrPersonNotFound
	}
	return nil
}

func GetPersonProfile(ctx context.Context, pool *pgxpool.Pool, partyID string) (*PersonProfile, error) {
	var p PersonProfile
	err := pool.QueryRow(ctx, `
		SELECT "partyId", "officialName", "knownAs", msisdn, email
		FROM person WHERE "partyId" = $1`, partyID).
		Scan(&p.PartyID, &p.OfficialName, &p.KnownAs, &p.Msisdn, &p.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}
