// Package dbx (parcel_courier_earnings.go) — what a gig courier earns,
// and how they get paid.
//
// Until this existed, a courier who claimed a job on the Nearby tab,
// collected a parcel, carried it across town and handed it over had no
// record of having earned anything. The gig half of the dispatch model
// was operationally real and financially imaginary.
//
// The one rule that decides whether this is correct or costs real
// money: earnings accrue ONLY on a parcel with no carrying company. A
// parcel with a parcelOrgId has already been split into platformFeeKes
// (Esoqo's) and orgEarningsKes (the company's), and that company pays
// its own riders out of its share. Accruing here as well would pay
// twice for one delivery. See AccrueCourierEarnings.
//
// Money movements post double-entry legs, same as the COD chain:
//
//	accrual: DEBIT  PARCEL_COURIER_COST    (the platform's expense)
//	         CREDIT PARCEL_COURIER_PAYABLE (owed to this courier)
//	payout:  DEBIT  PARCEL_COURIER_PAYABLE (clearing it)
//	         CREDIT SETTLEMENT             (cash leaves)
package dbx

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/ledger"
	"github.com/esoqo/core-go/internal/money"
)

// ── Tariff ───────────────────────────────────────────────────────────

// ParcelCourierTariff is the one global rate. The two components stack:
// a courier earns PerDeliveryKes plus PctOfPrice of what the sender
// paid. Either may be zero, which is how "flat rate only" and
// "commission only" are expressed without a mode flag.
type ParcelCourierTariff struct {
	PerDeliveryKes    money.Amount `json:"perDeliveryKes"`
	PctOfPrice        float64      `json:"pctOfPrice"`
	MaxPerDeliveryKes money.Amount `json:"maxPerDeliveryKes"`
}

// EarningsFor — what a courier earns on a parcel that sold for
// [priceKes]. Pure, so the rate a courier is shown in their app and the
// rate the ledger posts can never be two different calculations.
//
// Capped at MaxPerDeliveryKes and again at priceKes itself: a delivery
// must never pay out more than the sender paid for it. That second cap
// is a guard rather than a business rule — it exists so a mistyped
// percentage costs Esoqo its margin on that parcel and nothing worse.
func (t ParcelCourierTariff) EarningsFor(price money.Cents) money.Cents {
	if !price.IsPositive() {
		return money.Zero
	}
	earned := t.PerDeliveryKes.Cents() + price.Percent(t.PctOfPrice)
	if cap := t.MaxPerDeliveryKes.Cents(); cap.IsPositive() {
		earned = earned.Min(cap)
	}
	// Never more than the sender paid — a guard, not a business rule, so
	// a mistyped percentage costs Esoqo its margin and nothing worse.
	earned = earned.Min(price)
	if earned < 0 {
		return money.Zero
	}
	return earned
}

// GetCourierTariff — the single global row. Returns a zero tariff
// rather than nil when none exists, so every caller's arithmetic is one
// method call and nobody has to treat "unconfigured" as a third case.
func GetCourierTariff(ctx context.Context, pool *pgxpool.Pool) (ParcelCourierTariff, error) {
	var t ParcelCourierTariff
	var perText, pctText, maxText string
	err := pool.QueryRow(ctx, `
		SELECT "perDeliveryKes"::text, "pctOfPrice"::text, "maxPerDeliveryKes"::text
		FROM parcel_courier_tariff ORDER BY "updatedAt" DESC LIMIT 1`).
		Scan(&perText, &pctText, &maxText)
	if errors.Is(err, pgx.ErrNoRows) {
		return ParcelCourierTariff{}, nil
	}
	if err != nil {
		return ParcelCourierTariff{}, err
	}
	t.PerDeliveryKes = money.AmountOf(money.MustParseKES(perText))
	if t.PctOfPrice, err = parseFloatOrZero(pctText); err != nil {
		return ParcelCourierTariff{}, err
	}
	t.MaxPerDeliveryKes = money.AmountOf(money.MustParseKES(maxText))
	return t, nil
}

