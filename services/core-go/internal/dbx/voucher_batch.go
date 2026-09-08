// Package dbx (voucher_batch.go) — an employer's one M-Pesa payment
// fanning out to N employee FUEL/TRAVEL allowance vouchers. Vouchers
// aren't minted until the batch's payment confirms — same "nothing
// exists until it's actually paid for" rule CreateStoreOrder follows —
// so this file owns its own pending/confirm pair rather than reusing
// CreateVoucher directly (that path expects an authenticated Ctx per
// voucher; a webhook confirm has none, and a batch needs one payment
// covering many vouchers, not N separate STK pushes).
package dbx

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/fleetqr"
	"github.com/esoko/core-go/internal/ledger"
)

var allowancePurposes = map[string]bool{"FUEL": true, "TRAVEL": true}

// InitiateAllowanceVoucherBatch records the batch PENDING — the
// employer is charged once (amountPerEmployeeKES × len(employeePartyIDs))
// and, on confirmation, each employee gets their own voucher. Self-
// funded only: the employer is the signed-in party paying, same
// "no separate capability plumbing needed" reasoning CreateVoucher's
// self-purchase path already uses — batch-issuing to someone else's
// employees isn't a case this ships yet.
func InitiateAllowanceVoucherBatch(ctx context.Context, pool *pgxpool.Pool, employerPartyID, purpose, label string, amountPerEmployeeKES float64, employeePartyIDs []string) (batchID string, totalKES float64, err error) {
	purpose = normalizePurpose(purpose)
	if !allowancePurposes[purpose] {
		return "", 0, &FleetError{"BAD_INPUT", "Purpose must be FUEL or TRAVEL"}
	}
	if amountPerEmployeeKES <= 0 {
		return "", 0, &FleetError{"BAD_INPUT", "Amount must be above zero"}
	}
	if len(employeePartyIDs) == 0 {
		return "", 0, &FleetError{"BAD_INPUT", "Add at least one employee"}
	}
	if len(label) < 2 {
		label = purpose + " allowance"
	}
	idsJSON, err := json.Marshal(employeePartyIDs)
	if err != nil {
		return "", 0, err
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO voucher_batch (id, "employerPartyId", purpose, label, "amountPerEmployeeKes", "employeePartyIds", status, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'PENDING', now())
		RETURNING id`,
		employerPartyID, purpose, label, amountPerEmployeeKES, idsJSON).Scan(&batchID)
	if err != nil {
		return "", 0, err
	}
	return batchID, amountPerEmployeeKES * float64(len(employeePartyIDs)), nil
}

func normalizePurpose(p string) string {
	switch p {
	case "fuel", "Fuel":
		return "FUEL"
	case "travel", "Travel":
		return "TRAVEL"
	default:
		return p
	}
}

func AttachVoucherBatchCheckoutRequestID(ctx context.Context, pool *pgxpool.Pool, batchID, checkoutRequestID string) error {
	_, err := pool.Exec(ctx, `UPDATE voucher_batch SET "mpesaCheckoutRequestId" = $1 WHERE id = $2`, checkoutRequestID, batchID)
	return err
}

var ErrVoucherBatchNotFound = errors.New("no voucher batch for that checkout request")

// ConfirmVoucherBatchByCheckoutID settles the employer's one payment
// (SETTLEMENT <-> VOUCHER_FLOAT, the same 2-account shape a self-load
// uses — see ConfirmVoucherLoadByCheckoutID) then mints one voucher
// per employee, each pre-loaded with amountPerEmployeeKes. Idempotent
// on the batch's own status: a replayed callback after ISSUED is a
// no-op, never a second mint.
func ConfirmVoucherBatchByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID, mpesaReceipt string) (batchID string, alreadyConfirmed bool, err error) {
	var id, employerPartyID, purpose, label, status string
	var amountPerEmployeeText string
	var idsJSON []byte
	err = pool.QueryRow(ctx, `
		SELECT id, "employerPartyId", purpose, label, "amountPerEmployeeKes"::text, "employeePartyIds", status
		FROM voucher_batch WHERE "mpesaCheckoutRequestId" = $1`, checkoutRequestID).
		Scan(&id, &employerPartyID, &purpose, &label, &amountPerEmployeeText, &idsJSON, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, ErrVoucherBatchNotFound
	}
	if err != nil {
		return "", false, err
	}
	if status == "ISSUED" {
		return id, true, nil
	}

	var employeePartyIDs []string
	if err := json.Unmarshal(idsJSON, &employeePartyIDs); err != nil {
		return "", false, err
	}
	amountPerEmployee, err := strconv.ParseFloat(amountPerEmployeeText, 64)
	if err != nil {
		return "", false, err
	}
	totalKES := amountPerEmployee * float64(len(employeePartyIDs))
	pointsPerEmployee := int(amountPerEmployee*10 + 0.5)

	settlement, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return "", false, err
	}
	floatAcct, err := ledger.EnsureAccount(ctx, pool, nil, "VOUCHER_FLOAT", "KES")
	if err != nil {
		return "", false, err
	}
	// entryID intentionally unused past this point: voucher_ledger_entry.
	// journalEntryId is @unique (one row per JournalEntry), and one
	// batch's single entry now backs N ledger rows below, not one — see
	// the loop's own comment. The JournalEntry/Posting rows this call
	// writes are the ledger's permanent record of the money moving;
	// nothing further needs to reference the entry id by name.
	if _, err := ledger.PostEntry(ctx, pool, "voucher-batch:"+id, "Allowance voucher batch "+label+" via M-Pesa "+mpesaReceipt, "core-go:voucher-batch:"+checkoutRequestID,
		[]ledger.Posting{{AccountID: settlement, AmountKES: totalKES}, {AccountID: floatAcct, AmountKES: -totalKES}}); err != nil {
		return "", false, err
	}

	issued := 0
	for _, employeePartyID := range employeePartyIDs {
		// Per-employee idempotency: the batch's own status flag (checked
		// above) covers a fully-completed replay, but a callback that
		// fails partway through this loop and gets retried must not
		// double-mint a voucher for an employee already loaded from
		// this exact payment.
		var alreadyMinted bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM voucher_ledger_entry vle
				JOIN voucher_card vc ON vc.id = vle."voucherId"
				WHERE vc."ownerPartyId" = $1 AND vc."giftedByPartyId" = $2
					AND vle."refId" = $3 AND vle.kind = 'LOAD_MPESA')`,
			employeePartyID, employerPartyID, checkoutRequestID).Scan(&alreadyMinted); err != nil {
			return "", false, err
		}
		if alreadyMinted {
			issued++
			continue
		}
		voucherID, err := mintAllowanceVoucher(ctx, pool, employeePartyID, employerPartyID, label, purpose)
		if err != nil {
			return "", false, err
		}
		// journalEntryId is left NULL here, not entryID: that column is
		// @unique — one row per JournalEntry — and one batch's single
		// entry now backs N voucher_ledger_entry rows, not one.
		// refId (the shared checkoutRequestID) is what ties each row
		// back to this batch's one payment; entryID itself is still
		// recorded on the JournalEntry/Posting rows the ledger already
		// wrote above.
		if _, err := pool.Exec(ctx, `
			INSERT INTO voucher_ledger_entry (id, "voucherId", points, "kesEquiv", kind, "refId", "createdAt")
			VALUES (gen_random_uuid(), $1, $2, $3, 'LOAD_MPESA', $4, now())`,
			voucherID, pointsPerEmployee, amountPerEmployee, checkoutRequestID); err != nil {
			return "", false, err
		}
		issued++
	}

	if _, err := pool.Exec(ctx, `
		UPDATE voucher_batch SET status = 'ISSUED', "issuedCount" = $1 WHERE id = $2`, issued, id); err != nil {
		return "", false, err
	}
	return id, false, nil
}

