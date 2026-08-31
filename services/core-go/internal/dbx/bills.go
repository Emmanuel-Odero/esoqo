// Package dbx (bills.go) — a personal bill tracker, track-and-remind
// only (see the plan this shipped from and the Bill model's own doc
// comment in schema.prisma): nothing here moves money, unlike every
// other payment-shaped model in this schema. No TS DAL to port from —
// this is new.
package dbx

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CreateBillInput struct {
	PartyID            string
	Label              string
	Category           string
	AccountRef         *string
	AmountKES          *float64
	Cycle              string // MONTHLY | WEEKLY | ONE_TIME
	NextDueAt          time.Time
	ReminderDaysBefore int
}

func CreateBill(ctx context.Context, pool *pgxpool.Pool, in CreateBillInput) (string, error) {
	if in.Label == "" {
		return "", errors.New("give this bill a name")
	}
	if in.ReminderDaysBefore <= 0 {
		in.ReminderDaysBefore = 3
	}
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO bill (id, "partyId", label, category, "accountRef", "amountKes", cycle, "nextDueAt", "reminderDaysBefore", status, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', now(), now())
		RETURNING id`,
		in.PartyID, in.Label, in.Category, in.AccountRef, in.AmountKES, in.Cycle, in.NextDueAt, in.ReminderDaysBefore).Scan(&id)
	return id, err
}

type BillRow struct {
	ID                 string
	Label              string
	Category           string
	AccountRef         *string
	AmountKES          *string
	Cycle              string
	NextDueAt          time.Time
	ReminderDaysBefore int
	Status             string
	// Derived, computed at read time — never stored.
	DaysUntilDue int
	Overdue      bool
	DueSoon      bool
}

func annotate(b *BillRow) {
	days := int(time.Until(b.NextDueAt).Hours() / 24)
	b.DaysUntilDue = days
	b.Overdue = days < 0
	b.DueSoon = !b.Overdue && days <= b.ReminderDaysBefore
}

// ListMyBills — every ACTIVE bill for this person, soonest-due first,
// each annotated with the derived overdue/due-soon indicators the
// bills_list_screen groups by. "Reminder" here means this in-app
// indicator only — there is no push-notification wiring in this app.
func ListMyBills(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]BillRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, label, category, "accountRef", "amountKes"::text, cycle, "nextDueAt", "reminderDaysBefore", status
		FROM bill WHERE "partyId" = $1 AND status = 'ACTIVE'
		ORDER BY "nextDueAt" ASC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BillRow
	for rows.Next() {
		var b BillRow
		if err := rows.Scan(&b.ID, &b.Label, &b.Category, &b.AccountRef, &b.AmountKES, &b.Cycle, &b.NextDueAt, &b.ReminderDaysBefore, &b.Status); err != nil {
			return nil, err
		}
		annotate(&b)
		out = append(out, b)
	}
	return out, rows.Err()
}

func GetBillOwner(ctx context.Context, pool *pgxpool.Pool, billID string) (string, error) {
	var partyID string
	err := pool.QueryRow(ctx, `SELECT "partyId" FROM bill WHERE id = $1`, billID).Scan(&partyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return partyID, err
}

// MarkBillPaid logs a BillPayment and, for a recurring bill, advances
// nextDueAt by one cycle — the "recurring" half of a real bill tracker.
// A ONE_TIME bill is archived instead, since there's nothing left to
// track once it's paid.
func MarkBillPaid(ctx context.Context, pool *pgxpool.Pool, billID string, amountKES float64, note *string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var cycle string
	var nextDueAt time.Time
	if err := tx.QueryRow(ctx, `SELECT cycle, "nextDueAt" FROM bill WHERE id = $1 FOR UPDATE`, billID).Scan(&cycle, &nextDueAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("bill not found")
		}
		return err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO bill_payment (id, "billId", "amountKes", "paidAt", note)
		VALUES (gen_random_uuid(), $1, $2, now(), $3)`, billID, amountKES, note)
	if err != nil {
		return err
	}

	switch cycle {
	case "MONTHLY":
		_, err = tx.Exec(ctx, `UPDATE bill SET "nextDueAt" = $1, "updatedAt" = now() WHERE id = $2`, nextDueAt.AddDate(0, 1, 0), billID)
	case "WEEKLY":
		_, err = tx.Exec(ctx, `UPDATE bill SET "nextDueAt" = $1, "updatedAt" = now() WHERE id = $2`, nextDueAt.AddDate(0, 0, 7), billID)
	default: // ONE_TIME
		_, err = tx.Exec(ctx, `UPDATE bill SET status = 'ARCHIVED', "updatedAt" = now() WHERE id = $1`, billID)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type UpdateBillInput struct {
	Label      *string
	AccountRef *string
	AmountKES  *float64
	NextDueAt  *time.Time
}

func UpdateBill(ctx context.Context, pool *pgxpool.Pool, billID string, in UpdateBillInput) error {
	if in.Label != nil {
		if _, err := pool.Exec(ctx, `UPDATE bill SET label = $1, "updatedAt" = now() WHERE id = $2`, *in.Label, billID); err != nil {
			return err
		}
	}
	if in.AccountRef != nil {
		if _, err := pool.Exec(ctx, `UPDATE bill SET "accountRef" = $1, "updatedAt" = now() WHERE id = $2`, *in.AccountRef, billID); err != nil {
			return err
		}
	}
	if in.AmountKES != nil {
		if _, err := pool.Exec(ctx, `UPDATE bill SET "amountKes" = $1, "updatedAt" = now() WHERE id = $2`, *in.AmountKES, billID); err != nil {
			return err
		}
	}
	if in.NextDueAt != nil {
		if _, err := pool.Exec(ctx, `UPDATE bill SET "nextDueAt" = $1, "updatedAt" = now() WHERE id = $2`, *in.NextDueAt, billID); err != nil {
			return err
		}
	}
	return nil
}

func ArchiveBill(ctx context.Context, pool *pgxpool.Pool, billID string) error {
	_, err := pool.Exec(ctx, `UPDATE bill SET status = 'ARCHIVED', "updatedAt" = now() WHERE id = $1`, billID)
	return err
}
