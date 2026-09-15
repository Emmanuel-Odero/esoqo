// Package dbx (voucher.go) is the Go data plane for Esoqo voucher cards.
//
// A card is purpose-locked (FARE|RENT|SHOPPING|GENERAL) and holds points
// where 10 pts == KES 1. Balance is always SUM(voucher_ledger_entry.points)
// — never stored — same rule as the money ledger. Real-money loads post a
// double-entry JournalEntry (SETTLEMENT <-> VOUCHER_FLOAT); loyalty loads
// move points 1:1 from party_loyalty_entry; spends insert a negative SPEND
// row in the same tx as the fare/order confirm.
package dbx

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/esoqo/core-go/internal/money"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/fleetqr"
	"github.com/esoqo/core-go/internal/ledger"
	"github.com/esoqo/core-go/internal/loyalty"
)

func randSuffix() string {
	const alpha = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 6)
	for i := range out {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alpha))))
		out[i] = alpha[n.Int64()]
	}
	return string(out)
}

var (
	ErrVoucherNotFound     = errors.New("voucher not found")
	ErrVoucherFrozen       = errors.New("voucher is frozen")
	ErrVoucherExpired      = errors.New("voucher is expired")
	ErrVoucherWrongPurpose = errors.New("voucher cannot be used for this purchase")
	ErrVoucherInsufficient = errors.New("voucher balance too low")
	ErrVoucherNotOwner     = errors.New("voucher belongs to someone else")
	ErrVoucherLoadNotFound = errors.New("no voucher load for that checkout request")
)

var voucherPurposes = map[string]bool{"FARE": true, "RENT": true, "SHOPPING": true, "GENERAL": true, "FUEL": true, "TRAVEL": true}

// Voucher is the card row plus derived balance.
type Voucher struct {
	ID              string
	OwnerPartyID    string
	GiftedByPartyID *string
	Label           string
	Purpose         string
	Status          string
	QrToken         string
	QrSig           string
	ShortCode       string
	ExpiresAt       *string
	BalancePoints   int
	BalanceKES      money.Amount
	CreatedAt       string
}

func validPurpose(p string) bool { return voucherPurposes[strings.ToUpper(p)] }

// CreateVoucher mints a card for owner (recipient for gifts). giftedBy may
// be nil for self-purchase. Starts with zero balance; caller loads after.
func CreateVoucher(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, ownerPartyID, giftedBy *string, label, purpose string, expiresAt *time.Time, qrSecret string) (*Voucher, error) {
	if err := authsvc.RequireCapability(c, authsvc.CapVoucherCreate, map[string]string{"partyId": derefStr(ownerPartyID)}); err != nil {
		// Self-purchase fallback: a SUBJECT creating for their own party.
		if rerr := authsvc.RequireCapability(c, "voucher.create:own", map[string]string{"partyId": derefStr(ownerPartyID)}); rerr != nil {
			return nil, err
		}
		if c.PartyID == "" || (ownerPartyID != nil && *ownerPartyID != "" && *ownerPartyID != c.PartyID) {
			// Gifting to others requires the unrestricted grant.
			return nil, err
		}
	}
	purpose = strings.ToUpper(strings.TrimSpace(purpose))
	if !validPurpose(purpose) {
		return nil, &FleetError{"BAD_INPUT", "Purpose must be FARE, RENT, SHOPPING or GENERAL"}
	}
	if len(strings.TrimSpace(label)) < 2 {
		label = purpose + " voucher"
	}
	owner := derefStr(ownerPartyID)
	if owner == "" {
		owner = c.PartyID
	}
	if owner == "" {
		return nil, &FleetError{"BAD_INPUT", "Sign in to create a voucher"}
	}
	var v Voucher
	// Both shortCode and qrToken are @unique columns. Collisions are
	// astronomically unlikely per mint but certain at enough vouchers
	// (birthday: 31^7 ≈ 27.5B shapes), so re-roll on a unique violation
	// instead of failing the request — the DB stays the single source of
	// truth for "has this code been taken" and no code is ever duplicated.
	var qrToken, shortCode string
	err := retryUnique(func() error {
		// Re-roll the codes each attempt: a 23505 means one of the two
		// freshly-minted values already exists.
		qrToken = fleetqr.ShortCodeChecked(fleetqr.PrefixVoucher, 6) + randSuffix()
		shortCode = fleetqr.ShortCodeChecked(fleetqr.PrefixVoucher, 6)
		return pool.QueryRow(ctx, `
			INSERT INTO voucher_card (id, "ownerPartyId", "giftedByPartyId", label, purpose, status, "qrToken", "shortCode", "expiresAt", "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4::"VoucherPurpose", 'ACTIVE', $5, $6, $7, now(), now())
			RETURNING id, "ownerPartyId", "giftedByPartyId", label, purpose::text, status::text, "qrToken", "shortCode", "expiresAt"::text, "createdAt"::text`,
			owner, giftedBy, label, purpose, qrToken, shortCode, expiresAt).
			Scan(&v.ID, &v.OwnerPartyID, &v.GiftedByPartyID, &v.Label, &v.Purpose, &v.Status, &v.QrToken, &v.ShortCode, &v.ExpiresAt, &v.CreatedAt)
	})
	if err != nil {
		return nil, err
	}
	v.QrSig = fleetqr.Sign(qrSecret, "voucher", v.ID)
	return &v, nil
}

