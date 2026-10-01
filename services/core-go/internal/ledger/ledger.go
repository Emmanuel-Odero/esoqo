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
	"fmt"
	"math"

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
//
// Amounts are an exact count of cents, not KES as float64. The balance
// check below is the invariant that makes double-entry bookkeeping worth
// doing, and it cannot be enforced on a type whose arithmetic is
// approximate: the previous version compared the float sum against a
// ±0.005 tolerance, which would have accepted a genuinely unbalanced
// entry of up to half a cent. No caller could actually produce one —
// every PostEntry site today is a symmetric {+x, -x} pair, and IEEE754
// sums those to exactly zero — but the package doc above anticipates a
// three-account fee split, and that is precisely the shape where a
// float tolerance stops being harmless. See
// docs/proposals/money-representation.md.
type Posting struct {
	AccountID string
	// AmountCents is KES × 100, exact. Use [CentsFromKES] at the
	// boundary while callers still hold float64.
	AmountCents int64
}

// CentsFromKES converts a float64 KES amount to exact cents, rounding
// half away from zero.
//
// This is a migration boundary, not a permanent fixture: dbx and the
// handlers still type money as float64 (step 2 of
// docs/proposals/money-representation.md). Converting here means the
// error a caller's float already carries is captured at the nearest
// cent and cannot grow — the ledger itself does no float arithmetic.
func CentsFromKES(kes float64) int64 {
	return int64(math.Round(kes * 100))
}

// Decimal renders the amount as an exact decimal string for the
// `amount` column (Decimal(18,2) in schema.prisma). Deliberately not
// float64(cents)/100 — that would hand a float back to the driver and
// reintroduce, at the very last step, the imprecision this type exists
// to remove.
//
// Exported because two callers in dbx/treasury.go write posting rows
// inside their own transaction rather than through [PostEntry] (and so
// bypass [ValidateBalanced] — see their own comments). They still need
// to render an amount the same way this package does.
func (p Posting) Decimal() string {
	neg := p.AmountCents < 0
	abs := p.AmountCents
	if neg {
		abs = -abs
	}
	s := fmt.Sprintf("%d.%02d", abs/100, abs%100)
	if neg {
		return "-" + s
	}
	return s
}

// ValidateBalanced reports whether postings sum to exactly zero — the
// one rule every journal entry must satisfy. Split out from PostEntry
// so it is testable without a database, and so an unbalanced entry is
// rejected before any connection is taken.
func ValidateBalanced(postings []Posting) error {
	if len(postings) == 0 {
		return errors.New("ledger: entry has no postings")
	}
	var sum int64
	for _, p := range postings {
		sum += p.AmountCents
	}
	if sum != 0 {
		return fmt.Errorf("ledger: postings do not sum to zero (off by %d cents)", sum)
	}
	return nil
}

// PostEntry writes a JournalEntry + its Postings inside one
// transaction, skipped (not erred) if idempotencyKey already exists —
// the same replay guard the M-Pesa callback idempotency relies on
// elsewhere (JournalEntry.idempotencyKey is unique).
func PostEntry(ctx context.Context, pool *pgxpool.Pool, reference, description, idempotencyKey string, postings []Posting) (journalEntryID string, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	id, err := PostEntryTx(ctx, tx, reference, description, idempotencyKey, postings)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

// PostEntryTx is the in-caller's-transaction variant of PostEntry: the
// supervisor of this entry gets to decide when it commits. The two
// exist because callers that flip a status row and post money in the
// same breath need those two writes to commit atomically — the ledger
// must never record a settlement the parcel rows deny (or vice versa),
// and a PostEntry that only ever took a pool could not offer that, so a
// caller was forced into a read-then-act gap or a post-then-flip order
// that a crash in between permanently damaged.
//
// The idempotency check and the insert share the caller's transaction,
// so two replaying callers serialized on it still produce exactly one
// entry. Callers must not hold an open tx across PostEntryTx after an
// error — rollback is the caller's responsibility, matching PostEntry's
// own deferred rollback.
func PostEntryTx(ctx context.Context, tx pgx.Tx, reference, description, idempotencyKey string, postings []Posting) (journalEntryID string, err error) {
	// Balance first: an unbalanced entry is a programming error, and
	// there is no reason to spend a transaction discovering that.
	if err := ValidateBalanced(postings); err != nil {
		return "", err
	}

	var existing string
	err = tx.QueryRow(ctx, `SELECT id FROM journal_entry WHERE "idempotencyKey" = $1`, idempotencyKey).Scan(&existing)
	if err == nil {
		return existing, nil // already posted — replayed callback, not an error
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

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
			VALUES (gen_random_uuid(), $1, $2, $3::numeric)`, journalEntryID, p.AccountID, p.Decimal())
		if err != nil {
			return "", err
		}
	}
	return journalEntryID, nil
}
