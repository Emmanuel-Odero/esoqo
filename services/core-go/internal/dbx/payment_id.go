package dbx

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/handlecode"
)

// execer/querier let the payment-id mint run against either the pool or an
// open transaction. Group creation has to allocate its handle inside the
// same transaction that creates the group — minting on the pool would leave
// an orphan esoko_payment_id row pointing at an organisation that a
// rollback then erases, and would report success for a handle the caller
// cannot reach.
type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// EnsureEsoqoPaymentId ports packages/db/src/dal/payment-id.ts's
// issueEsoqoPaymentId, minus the capability check (core-go already knows
// this is the signed-in person's own party — see handleMe) — plus the
// MSISDN_VERIFIED Attestation packages/db/src/dal/registration.ts
// creates alongside a freshly-verified Person, since core-go's own
// sign-up flow (FindOrCreatePersonByMsisdn) doesn't write one yet.
// Idempotent: returns the existing code if one's already issued.
func EnsureEsoqoPaymentId(ctx context.Context, pool *pgxpool.Pool, partyID, msisdn string) (string, error) {
	var existing string
	err := pool.QueryRow(ctx, `SELECT code FROM esoko_payment_id WHERE "partyId" = $1`, partyID).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	names, err := namesForParty(ctx, pool, partyID)
	if err != nil {
		return "", err
	}
	if err := ensureMsisdnVerifiedAttestation(ctx, pool, partyID, msisdn); err != nil {
		return "", err
	}
	return insertPaymentIDCode(ctx, pool, partyID, names)
}

// EnsureBusinessPaymentID is the organisation-shaped counterpart of
// EnsureEsoqoPaymentId, and the difference is the whole point of it.
//
// A business is what customers pay, so it needs a code — and it can
// never satisfy EnsureEsoqoPaymentId, which mints only against an
// MSISDN_VERIFIED attestation. An ORGANISATION has no phone number to
// verify, so requiring that attestation here would mean a business could
// never be paid, and quietly writing one with an empty MSISDN would be
// worse: a fabricated trust claim on the record.
//
// A business's standing comes from its Membership — who is on it, and
// whether they are an officer — so no attestation is written here. See
// issueBusinessEsoqoPaymentId in packages/db, which is the
// capability-checked version of the same rule.
//
// Like its counterpart, idempotent: returns the existing code if the
// business already has one, so re-seeding never invalidates a printed QR
// stand.
func EnsureBusinessPaymentID(ctx context.Context, pool *pgxpool.Pool, partyID string) (string, error) {
	var existing string
	err := pool.QueryRow(ctx, `SELECT code FROM esoko_payment_id WHERE "partyId" = $1`, partyID).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	names, err := namesForParty(ctx, pool, partyID)
	if err != nil {
		return "", err
	}
	return insertPaymentIDCode(ctx, pool, partyID, names)
}

// insertPaymentIDCode mints a name-derived handle and stores it, treating
// the unique constraint as the only authority on collisions. Deliberately
// does not pre-check for a clash: a check-then-insert leaves a window in
// which a concurrent minter can take the code, and the loser then sees a
// raw 23505.
//
// The retry budget is spent across several mnemonic candidates rather than
// re-rolling one. The old ESK- codes had ~8.9e8 fully-random shapes and
// could not realistically exhaust on five attempts; a name-derived handle
// has no such room — the letters come from the names, so a popular pair
// like John Kamau shares one mnemonic across every member, and its 1,000
// three-digit tails are a ceiling that does grow with the user base.
func insertPaymentIDCode(ctx context.Context, db execer, partyID string, names []string) (string, error) {
	if len(handlecode.PersonHandleCandidates(names)) == 0 {
		return "", errors.New("could not derive a Payment ID — this person has no usable name")
	}
	var lastErr error
	code, ok := handlecode.MintHandle(handlecode.PersonHandleCandidates(names), func(candidate string) bool {
		_, err := db.Exec(ctx, `
			INSERT INTO esoko_payment_id ("partyId", code, "activatedAt")
			VALUES ($1, $2, now())`, partyID, candidate)
		if err == nil {
			return true
		}
		lastErr = err
		return false
	})
	if ok {
		return code, nil
	}
	if lastErr != nil && !isUniqueViolation(lastErr) {
		return "", lastErr
	}
	return "", errors.New("could not allocate a Payment ID — try again")
}