// QrSig is transient (not a column) — attached for scan rendering.
func (v *Voucher) QrPayload(qrSecret string) string {
	return fleetqr.VoucherPayload(v.ID, fleetqr.Sign(qrSecret, "voucher", v.ID))
}

// VoucherBalance sums non-pending entries.
func VoucherBalance(ctx context.Context, pool *pgxpool.Pool, voucherID string) (int, error) {
	var bal int
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(points),0)::int FROM voucher_ledger_entry
		WHERE "voucherId" = $1 AND kind IN ('LOAD_MPESA','LOAD_LOYALTY','SPEND','ADJUST','GIFT_CREATE')`,
		voucherID).Scan(&bal)
	return bal, err
}

func scanVoucherRow(v *Voucher, bal int) {
	v.BalancePoints = bal
	// Points convert to KES at a fixed rate; the result is what a holder
	// is shown and spends against, so it lands on an exact cent.
	v.BalanceKES = money.AmountFromKES(loyalty.KesForPoints(bal))
}

// GetVoucher loads a card + balance. Owner, giver, or staff with
// voucher.read may view; enforced by caller via canSeeVoucher.
func GetVoucher(ctx context.Context, pool *pgxpool.Pool, voucherID string) (*Voucher, error) {
	var v Voucher
	err := pool.QueryRow(ctx, `
		SELECT id, "ownerPartyId", "giftedByPartyId", label, purpose::text, status::text, "qrToken", "shortCode", "expiresAt"::text, "createdAt"::text
		FROM voucher_card WHERE id = $1`, voucherID).
		Scan(&v.ID, &v.OwnerPartyID, &v.GiftedByPartyID, &v.Label, &v.Purpose, &v.Status, &v.QrToken, &v.ShortCode, &v.ExpiresAt, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrVoucherNotFound
	}
	if err != nil {
		return nil, err
	}
	bal, err := VoucherBalance(ctx, pool, v.ID)
	if err != nil {
		return nil, err
	}
	scanVoucherRow(&v, bal)
	return &v, nil
}

// ResolveVoucherByCode accepts uuid, shortCode (VCH-XXXXXX), qrToken, or
// full esoqo://v payload.
func ResolveVoucherByCode(ctx context.Context, pool *pgxpool.Pool, code string) (*Voucher, error) {
	code = strings.TrimSpace(code)
	if id, sig := fleetqr.ParseVoucherPayload(code); id != "" && sig != "" {
		v, err := GetVoucher(ctx, pool, id)
		if err != nil {
			return nil, err
		}
		v.QrSig = sig
		return v, nil
	}
	var id string
	upper := strings.ToUpper(code)
	err := pool.QueryRow(ctx, `SELECT id FROM voucher_card WHERE id::text = $1 OR "shortCode" = $2 OR "qrToken" = $3 LIMIT 1`, code, upper, code).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrVoucherNotFound
	}
	if err != nil {
		return nil, err
	}
	return GetVoucher(ctx, pool, id)
}

// ListMyVouchers returns owner's cards newest-first with balances.
func ListMyVouchers(ctx context.Context, pool *pgxpool.Pool, ownerPartyID string) ([]Voucher, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, "ownerPartyId", "giftedByPartyId", label, purpose::text, status::text, "qrToken", "shortCode", "expiresAt"::text, "createdAt"::text
		FROM voucher_card WHERE "ownerPartyId" = $1 ORDER BY "createdAt" DESC LIMIT 100`, ownerPartyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Voucher
	for rows.Next() {
		var v Voucher
		if err := rows.Scan(&v.ID, &v.OwnerPartyID, &v.GiftedByPartyID, &v.Label, &v.Purpose, &v.Status, &v.QrToken, &v.ShortCode, &v.ExpiresAt, &v.CreatedAt); err != nil {
			return nil, err
		}
		bal, _ := VoucherBalance(ctx, pool, v.ID)
		scanVoucherRow(&v, bal)
		out = append(out, v)
	}
	return out, rows.Err()
}

