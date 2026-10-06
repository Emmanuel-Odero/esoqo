package dbx

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/ledger"
	"github.com/esoqo/core-go/internal/loyalty"
)

// Paying an Esoqo business straight from a VoucherCard balance — the
// cheapest possible transaction on the platform, since neither leg
// touches M-Pesa: value already sitting in VOUCHER_FLOAT (see
// ConfirmVoucherLoadByCheckoutID) moves to the business's own
// BUSINESS_REVENUE account, same shape SettleStoreOrderVoucher already
// uses for a store checkout, just against an arbitrary business instead
// of a specific StoreOrder.

var ErrBusinessNotPayable = errors.New("that business cannot receive payments")

// VoucherBusinessPaymentResult — what a caller needs to show a receipt:
// the voucher's new balance and who was paid.
type VoucherBusinessPaymentResult struct {
	Voucher      *Voucher
	BusinessName string
	BusinessID   string
}

// resolvePayableBusiness mirrors the guarantees dal/business-payment.ts's
// findPayableBusinesses enforces on the TS side — not deleted, an actual
// ORGANISATION, and an issued, unsuspended Esoqo Payment ID — trying the
// identifier as typed, upper-cased and lower-cased so a scanner's stray
// case doesn't miss a real match. Handles are minted lower-case, so the
// lower-cased variant is the one that normally lands.
func resolvePayableBusiness(ctx context.Context, pool *pgxpool.Pool, identifier string) (partyID, name string, err error) {
	raw := strings.TrimSpace(identifier)
	if raw == "" {
		return "", "", &FleetError{"BAD_INPUT", "Enter the business's Esoqo ID"}
	}
	err = pool.QueryRow(ctx, `
		SELECT p.id, COALESCE(o."knownAs", o."officialName")
		FROM party p
		JOIN organisation o ON o."partyId" = p.id
		JOIN esoko_payment_id e ON e."partyId" = p.id
		WHERE p."deletedAt" IS NULL AND p.kind = 'ORGANISATION'
		  AND e."suspendedAt" IS NULL
		  AND e.code IN ($1, $2, $3)
		LIMIT 1`,
		raw, strings.ToUpper(raw), strings.ToLower(raw)).Scan(&partyID, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", &FleetError{"NOT_FOUND", "That business cannot receive payments"}
	}
	return partyID, name, err
}

// SpendVoucherAtBusiness debits a SHOPPING|GENERAL voucher and credits the
// named business's BUSINESS_REVENUE account. refID is the caller's
// idempotency key — a repeat with the same refID is a no-op (see
// SpendVoucher's own EXISTS check), the same guarantee every other
// SpendVoucher caller in this package relies on.
func SpendVoucherAtBusiness(
	ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx,
	voucherID, businessIdentifier string, amountKes float64, refID string,
) (*VoucherBusinessPaymentResult, error) {
	if amountKes <= 0 {
		return nil, &FleetError{"BAD_INPUT", "Enter an amount above zero"}
	}
	v, err := GetVoucher(ctx, pool, voucherID)
	if err != nil {
		return nil, err
	}
	if v.Status != "ACTIVE" {
		return nil, ErrVoucherFrozen
	}
	if v.OwnerPartyID != c.PartyID {
		if err := authsvc.RequireCapability(c, authsvc.CapVoucherSpend, nil); err != nil {
			return nil, ErrVoucherNotOwner
		}
	}

	businessID, businessName, err := resolvePayableBusiness(ctx, pool, businessIdentifier)
	if err != nil {
		return nil, err
	}

	floatAcct, err := ledger.EnsureAccount(ctx, pool, nil, "VOUCHER_FLOAT", "KES")
	if err != nil {
		return nil, err
	}
	revenue, err := ledger.EnsureAccount(ctx, pool, &businessID, "BUSINESS_REVENUE", "KES")
	if err != nil {
		return nil, err
	}
	// Same sign convention SettleStoreOrderVoucher already established for
	// a voucher-funded purchase: the source of funds (there, SETTLEMENT;
	// here, VOUCHER_FLOAT) is posted positive and the recipient's revenue
	// account negative.
	entryID, err := ledger.PostEntry(ctx, pool, "voucher-business-payment:"+refID, "Voucher payment to "+businessName, "core-go:voucher-business-payment:"+refID,
		[]ledger.Posting{{AccountID: floatAcct, AmountCents: ledger.CentsFromKES(amountKes)}, {AccountID: revenue, AmountCents: ledger.CentsFromKES(-amountKes)}})
	if err != nil {
		return nil, err
	}

	points := loyalty.PointsForKES(amountKes)
	if err := SpendVoucher(ctx, pool, voucherID, "SHOPPING,GENERAL", points, refID, entryID); err != nil {
		return nil, err
	}

	updated, err := GetVoucher(ctx, pool, voucherID)
	if err != nil {
		return nil, err
	}
	return &VoucherBusinessPaymentResult{Voucher: updated, BusinessName: businessName, BusinessID: businessID}, nil
}