func SetCourierTariff(ctx context.Context, pool *pgxpool.Pool, t ParcelCourierTariff, staffID string) error {
	if t.PerDeliveryKes < 0 || t.PctOfPrice < 0 || t.MaxPerDeliveryKes < 0 {
		return &ParcelError{"BAD_INPUT", "Courier pay can't be negative"}
	}
	if t.PctOfPrice > 100 {
		return &ParcelError{"BAD_INPUT", "A courier can't earn more than 100% of the delivery fee"}
	}
	// Delete-then-insert, exactly as SetParcelDistanceRate and
	// SetCodPolicy do — one row is ever meant to exist, and a history
	// table nothing reads would only make "what is the rate" ambiguous.
	//
	// Two Execs in one transaction rather than a multi-statement string:
	// pgx sends strings with arguments through the extended protocol,
	// which Postgres rejects for multiple commands, and the tx keeps the
	// DELETE and INSERT from ever being seen as an empty rate.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM parcel_courier_tariff`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_courier_tariff
			(id, "perDeliveryKes", "pctOfPrice", "maxPerDeliveryKes", "updatedAt", "updatedById")
		VALUES (gen_random_uuid(), $1, $2, $3, now(), $4)`,
		t.PerDeliveryKes.String(), t.PctOfPrice, t.MaxPerDeliveryKes.String(), staffID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── Accrual ──────────────────────────────────────────────────────────

// AccrueCourierEarnings records what the delivering courier earned, at
// the moment a parcel is delivered.
//
// Deliberately silent and non-fatal on every "not applicable" path —
// a company parcel, an unpriced parcel, a zero tariff, an already-
// accrued parcel. A courier's pay must never be the reason a delivery
// fails to close: the parcel has physically changed hands by the time
// this runs, and refusing to record that because of a bookkeeping edge
// case would be the wrong trade in every direction.
//
// Idempotent through both the courierEarningsKes guard and the ledger's
// own idempotency key, so a retried delivery can't pay twice.
func AccrueCourierEarnings(ctx context.Context, pool *pgxpool.Pool, parcelID string) error {
	var priceText, existing, orgID, holder *string
	err := pool.QueryRow(ctx, `
		SELECT "priceKes"::text, "courierEarningsKes"::text,
		       "parcelOrgId"::text, "currentHolderPartyId"::text
		FROM parcel WHERE id = $1`, parcelID).
		Scan(&priceText, &existing, &orgID, &holder)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// The rule this whole file turns on: a company parcel is already
	// split, and that company pays its own riders out of its share.
	if orgID != nil && *orgID != "" {
		return nil
	}
	if existing != nil && *existing != "" {
		return nil // already accrued — a replayed delivery
	}
	if holder == nil || *holder == "" {
		return nil // nobody to pay
	}
	priceKes, err := parseAgentFee(priceText)
	if err != nil || priceKes <= 0 {
		return err
	}
	tariff, err := GetCourierTariff(ctx, pool)
	if err != nil {
		return err
	}
	earned := tariff.EarningsFor(money.FromKES(priceKes))
	if !earned.IsPositive() {
		return nil
	}

	costAcct, err := ledger.EnsureAccount(ctx, pool, nil, "PARCEL_COURIER_COST", "KES")
	if err != nil {
		return err
	}
	payableAcct, err := ledger.EnsureAccount(ctx, pool, holder, "PARCEL_COURIER_PAYABLE", "KES")
	if err != nil {
		return err
	}
	if _, err := ledger.PostEntry(ctx, pool,
		"parcel:"+parcelID, "Courier delivery earnings",
		"core-go:parcel-courier-earn:"+parcelID,
		[]ledger.Posting{
			// Posted straight from exact cents — no float round-trip
			// between what the courier earned and what the ledger records.
			{AccountID: costAcct, AmountCents: int64(earned)},
			{AccountID: payableAcct, AmountCents: -int64(earned)},
		}); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		UPDATE parcel SET "courierEarningsKes" = $1::numeric WHERE id = $2`, earned.Decimal(), parcelID)
	return err
}

// ── What a courier is owed ───────────────────────────────────────────