// AttachVoucherCheckoutRequestID stores the STK checkout for a pending load.
func AttachVoucherCheckoutRequestID(ctx context.Context, pool *pgxpool.Pool, voucherID, checkoutID string, expectPoints int) error {
	_, err := pool.Exec(ctx, `UPDATE voucher_card SET "mpesaCheckoutRequestId" = $1, "updatedAt" = now() WHERE id = $2`, checkoutID, voucherID)
	if err != nil {
		return err
	}
	// Pending marker excluded from balance; carries the expected amount
	// for the webhook confirm (which only sees the checkout id).
	_, err = pool.Exec(ctx, `INSERT INTO voucher_ledger_entry (id, "voucherId", points, "kesEquiv", kind, "refId", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, 'LOAD_MPESA_PENDING', $4, now()) ON CONFLICT DO NOTHING`,
		voucherID, expectPoints, loyalty.KesForPoints(expectPoints), checkoutID)
	return err
}

// VoucherLoadResult — what actually happened, so the caller can decide
// whether there is anything to tell the cardholder about. AlreadyDone
// is the idempotent replay (a callback delivered twice): the money was
// credited by an earlier call, and texting them again about the same
// shillings is both a lie and a second SMS charge.
type VoucherLoadResult struct {
	VoucherID   string
	CreditedKES float64
	AlreadyDone bool
}