// insertOrgPaymentID stores an organisation's handle, derived from its
// name. Each mnemonic candidate gets the digit tail re-rolled a bounded
// number of times before moving to the next — an org name that is entirely
// "chama" would otherwise burn the whole budget re-rolling one saturated
// mnemonic while "wananchi" sat unused.
func insertOrgPaymentID(ctx context.Context, db execer, partyID, officialName, knownAs string) error {
	candidates := handlecode.OrgMnemonicCandidates(officialName, knownAs)
	if len(candidates) == 0 {
		return errors.New("could not derive a Payment ID — this organisation's name has no usable words")
	}
	var lastErr error
	_, ok := handlecode.MintHandle(candidates, func(candidate string) bool {
		_, err := db.Exec(ctx, `
			INSERT INTO esoko_payment_id ("partyId", code, "activatedAt")
			VALUES ($1, $2, now())`, partyID, candidate)
		if err == nil {
			return true
		}
		lastErr = err
		return false
	})
	if ok {
		return nil
	}
	if lastErr != nil && !isUniqueViolation(lastErr) {
		return lastErr
	}
	return errors.New("could not allocate a Payment ID for this organisation — try again")
}

// namesForParty reads the party's own recorded names so the handle is
// derived from the canonical record rather than from whatever a caller
// happened to have in hand — a stale or partial name would otherwise mint
// a handle that does not match the profile it is supposed to describe.
//
// A Person contributes firstName/middleName/surname (firstName and surname
// are the compulsory pair; middleName often is not). An ORGANISATION has
// only free-text officialName/knownAs, so it contributes those. Returned
// newest-role-first: the generator draws the primary name at random anyway,
// so order only matters for determinism, not meaning.
//
// A party with nothing usable yields an empty slice, which
// GenerateSystemHandle rejects — the caller surfaces that rather than
// minting a handle that says nothing about who it belongs to.
func namesForParty(ctx context.Context, db querier, partyID string) ([]string, error) {
	var names []string
	err := db.QueryRow(ctx, `
		SELECT ARRAY[
			pe."firstName", pe."middleName", pe."surname",
			org."officialName", org."knownAs"
		]
		FROM party pa
		LEFT JOIN person pe ON pe."partyId" = pa.id
		LEFT JOIN organisation org ON org."partyId" = pa.id
		WHERE pa.id = $1`, partyID).Scan(&names)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That party does not exist"}
	}
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(names))
	for _, n := range names {
		if n = strings.TrimSpace(n); n != "" {
			out = append(out, n)
		}
	}
	return out, nil
}

// ensureMsisdnVerifiedAttestation mirrors registration.ts's exact
// insert shape (claimValue: {msisdn}, method: 'API', issuedAt: the
// verification time) — idempotent via an existence check first, since
// unlike EsoqoPaymentId's code, Attestation has no unique constraint to
// upsert against.
func ensureMsisdnVerifiedAttestation(ctx context.Context, pool *pgxpool.Pool, partyID, msisdn string) error {
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT true FROM attestation
		WHERE "subjectId" = $1 AND "claimType" = 'MSISDN_VERIFIED' AND "revokedAt" IS NULL
		LIMIT 1`, partyID).Scan(&exists)
	if err == nil {
		return nil // already verified
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	claimValue, err := json.Marshal(map[string]string{"msisdn": msisdn})
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO attestation (id, "subjectId", "claimType", "claimValue", method, "issuedAt")
		VALUES (gen_random_uuid(), $1, 'MSISDN_VERIFIED', $2, 'API', now())`,
		partyID, claimValue)
	return err
}

// GetEsoqoPaymentId — read-only lookup, no side effects (used where
// callers must not accidentally provision one — e.g. a future
// staff-facing read).
func GetEsoqoPaymentId(ctx context.Context, pool *pgxpool.Pool, partyID string) (*string, error) {
	var code string
	err := pool.QueryRow(ctx, `SELECT code FROM esoko_payment_id WHERE "partyId" = $1`, partyID).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &code, nil
}

// PartyIDByEsoqoID links an existing Esoqo identity to a parcel-company
// login without creating a second person record.
func PartyIDByEsoqoID(ctx context.Context, pool *pgxpool.Pool, code string) (string, error) {
	var partyID string
	// Canonicalise to the stored shape rather than folding case blindly:
	// handles are minted lower-case, so an uppercase fold made every one of
	// them miss here.
	err := pool.QueryRow(ctx, `SELECT "partyId" FROM esoko_payment_id WHERE code = $1`, handlecode.Canonicalize(code)).Scan(&partyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &ParcelError{"NOT_FOUND", "That Esoqo ID was not found"}
	}
	return partyID, err
}

func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}

// retryUnique re-runs fn up to 5 times, re-rolling ONLY when the failure
// is a Postgres unique-constraint violation (23505) — the signal that a
// freshly-minted short code or token collided with an existing row. Any
// other error stops immediately. The DB's @unique constraints are the
// single source of truth for code uniqueness; retry is how the minters
// hold onto that guarantee without ever duplicating a code.
func retryUnique(fn func() error) error {
	var err error
	for attempt := 0; attempt < 5; attempt++ {
		err = fn()
		if err == nil || !isUniqueViolation(err) {
			return err
		}
	}
	return errors.New("could not allocate a unique code — try again")
}
