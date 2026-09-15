// Package dbx (bills.go) — a personal bill tracker, track-and-remind by
// default (see the Bill model's own doc comment in schema.prisma):
// nothing in CreateBill/MarkBillPaid/UpdateBill/ArchiveBill moves
// money, unlike every other payment-shaped model in this schema.
// BillContribution is the one exception — a bill with a targetKes set
// accepts real money (M-Pesa, ledger-posted) from named contributors,
// same "who put in what, when" discipline as GroupContribution. No TS
// DAL to port from — this is new.
package dbx

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/ledger"
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
	TargetKES          *string
	AutoPayEnabled     bool
	// Derived, computed at read time — never stored.
	DaysUntilDue int
	Overdue      bool
	DueSoon      bool
	// RaisedKES — sum of PAID BillContribution rows since the bill's
	// last payment (or since creation, if never paid). Only meaningful
	// when TargetKES is set; zero otherwise. Same "derived, never
	// stored" rule as every balance in this codebase.
	RaisedKES string
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
		SELECT id, label, category, "accountRef", "amountKes"::text, cycle, "nextDueAt", "reminderDaysBefore", status,
			"targetKes"::text, "autoPayEnabled"
		FROM bill WHERE "partyId" = $1 AND status = 'ACTIVE'
		ORDER BY "nextDueAt" ASC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BillRow
	for rows.Next() {
		var b BillRow
		if err := rows.Scan(&b.ID, &b.Label, &b.Category, &b.AccountRef, &b.AmountKES, &b.Cycle, &b.NextDueAt, &b.ReminderDaysBefore, &b.Status, &b.TargetKES, &b.AutoPayEnabled); err != nil {
			return nil, err
		}
		annotate(&b)
		out = append(out, b)
	}
	for i := range out {
		if out[i].TargetKES != nil {
			raised, err := sumPaidContributionsSinceLastPayment(ctx, pool, out[i].ID)
			if err != nil {
				return nil, err
			}
			out[i].RaisedKES = strconv.FormatFloat(raised, 'f', 2, 64)
		} else {
			out[i].RaisedKES = "0.00"
		}
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
	Label          *string
	AccountRef     *string
	AmountKES      *float64
	NextDueAt      *time.Time
	TargetKES      *float64
	AutoPayEnabled *bool
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
	if in.TargetKES != nil {
		if _, err := pool.Exec(ctx, `UPDATE bill SET "targetKes" = $1, "updatedAt" = now() WHERE id = $2`, *in.TargetKES, billID); err != nil {
			return err
		}
	}
	if in.AutoPayEnabled != nil {
		if _, err := pool.Exec(ctx, `UPDATE bill SET "autoPayEnabled" = $1, "updatedAt" = now() WHERE id = $2`, *in.AutoPayEnabled, billID); err != nil {
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

// ── bill funding: real money via BillContribution ──────────────────

// BillFundingSummary is the guest-safe view a shared "help fund this
// bill" link resolves to — label and progress only, never accountRef
// (a meter/account number) or the owner's identity, same PII-minimal
// rule every other public-safe projection in this codebase follows.
type BillFundingSummary struct {
	BillID            string
	Label             string
	Category          string
	TargetKES         string
	RaisedKES         string
	ContributorsCount int
	Funded            bool
}

var ErrBillNotFound = errors.New("bill not found")
var ErrBillNotFunding = errors.New("this bill isn't accepting contributions")

func GetBillFundingSummary(ctx context.Context, pool *pgxpool.Pool, billID string) (*BillFundingSummary, error) {
	var label, category string
	var targetKES *string
	if err := pool.QueryRow(ctx, `
		SELECT label, category, "targetKes"::text FROM bill WHERE id = $1 AND status = 'ACTIVE'`, billID).
		Scan(&label, &category, &targetKES); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrBillNotFound
		}
		return nil, err
	}
	if targetKES == nil {
		return nil, ErrBillNotFunding
	}
	since, err := lastPaymentOrCreatedAt(ctx, pool, billID)
	if err != nil {
		return nil, err
	}
	raised, err := sumPaidContributionsSince(ctx, pool, billID, since)
	if err != nil {
		return nil, err
	}
	target, err := strconv.ParseFloat(*targetKES, 64)
	if err != nil {
		return nil, err
	}
	// Scoped to the same current-cycle window as raised, above — a
	// contributor from a bill's previous, already-paid cycle shouldn't
	// count toward "who's chipped in" for this one.
	var count int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM bill_contribution WHERE "billId" = $1 AND status = 'PAID' AND "createdAt" > $2`, billID, since).Scan(&count); err != nil {
		return nil, err
	}
	return &BillFundingSummary{
		BillID: billID, Label: label, Category: category,
		TargetKES: *targetKES, RaisedKES: strconv.FormatFloat(raised, 'f', 2, 64),
		ContributorsCount: count, Funded: raised >= target,
	}, nil
}

// lastPaymentOrCreatedAt is the current funding cycle's start: the
// most recent BillPayment, or the bill's own creation if it's never
// been paid — contributions before that boundary belong to an already
// -settled cycle and don't count toward the next target, the same
// reason a MONTHLY bill's nextDueAt resets each cycle instead of
// accumulating forever.
func lastPaymentOrCreatedAt(ctx context.Context, pool *pgxpool.Pool, billID string) (time.Time, error) {
	var since time.Time
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(MAX("paidAt"), (SELECT "createdAt" FROM bill WHERE id = $1))
		FROM bill_payment WHERE "billId" = $1`, billID).Scan(&since)
	return since, err
}