// CourierEarnings is one courier's own money screen.
// Money here is money.Amount, so this response emits decimal strings
// ("1250.00") rather than JSON numbers. GET /v1/me/courier-earnings is
// the first endpoint moved to the converged contract because it is the
// only money surface with no TypeScript reader at all — mobile's
// CourierEarningsScreen is its sole consumer. See step 3b of
// docs/proposals/money-representation.md.
type CourierEarnings struct {
	UnpaidKes      money.Amount `json:"unpaidKes"`
	UnpaidParcels  int          `json:"unpaidParcels"`
	PaidKes        money.Amount `json:"paidKes"`
	DeliveredTotal int          `json:"deliveredTotal"`
	// EarnedTodayKes answers the question a courier actually opens this
	// screen to ask, which is not "what is my lifetime total".
	EarnedTodayKes money.Amount `json:"earnedTodayKes"`
}

func GetCourierEarnings(ctx context.Context, pool *pgxpool.Pool, courierPartyID string) (*CourierEarnings, error) {
	var e CourierEarnings
	var unpaidText, paidText, todayText string
	// ::text, not ::float8. SUM over a Decimal(12,2) column is exact in
	// Postgres — casting the result to float8 threw that away on the way
	// out, for no reason beyond Scan wanting a float64. These are the
	// totals a courier reconciles their own pay against, so they are read
	// as decimal text and parsed exactly.
	err := pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM("courierEarningsKes") FILTER (WHERE "courierPayoutId" IS NULL), 0)::text,
			count(*) FILTER (WHERE "courierPayoutId" IS NULL),
			COALESCE(SUM("courierEarningsKes") FILTER (WHERE "courierPayoutId" IS NOT NULL), 0)::text,
			count(*),
			COALESCE(SUM("courierEarningsKes") FILTER (WHERE "deliveredAt" >= date_trunc('day', now())), 0)::text
		FROM parcel
		WHERE "currentHolderPartyId" = $1 AND "courierEarningsKes" IS NOT NULL`,
		courierPartyID).
		Scan(&unpaidText, &e.UnpaidParcels, &paidText, &e.DeliveredTotal, &todayText)
	if err != nil {
		return nil, err
	}
	e.UnpaidKes = money.AmountOf(money.MustParseKES(unpaidText))
	e.PaidKes = money.AmountOf(money.MustParseKES(paidText))
	e.EarnedTodayKes = money.AmountOf(money.MustParseKES(todayText))
	return &e, nil
}

// CourierEarningRow is one delivery on a courier's statement.
type CourierEarningRow struct {
	Code             string `json:"code"`
	DestinationLabel string `json:"destinationLabel"`
	// Already read as ::text from a Decimal column, so this was always an
	// exact decimal string on the wire — money.Amount just gives it a
	// type that says so, and guarantees the two-place shape.
	EarnedKes   money.Amount `json:"earnedKes"`
	DeliveredAt *string      `json:"deliveredAt"`
	Paid        bool         `json:"paid"`
}

// ListCourierEarnings — the statement behind the totals. Unpaid first,
// because that is the half a courier is checking.
func ListCourierEarnings(ctx context.Context, pool *pgxpool.Pool, courierPartyID string, limit int) ([]CourierEarningRow, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := pool.Query(ctx, `
		SELECT code, "destinationLabel", "courierEarningsKes"::text,
		       to_char("deliveredAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       "courierPayoutId" IS NOT NULL
		FROM parcel
		WHERE "currentHolderPartyId" = $1 AND "courierEarningsKes" IS NOT NULL
		ORDER BY ("courierPayoutId" IS NOT NULL) ASC, "deliveredAt" DESC
		LIMIT $2`, courierPartyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CourierEarningRow
	for rows.Next() {
		var r CourierEarningRow
		if err := rows.Scan(&r.Code, &r.DestinationLabel, &r.EarnedKes, &r.DeliveredAt, &r.Paid); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CourierOwed — one line of the admin's payout run.
type CourierOwed struct {
	CourierPartyID string       `json:"courierPartyId"`
	Name           string       `json:"name"`
	Msisdn         *string      `json:"msisdn"`
	ParcelCount    int          `json:"parcelCount"`
	OwedKes        money.Amount `json:"owedKes"`
}

// ListCouriersOwed — who is waiting to be paid, most owed first.
func ListCouriersOwed(ctx context.Context, pool *pgxpool.Pool) ([]CourierOwed, error) {
	rows, err := pool.Query(ctx, `
		SELECT p."currentHolderPartyId"::text,
		       COALESCE(pr."knownAs", pr."officialName", 'Unknown'), pr.msisdn,
		       count(*), COALESCE(SUM(p."courierEarningsKes"), 0)::text
		FROM parcel p
		LEFT JOIN person pr ON pr."partyId" = p."currentHolderPartyId"
		WHERE p."courierEarningsKes" IS NOT NULL AND p."courierPayoutId" IS NULL
		GROUP BY p."currentHolderPartyId", pr."knownAs", pr."officialName", pr.msisdn
		ORDER BY 5 DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CourierOwed
	for rows.Next() {
		var c CourierOwed
		if err := rows.Scan(&c.CourierPartyID, &c.Name, &c.Msisdn, &c.ParcelCount, &c.OwedKes); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ── Payout ───────────────────────────────────────────────────────────

// PayCourier clears everything a courier is owed in one run.
//
// amountKes is what was actually sent, which the record keeps alongside
// what the parcels said was owed. Those two are allowed to disagree —
// a part payment, a rounding to a note denomination, a deduction agreed
// offline — and a schema that derived one from the other could not show
// any of it.
//
// The ledger posts the amount SENT, not the amount owed: the books have
// to agree with the transfer that actually happened, and a discrepancy
// lives visibly in the gap between the two columns.
func PayCourier(ctx context.Context, pool *pgxpool.Pool, courierPartyID string, amountKes float64, reference, note *string, staffID string) (payoutID string, expectedKes float64, err error) {
	if courierPartyID == "" {
		return "", 0, &ParcelError{"BAD_INPUT", "Say who is being paid"}
	}
	if amountKes < 0 {
		return "", 0, &ParcelError{"BAD_INPUT", "That isn't a valid amount"}
	}

	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM("courierEarningsKes"), 0)::float8
		FROM parcel
		WHERE "currentHolderPartyId" = $1 AND "courierEarningsKes" IS NOT NULL
		  AND "courierPayoutId" IS NULL`, courierPartyID).Scan(&expectedKes); err != nil {
		return "", 0, err
	}
	if expectedKes <= 0 {
		return "", 0, &ParcelError{"BAD_INPUT", "That courier isn't owed anything right now"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var staffCol *string
	if staffID != "" {
		staffCol = &staffID
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO parcel_courier_payout
			(id, "courierPartyId", "amountKes", "expectedKes", reference, note, "paidByStaffId", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
		RETURNING id`,
		courierPartyID, amountKes, expectedKes, reference, note, staffCol).Scan(&payoutID); err != nil {
		return "", 0, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET "courierPayoutId" = $1
		WHERE "currentHolderPartyId" = $2 AND "courierEarningsKes" IS NOT NULL
		  AND "courierPayoutId" IS NULL`, payoutID, courierPartyID); err != nil {
		return "", 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", 0, err
	}

	// Posted after the commit because PostEntry takes a pool, not a tx
	// — same split RemitCod documents.
	if amountKes > 0 {
		payableAcct, aerr := ledger.EnsureAccount(ctx, pool, &courierPartyID, "PARCEL_COURIER_PAYABLE", "KES")
		if aerr != nil {
			return payoutID, expectedKes, aerr
		}
		settlementAcct, aerr := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
		if aerr != nil {
			return payoutID, expectedKes, aerr
		}
		if _, perr := ledger.PostEntry(ctx, pool,
			"parcel-courier-payout:"+payoutID, "Courier earnings paid out",
			"core-go:parcel-courier-payout:"+payoutID,
			[]ledger.Posting{
				{AccountID: payableAcct, AmountCents: ledger.CentsFromKES(amountKes)},
				{AccountID: settlementAcct, AmountCents: ledger.CentsFromKES(-amountKes)},
			}); perr != nil {
			return payoutID, expectedKes, perr
		}
	}
	return payoutID, expectedKes, nil
}
