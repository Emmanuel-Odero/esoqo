// Package ledger ports the shape of the double-entry ledger every real
// money movement in the schema goes through (Account/JournalEntry/
// Posting — see schema.prisma's own comment: "Balances are always
// derived by summing Posting rows — never stored"). This is a
// simplified 2-account posting (platform SETTLEMENT <-> the seller's
// own revenue account), not the fee-split 3-account shape
// packages/db/src/dal's postStoreSale/postWarehouseFee use — a known
// simplification for the mobile buyer-side v1, flagged rather than
// silently diverging; a platform-fee split can be added once there's a
// merchant-facing reason to need it here too.
package ledger

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EnsureAccount finds or creates an Account for (partyID, kind,
// currency). partyID nil means the platform's own pooled account (e.g.
// SETTLEMENT) — Account.partyId is nullable in the schema specifically
// for this. Postgres's unique index on (partyId, kind, currency)
// doesn't treat multiple NULL partyIds as a conflict, so a plain
// ON CONFLICT upsert would create a duplicate row every call for the
// nil-partyID case; this does an explicit find-first instead.
func EnsureAccount(ctx context.Context, pool *pgxpool.Pool, partyID *string, kind, currency string) (string, error) {
	var id string
	var err error
	if partyID == nil {
		err = pool.QueryRow(ctx, `
			SELECT id FROM account WHERE "partyId" IS NULL AND kind = $1 AND currency = $2`,
			kind, currency).Scan(&id)
	} else {
		err = pool.QueryRow(ctx, `
			SELECT id FROM account WHERE "partyId" = $1 AND kind = $2 AND currency = $3`,
			*partyID, kind, currency).Scan(&id)
	}
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	err = pool.QueryRow(ctx, `
		INSERT INTO account (id, "partyId", kind, currency)
		VALUES (gen_random_uuid(), $1, $2, $3)
		RETURNING id`, partyID, kind, currency).Scan(&id)
	return id, err
}

// Posting is one leg of a journal entry. Positive Amount = debit,
// negative = credit — matching the schema's own convention (see
// Posting's doc comment). A caller's postings must sum to zero.
type Posting struct {
	AccountID string
	AmountKES float64
}

// PostEntry writes a JournalEntry + its Postings inside one
// transaction, skipped (not erred) if idempotencyKey already exists —
// the same replay guard the M-Pesa callback idempotency relies on
// elsewhere (JournalEntry.idempotencyKey is unique).
func PostEntry(ctx context.Context, pool *pgxpool.Pool, reference, description, idempotencyKey string, postings []Posting) (journalEntryID string, err error) {
	var existing string
	err = pool.QueryRow(ctx, `SELECT id FROM journal_entry WHERE "idempotencyKey" = $1`, idempotencyKey).Scan(&existing)
	if err == nil {
		return existing, nil // already posted — replayed callback, not an error
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	sum := 0.0
	for _, p := range postings {
		sum += p.AmountKES
	}
	if sum < -0.005 || sum > 0.005 { // float tolerance
		return "", errors.New("ledger: postings do not sum to zero")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	err = tx.QueryRow(ctx, `
		INSERT INTO journal_entry (id, reference, description, "occurredAt", "recordedAt", "idempotencyKey")
		VALUES (gen_random_uuid(), $1, $2, now(), now(), $3)
		RETURNING id`, reference, description, idempotencyKey).Scan(&journalEntryID)
	if err != nil {
		return "", err
	}

	for _, p := range postings {
		_, err = tx.Exec(ctx, `
			INSERT INTO posting (id, "entryId", "accountId", amount)
			VALUES (gen_random_uuid(), $1, $2, $3)`, journalEntryID, p.AccountID, p.AmountKES)
		if err != nil {
			return "", err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return journalEntryID, nil
}
