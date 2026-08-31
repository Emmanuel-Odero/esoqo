package dbx

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EnsureEsokoPaymentId ports packages/db/src/dal/payment-id.ts's
// issueEsokoPaymentId, minus the capability check (core-go already knows
// this is the signed-in person's own party — see handleMe) — plus the
// MSISDN_VERIFIED Attestation packages/db/src/dal/registration.ts
// creates alongside a freshly-verified Person, since core-go's own
// sign-up flow (FindOrCreatePersonByMsisdn) doesn't write one yet.
// Idempotent: returns the existing code if one's already issued.
func EnsureEsokoPaymentId(ctx context.Context, pool *pgxpool.Pool, partyID, msisdn string) (string, error) {
	var existing string
	err := pool.QueryRow(ctx, `SELECT code FROM esoko_payment_id WHERE "partyId" = $1`, partyID).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	if err := ensureMsisdnVerifiedAttestation(ctx, pool, partyID, msisdn); err != nil {
		return "", err
	}

	// Same collision-retry budget as the TS version — 9,000 possible
	// codes (1000-9999) makes a clash vanishingly unlikely at pilot scale.
	for attempt := 0; attempt < 3; attempt++ {
		code, err := generatePaymentIdCode()
		if err != nil {
			return "", err
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO esoko_payment_id ("partyId", code, "activatedAt")
			VALUES ($1, $2, now())`, partyID, code)
		if err == nil {
			return code, nil
		}
		if isUniqueViolation(err) {
			continue // code clash — try another
		}
		return "", err
	}
	return "", errors.New("could not allocate a Payment ID — try again")
}

func generatePaymentIdCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(9000))
	if err != nil {
		return "", err
	}
	return "ESK-" + strconv.FormatInt(n.Int64()+1000, 10) + "-KE", nil
}

// ensureMsisdnVerifiedAttestation mirrors registration.ts's exact
// insert shape (claimValue: {msisdn}, method: 'API', issuedAt: the
// verification time) — idempotent via an existence check first, since
// unlike EsokoPaymentId's code, Attestation has no unique constraint to
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

// GetEsokoPaymentId — read-only lookup, no side effects (used where
// callers must not accidentally provision one — e.g. a future
// staff-facing read).
func GetEsokoPaymentId(ctx context.Context, pool *pgxpool.Pool, partyID string) (*string, error) {
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

func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}