// mintAllowanceVoucher is CreateVoucher's core insert without the
// authsvc.Ctx capability check — this runs from an M-Pesa webhook
// confirm, which has no signed-in caller to check; the employer's own
// InitiateAllowanceVoucherBatch call is where authorization already
// happened (self-funded only, see that function's own comment).
func mintAllowanceVoucher(ctx context.Context, pool *pgxpool.Pool, ownerPartyID, giftedByPartyID, label, purpose string) (string, error) {
	var voucherID string
	err := retryUnique(func() error {
		qrToken := fleetqr.ShortCodeChecked(fleetqr.PrefixVoucher, 6) + randSuffix()
		shortCode := fleetqr.ShortCodeChecked(fleetqr.PrefixVoucher, 6)
		return pool.QueryRow(ctx, `
			INSERT INTO voucher_card (id, "ownerPartyId", "giftedByPartyId", label, purpose, status, "qrToken", "shortCode", "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4::"VoucherPurpose", 'ACTIVE', $5, $6, now(), now())
			RETURNING id`,
			ownerPartyID, giftedByPartyID, label, purpose, qrToken, shortCode).Scan(&voucherID)
	})
	return voucherID, err
}

// VoucherBatchRow — the employer's own "batches I've issued" list.
type VoucherBatchRow struct {
	ID                   string
	Purpose              string
	Label                string
	AmountPerEmployeeKES string
	EmployeeCount        int
	Status               string
	IssuedCount          int
	CreatedAt            string
}

func ListVoucherBatches(ctx context.Context, pool *pgxpool.Pool, employerPartyID string) ([]VoucherBatchRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, purpose, label, "amountPerEmployeeKes"::text, "employeePartyIds", status, "issuedCount", "createdAt"::text
		FROM voucher_batch WHERE "employerPartyId" = $1 ORDER BY "createdAt" DESC`, employerPartyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VoucherBatchRow
	for rows.Next() {
		var r VoucherBatchRow
		var idsJSON []byte
		if err := rows.Scan(&r.ID, &r.Purpose, &r.Label, &r.AmountPerEmployeeKES, &idsJSON, &r.Status, &r.IssuedCount, &r.CreatedAt); err != nil {
			return nil, err
		}
		var ids []string
		if err := json.Unmarshal(idsJSON, &ids); err == nil {
			r.EmployeeCount = len(ids)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