func sumPaidContributionsSince(ctx context.Context, pool *pgxpool.Pool, billID string, since time.Time) (float64, error) {
	var sumText *string
	if err := pool.QueryRow(ctx, `
		SELECT SUM("amountKes")::text FROM bill_contribution
		WHERE "billId" = $1 AND status = 'PAID' AND "createdAt" > $2`, billID, since).Scan(&sumText); err != nil {
		return 0, err
	}
	if sumText == nil {
		return 0, nil
	}
	return strconv.ParseFloat(*sumText, 64)
}

// sumPaidContributionsSinceLastPayment is the common-case wrapper
// (ListMyBills, the auto-pay threshold check) that don't need the
// cycle boundary for anything else.
func sumPaidContributionsSinceLastPayment(ctx context.Context, pool *pgxpool.Pool, billID string) (float64, error) {
	since, err := lastPaymentOrCreatedAt(ctx, pool, billID)
	if err != nil {
		return 0, err
	}
	return sumPaidContributionsSince(ctx, pool, billID, since)
}

// ContributeToBill starts a PENDING contribution — mirrors
// DeclareContribution's shape (a fact recorded now, settled once the
// M-Pesa STK confirms). Only a bill with targetKes set accepts
// contributions; contributorPartyID is nil for a guest giver.
func ContributeToBill(ctx context.Context, pool *pgxpool.Pool, billID string, contributorPartyID *string, contributorName string, amountKES float64) (string, error) {
	if amountKES <= 0 {
		return "", errors.New("amount must be above zero")
	}
	var targetKES *string
	var status string
	if err := pool.QueryRow(ctx, `SELECT "targetKes"::text, status FROM bill WHERE id = $1`, billID).Scan(&targetKES, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrBillNotFound
		}
		return "", err
	}
	if targetKES == nil || status != "ACTIVE" {
		return "", ErrBillNotFunding
	}
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO bill_contribution (id, "billId", "contributorPartyId", "contributorName", "amountKes", status, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PENDING', now())
		RETURNING id`, billID, contributorPartyID, contributorName, amountKES).Scan(&id)
	return id, err
}

func AttachBillContributionCheckoutRequestID(ctx context.Context, pool *pgxpool.Pool, contributionID, checkoutRequestID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE bill_contribution SET "mpesaCheckoutRequestId" = $1 WHERE id = $2`, checkoutRequestID, contributionID)
	return err
}