// ConfirmVoucherLoadByCheckoutID credits the pending M-Pesa load once,
// posts the KES double-entry, and earns loyalty. Idempotent.
func ConfirmVoucherLoadByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutID, receipt string, loyaltyEnabled bool) (VoucherLoadResult, error) {
	var res VoucherLoadResult
	var voucherID string
	if err := pool.QueryRow(ctx, `SELECT id FROM voucher_card WHERE "mpesaCheckoutRequestId" = $1`, checkoutID).Scan(&voucherID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return res, ErrVoucherLoadNotFound
		}
		return res, err
	}
	res.VoucherID = voucherID
	var done bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM voucher_ledger_entry WHERE "voucherId" = $1 AND kind = 'LOAD_MPESA' AND "refId" = $2)`, voucherID, checkoutID).Scan(&done); err != nil {
		return res, err
	}
	if done {
		res.AlreadyDone = true
		return res, nil
	}
	var expectPoints int
	_ = pool.QueryRow(ctx, `SELECT points FROM voucher_ledger_entry WHERE "voucherId" = $1 AND kind = 'LOAD_MPESA_PENDING' AND "refId" = $2 LIMIT 1`, voucherID, checkoutID).Scan(&expectPoints)
	if expectPoints <= 0 {
		return res, ErrVoucherLoadNotFound
	}
	kes := loyalty.KesForPoints(expectPoints)
	var owner string
	_ = pool.QueryRow(ctx, `SELECT "ownerPartyId"::text FROM voucher_card WHERE id = $1`, voucherID).Scan(&owner)

	settlement, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return res, err
	}
	floatAcct, err := ledger.EnsureAccount(ctx, pool, nil, "VOUCHER_FLOAT", "KES")
	if err != nil {
		return res, err
	}
	entryID, err := ledger.PostEntry(ctx, pool, "voucher-load:"+voucherID+":"+checkoutID, "Voucher load via M-Pesa "+receipt, "core-go:voucher-load:"+checkoutID,
		[]ledger.Posting{{AccountID: settlement, AmountCents: ledger.CentsFromKES(kes)}, {AccountID: floatAcct, AmountCents: ledger.CentsFromKES(-kes)}})
	if err != nil {
		return res, err
	}
	if _, err := pool.Exec(ctx, `INSERT INTO voucher_ledger_entry (id, "voucherId", points, "kesEquiv", kind, "refId", "journalEntryId", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, 'LOAD_MPESA', $4, $5, now())`,
		voucherID, expectPoints, kes, checkoutID, entryID); err != nil {
		return res, err
	}
	if owner != "" {
		_ = loyalty.EarnForSpend(ctx, pool, owner, kes, "voucher-load:"+checkoutID, loyaltyEnabled)
	}
	res.CreditedKES = kes
	return res, nil
}

// VoucherNotifyDetail — who to tell about value landing on a card, and
// what to call the card when telling them. GiftedByName is empty for a
// card somebody loaded for themselves.
type VoucherNotifyDetail struct {
	OwnerMsisdn  string
	Label        string
	ShortCode    string
	BalanceKES   float64
	GiftedByName string
}

// GetVoucherNotifyDetail resolves everything a voucher SMS needs in one
// query plus the derived balance. Returns nil (no error) when there is
// no phone number on file for the owner — a card minted for someone
// staff typed in off a list is still a card, there is just nobody to
// text yet, and that is not a failure worth propagating.
func GetVoucherNotifyDetail(ctx context.Context, pool *pgxpool.Pool, voucherID string) (*VoucherNotifyDetail, error) {
	var d VoucherNotifyDetail
	var msisdn, giftedBy *string
	err := pool.QueryRow(ctx, `
		SELECT owner.msisdn, vc.label, vc."shortCode",
		       COALESCE(giver."knownAs", giver."officialName")
		FROM voucher_card vc
		JOIN person owner ON owner."partyId" = vc."ownerPartyId"
		LEFT JOIN person giver ON giver."partyId" = vc."giftedByPartyId"
		WHERE vc.id = $1`, voucherID).
		Scan(&msisdn, &d.Label, &d.ShortCode, &giftedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if msisdn == nil || *msisdn == "" {
		return nil, nil
	}
	d.OwnerMsisdn = *msisdn
	if giftedBy != nil {
		d.GiftedByName = *giftedBy
	}
	bal, err := VoucherBalance(ctx, pool, voucherID)
	if err != nil {
		return nil, err
	}
	d.BalanceKES = loyalty.KesForPoints(bal)
	return &d, nil
}

// LoadVoucherWithLoyalty converts loyalty points 1:1 into voucher points.
func LoadVoucherWithLoyalty(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, voucherID string, points int) (*Voucher, error) {
	if points <= 0 {
		return nil, &FleetError{"BAD_INPUT", "Enter points above zero"}
	}
	v, err := GetVoucher(ctx, pool, voucherID)
	if err != nil {
		return nil, err
	}
	if v.Status != "ACTIVE" {
		return nil, ErrVoucherFrozen
	}
	payer := c.PartyID
	if payer == "" {
		return nil, &FleetError{"BAD_INPUT", "Sign in to use loyalty points"}
	}
	if v.OwnerPartyID != payer {
		if err := authsvc.RequireCapability(c, authsvc.CapVoucherSpend, nil); err != nil {
			return nil, ErrVoucherNotOwner
		}
	}
	if err := loyalty.SpendFromParty(ctx, pool, payer, points, "voucher:"+voucherID); err != nil {
		if errors.Is(err, loyalty.ErrInsufficientLoyalty) {
			return nil, &FleetError{"INSUFFICIENT_LOYALTY", "Not enough loyalty points"}
		}
		return nil, err
	}
	if _, err := pool.Exec(ctx, `INSERT INTO voucher_ledger_entry (id, "voucherId", points, "kesEquiv", kind, "refId", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, 'LOAD_LOYALTY', $4, now())`,
		voucherID, points, loyalty.KesForPoints(points), "loyalty:"+payer); err != nil {
		return nil, err
	}
	return GetVoucher(ctx, pool, voucherID)
}

// SpendVoucher debits points for a purpose-checked purchase. Must run in
// the caller's tx-adjacent flow; the SPEND row's refId gives idempotency
// per purchase (e.g. fare:<id>). wantPurpose accepts a comma-separated
// list so one call site can honour more than one purpose (a fare
// payment takes a FARE voucher, and now an employer-issued FUEL or
// TRAVEL allowance voucher too — see dbx.IssueAllowanceVoucherBatch).
func SpendVoucher(ctx context.Context, pool *pgxpool.Pool, voucherID, wantPurpose string, points int, refID, journalEntryID string) error {
	if points <= 0 {
		return &FleetError{"BAD_INPUT", "Amount must be above zero"}
	}
	var purpose, status string
	var expiresAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT purpose::text, status::text, "expiresAt" FROM voucher_card WHERE id = $1`, voucherID).Scan(&purpose, &status, &expiresAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrVoucherNotFound
		}
		return err
	}
	if status != "ACTIVE" {
		return ErrVoucherFrozen
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		_, _ = pool.Exec(ctx, `UPDATE voucher_card SET status = 'EXPIRED', "updatedAt" = now() WHERE id = $1`, voucherID)
		return ErrVoucherExpired
	}
	accepted := false
	for _, want := range strings.Split(wantPurpose, ",") {
		if purpose == want {
			accepted = true
			break
		}
	}
	if purpose != "GENERAL" && !accepted {
		return ErrVoucherWrongPurpose
	}
	var done bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM voucher_ledger_entry WHERE "voucherId" = $1 AND kind = 'SPEND' AND "refId" = $2)`, voucherID, refID).Scan(&done); err != nil {
		return err
	}
	if done {
		return nil
	}
	bal, err := VoucherBalance(ctx, pool, voucherID)
	if err != nil {
		return err
	}
	if bal < points {
		return ErrVoucherInsufficient
	}
	_, err = pool.Exec(ctx, `INSERT INTO voucher_ledger_entry (id, "voucherId", points, "kesEquiv", kind, "refId", "journalEntryId", "createdAt") VALUES (gen_random_uuid(), $1, $2, $3, 'SPEND', $4, $5, now())`,
		voucherID, -points, loyalty.KesForPoints(points), refID, nullIfEmpty(journalEntryID))
	return err
}

// FreezeVoucher blocks further spends (lost phone / admin action).
func FreezeVoucher(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, voucherID string, frozen bool) error {
	v, err := GetVoucher(ctx, pool, voucherID)
	if err != nil {
		return err
	}
	if v.OwnerPartyID != c.PartyID {
		if err := authsvc.RequireCapability(c, authsvc.CapVoucherFreeze, nil); err != nil {
			return ErrVoucherNotOwner
		}
	}
	status := "ACTIVE"
	if frozen {
		status = "FROZEN"
	}
	_, err = pool.Exec(ctx, `UPDATE voucher_card SET status = $1::"VoucherStatus", "updatedAt" = now() WHERE id = $2`, status, voucherID)
	return err
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