var ErrBillContributionNotFound = errors.New("no bill contribution for that checkout request")

// ConfirmBillContributionByCheckoutID settles the contribution
// (SETTLEMENT <-> the bill owner's own BILL_FUNDING account — the
// same 2-account shape every ledger.go caller in this package uses),
// then checks whether this cycle's contributions now meet the target:
// if autoPayEnabled, that's an auto "mark paid" — the same effect a
// manual tap on MarkBillPaid has, just threshold-triggered instead of
// tap-triggered.
func ConfirmBillContributionByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID string) (contributionID string, alreadyConfirmed bool, err error) {
	var id, billID, contributorName, amountText, status string
	err = pool.QueryRow(ctx, `
		SELECT id, "billId", "contributorName", "amountKes"::text, status FROM bill_contribution
		WHERE "mpesaCheckoutRequestId" = $1`, checkoutRequestID).
		Scan(&id, &billID, &contributorName, &amountText, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, ErrBillContributionNotFound
	}
	if err != nil {
		return "", false, err
	}
	if status == "PAID" {
		return id, true, nil
	}

	amountKES, err := strconv.ParseFloat(amountText, 64)
	if err != nil {
		return "", false, err
	}
	var billOwnerPartyID string
	if err := pool.QueryRow(ctx, `SELECT "partyId" FROM bill WHERE id = $1`, billID).Scan(&billOwnerPartyID); err != nil {
		return "", false, err
	}

	settlement, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return "", false, err
	}
	funding, err := ledger.EnsureAccount(ctx, pool, &billOwnerPartyID, "BILL_FUNDING", "KES")
	if err != nil {
		return "", false, err
	}
	entryID, err := ledger.PostEntry(ctx, pool, "bill-contribution:"+id, "Bill contribution from "+contributorName, "core-go:bill-contribution:"+checkoutRequestID,
		[]ledger.Posting{{AccountID: settlement, AmountCents: ledger.CentsFromKES(amountKES)}, {AccountID: funding, AmountCents: ledger.CentsFromKES(-amountKES)}})
	if err != nil {
		return "", false, err
	}
	if _, err := pool.Exec(ctx, `
		UPDATE bill_contribution SET status = 'PAID', "journalEntryId" = $1 WHERE id = $2`, entryID, id); err != nil {
		return "", false, err
	}

	var targetKES *string
	var autoPayEnabled bool
	if err := pool.QueryRow(ctx, `SELECT "targetKes"::text, "autoPayEnabled" FROM bill WHERE id = $1`, billID).Scan(&targetKES, &autoPayEnabled); err != nil {
		return "", false, err
	}
	if targetKES != nil && autoPayEnabled {
		target, err := strconv.ParseFloat(*targetKES, 64)
		if err != nil {
			return "", false, err
		}
		raised, err := sumPaidContributionsSinceLastPayment(ctx, pool, billID)
		if err != nil {
			return "", false, err
		}
		if raised >= target {
			note := "Auto-paid from contributions"
			if err := MarkBillPaid(ctx, pool, billID, raised, &note); err != nil {
				return "", false, err
			}
		}
	}
	return id, false, nil
}

// BillContributionRow — one line on the bill's "who's chipped in" list.
type BillContributionRow struct {
	ContributorName string
	AmountKES       string
	Status          string
	CreatedAt       time.Time
}

func ListBillContributions(ctx context.Context, pool *pgxpool.Pool, billID string) ([]BillContributionRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT "contributorName", "amountKes"::text, status::text, "createdAt"
		FROM bill_contribution WHERE "billId" = $1 AND status = 'PAID'
		ORDER BY "createdAt" DESC`, billID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BillContributionRow
	for rows.Next() {
		var r BillContributionRow
		if err := rows.Scan(&r.ContributorName, &r.AmountKES, &r.Status, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
