// Package dbx (parcel_cod.go) — cash on delivery, and the settlement
// chain behind it.
//
// This is the flow the parcel vertical could not serve at all: a
// social-commerce seller ships goods, the buyer pays the courier at the
// door, and Esoqo settles the goods money back to the seller. It is the
// dominant arrangement in this market and the reason a seller picks one
// courier over another.
//
// It is also the only flow in this product where Esoqo physically holds
// somebody else's money, so every movement posts real double-entry legs
// rather than flipping a status column. Who holds the cash at each step:
//
//	PENDING   — the buyer's
//	COLLECTED — the rider's pocket  (PARCEL_COD_HELD, one account per rider)
//	REMITTED  — Esoqo's             (SETTLEMENT)
//	SETTLED   — the seller's        (PARCEL_COD_PAYABLE cleared)
//
// Two numbers are kept rigorously apart throughout: codAmountKes is the
// GOODS value the seller is owed, priceKes is the delivery fee Esoqo
// earned. They belong to different people, and merging them into one
// "total" is how a settlement report stops meaning anything.
package dbx

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/ledger"
	"github.com/esoqo/core-go/internal/money"
)

// COD lifecycle states. Plain strings for the same reason every other
// status-ish field in this vertical is.
const (
	CodNotApplicable = "NOT_APPLICABLE"
	CodPending       = "PENDING"
	CodCollected     = "COLLECTED"
	CodRemitted      = "REMITTED"
	CodSettled       = "SETTLED"
)

// ── Policy ───────────────────────────────────────────────────────────

type ParcelCodPolicy struct {
	Enabled        bool         `json:"enabled"`
	MaxAmountKes   money.Amount `json:"maxAmountKes"`
	HandlingFeePct float64      `json:"handlingFeePct"`
}

// GetCodPolicy — the single global row. Returns a disabled policy
// rather than nil when none exists, so every caller's "is COD on"
// check is one field read and nobody has to treat "unconfigured" as a
// third case meaning maybe.
func GetCodPolicy(ctx context.Context, pool *pgxpool.Pool) (ParcelCodPolicy, error) {
	var p ParcelCodPolicy
	var maxText, feeText string
	err := pool.QueryRow(ctx, `
		SELECT enabled, "maxAmountKes"::text, "handlingFeePct"::text
		FROM parcel_cod_policy ORDER BY "updatedAt" DESC LIMIT 1`).
		Scan(&p.Enabled, &maxText, &feeText)
	if errors.Is(err, pgx.ErrNoRows) {
		return ParcelCodPolicy{}, nil
	}
	if err != nil {
		return ParcelCodPolicy{}, err
	}
	p.MaxAmountKes = money.AmountOf(money.MustParseKES(maxText))
	if p.HandlingFeePct, err = parseFloatOrZero(feeText); err != nil {
		return ParcelCodPolicy{}, err
	}
	return p, nil
}

func SetCodPolicy(ctx context.Context, pool *pgxpool.Pool, p ParcelCodPolicy, staffID string) error {
	if !p.MaxAmountKes.Cents().IsPositive() {
		return &ParcelError{"BAD_INPUT", "The maximum COD amount must be more than zero"}
	}
	if p.HandlingFeePct < 0 || p.HandlingFeePct > 100 {
		return &ParcelError{"BAD_INPUT", "The handling fee must be between 0 and 100 percent"}
	}
	// Deletes then inserts, exactly as SetParcelDistanceRate does — one
	// row is ever meant to exist, and growing a history table nothing
	// reads would only make "what is the policy" ambiguous.
	//
	// The two statements run inside one transaction: a multi-statement
	// string through pgx's extended protocol is rejected by Postgres
	// ("cannot insert multiple commands into a prepared statement"), so
	// this must be two Execs on the same tx — which also guarantees the
	// DELETE and the INSERT commit together, so the policy is never
	// briefly the empty state a crash between them would leave behind.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM parcel_cod_policy`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_cod_policy (id, enabled, "maxAmountKes", "handlingFeePct", "updatedAt", "updatedById")
		VALUES (gen_random_uuid(), $1, $2, $3, now(), $4)`,
		p.Enabled, p.MaxAmountKes.String(), p.HandlingFeePct, staffID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── The two pure arithmetic rules ────────────────────────────────────

// CodExpectedKes — what the courier should collect at the door: the
// goods value, plus the delivery fee when the buyer is paying for that
// too (the common arrangement here).
func CodExpectedKes(codAmountKes, priceKes float64, collectDeliveryFee bool) float64 {
	total := money.FromKES(codAmountKes)
	if collectDeliveryFee {
		total += money.FromKES(priceKes)
	}
	return total.KES()
}

// AllocateCodCollection splits what was actually collected between
// Esoqo's delivery fee and the seller's goods money.
//
// The delivery fee is satisfied first. That is a real decision, not an
// implementation detail: a buyer short of cash is a common outcome, and
// the shortfall has to land on somebody. It lands on the seller's
// goods, because the delivery itself was performed in full and the fee
// was earned regardless of what the buyer turned up with. The shortfall
// is recorded rather than hidden (see RecordCodCollection), so a seller
// can see exactly what happened and chase their buyer for the rest.
//
// When the fee was prepaid (collectDeliveryFee false) the whole
// collection is goods money — there is no fee left to satisfy.
func AllocateCodCollection(collectedKes, priceKes float64, collectDeliveryFee bool) (feeKes, goodsKes float64) {
	collected := money.FromKES(collectedKes)
	if !collected.IsPositive() {
		return 0, 0
	}
	if !collectDeliveryFee {
		return 0, collected.KES()
	}
	// The fee cannot exceed what was actually handed over.
	fee := money.FromKES(priceKes).Min(collected)
	// Goods by subtraction, so fee + goods always reconciles exactly to
	// what was collected — the same anti-stranded-cent reasoning
	// SplitParcelRevenue follows. In exact cents "always" is literal.
	return fee.KES(), (collected - fee).KES()
}

// ── Booking ──────────────────────────────────────────────────────────

// SetParcelCod attaches a COD amount to a draft parcel.
//
// Only on a draft: once a parcel is booked, somebody is already
// carrying it under an agreed arrangement, and changing what the buyer
// owes at the door after the fact is how a courier ends up arguing on a
// doorstep about a number that moved.
func SetParcelCod(ctx context.Context, pool *pgxpool.Pool, code string, codAmountKes float64, collectDeliveryFee bool) error {
	policy, err := GetCodPolicy(ctx, pool)
	if err != nil {
		return err
	}
	if !policy.Enabled {
		return &ParcelError{"BAD_INPUT", "Cash on delivery isn't available right now"}
	}
	if codAmountKes <= 0 {
		return &ParcelError{"BAD_INPUT", "Say what the buyer owes for the goods"}
	}
	// Compared in cents so a COD amount exactly equal to the cap is
	// accepted rather than rejected by a float hair over it.
	if money.FromKES(codAmountKes) > policy.MaxAmountKes.Cents() {
		return &ParcelError{"BAD_INPUT", "That's above the cash-on-delivery limit of KES " +
			policy.MaxAmountKes.Cents().Decimal()}
	}
	var status string
	err = pool.QueryRow(ctx, `SELECT status::text FROM parcel WHERE code = $1`, code).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if status != "DRAFT_PENDING_PAYMENT" {
		return &ParcelError{"BAD_INPUT", "This parcel is already booked — its cash-on-delivery terms can't change"}
	}
	_, err = pool.Exec(ctx, `
		UPDATE parcel SET "codAmountKes" = $1, "codCollectDeliveryFee" = $2, "codStatus" = $3
		WHERE code = $4`, codAmountKes, collectDeliveryFee, CodPending, code)
	return err
}

// ConfirmParcelCodBooking turns a COD parcel BOOKED without any money
// having arrived.
//
// This is the one place the lifecycle genuinely had to change. Every
// other path treats paidAt as the moment a booking becomes real, and
// sets slaDeadlineAt from it. For COD the two events are days apart:
// the booking is confirmed now, the money arrives at the door. So the
// SLA clock starts here (a delivery promise is made when the job is
// accepted, not when it's paid for), while paidAt and the revenue split
// stay null until RecordCodCollection — which keeps "revenue" meaning
// money actually received, everywhere it's summed.
//
// Only valid when the buyer is covering the delivery fee. A parcel
// whose fee the sender owes still has to pay it up front; otherwise
// nobody is ever charged for the delivery itself.
func ConfirmParcelCodBooking(ctx context.Context, pool *pgxpool.Pool, code string) error {
	var status, codStatus string
	var codAmount *string
	var collectFee bool
	err := pool.QueryRow(ctx, `
		SELECT status::text, "codStatus", "codAmountKes"::text, "codCollectDeliveryFee"
		FROM parcel WHERE code = $1`, code).Scan(&status, &codStatus, &codAmount, &collectFee)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if codAmount == nil || codStatus == CodNotApplicable {
		return &ParcelError{"BAD_INPUT", "This isn't a cash-on-delivery parcel"}
	}
	if status != "DRAFT_PENDING_PAYMENT" {
		return &ParcelError{"BAD_INPUT", "This parcel is not awaiting confirmation"}
	}
	if !collectFee {
		return &ParcelError{"BAD_INPUT", "Pay the delivery fee to confirm this booking"}
	}
	// The states checked above are carried into the UPDATE, so the write
	// is decided by one snapshot rather than by a read that another
	// request could invalidate before the write landed. This route is
	// unauthenticated and takes the tracking code alone, and it texts the
	// sender on success — so a double-tap, or two senders confirming from
	// the same link, otherwise buys two booking SMS and two SLA clocks
	// started.
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET
			status = 'BOOKED',
			"paymentMethod" = 'CASH_ON_DELIVERY',
			"slaDeadlineAt" = now() + (
			    SELECT r."slaHours" FROM parcel_pricing_rule r
			    WHERE r."parcelType" = parcel."parcelType"
			      AND (r."parcelOrgId" IS NULL OR r."parcelOrgId" = parcel."parcelOrgId")
			    ORDER BY r."parcelOrgId" NULLS LAST
			    LIMIT 1
			) * interval '1 hour'
		WHERE code = $1 AND status = $2 AND "codStatus" = $3 AND "codAmountKes" IS NOT NULL`,
		code, "DRAFT_PENDING_PAYMENT", CodPending)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"CONFLICT", "That booking was just confirmed — no need to do it again"}
	}
	return nil
}

// ── Collection at the door ───────────────────────────────────────────

// CodCollectionResult tells the caller what actually happened, so it
// can say so rather than reporting a flat success on a short payment.
type CodCollectionResult struct {
	ExpectedKes  float64
	CollectedKes float64
	FeeKes       float64
	GoodsKes     float64
	ShortfallKes float64
}

// RecordCodCollection books the cash a courier took at the door.
//
// Three legs, and they must sum to zero:
//
//	DEBIT  PARCEL_COD_HELD(rider)     + collected   (now in their pocket)
//	CREDIT PARCEL_COD_PAYABLE(seller) - goods       (owed to the seller)
//	CREDIT PARCEL_REVENUE             - fee         (Esoqo earned it)
//
// A seller with no Esoqo account (a guest booking) has nobody to owe,
// so their goods money posts to SETTLEMENT and is reconciled by hand —
// recorded honestly rather than quietly dropped, which is the only
// alternative when there is no party to credit.
//
// Idempotent through the ledger's own idempotency key: a courier
// double-tapping on a bad connection records one collection, not two.
func RecordCodCollection(ctx context.Context, pool *pgxpool.Pool, code string, collectedKes float64, byPartyID string) (*CodCollectionResult, error) {
	if byPartyID == "" {
		return nil, &ParcelError{"FORBIDDEN", "Sign in to record a payment"}
	}
	if collectedKes < 0 {
		return nil, &ParcelError{"BAD_INPUT", "That isn't a valid amount"}
	}

	// The guard read, the ledger entry and the codStatus flip are one
	// transaction. Called out of the delivery flow AFTER the parcel is
	// marked DELIVERED, and standalone for a parcel whose COD
	// bookkeeping failed after a completed hand-over — so a parcel in
	// any other state is one whose goods never changed hands, and
	// booking cash against it credits the seller, the courier and
	// Esoqo's revenue for a delivery that did not happen. The status
	// check belongs here rather than only at the two call sites, because
	// the ledger post and the flip have to commit together: posted
	// first and flipped second, a crash in between left the parcel
	// PENDING forever (so the seller is owed twice and the courier's
	// holding shows cash nobody can remit) with a ledger entry that
	// claims the money was collected.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var parcelID, codStatus, status string
	var currentHolder, senderPartyID, codAmountText, priceText *string
	var collectFee bool
	err = tx.QueryRow(ctx, `
		SELECT id, "codStatus", status::text, "currentHolderPartyId"::text, "senderPartyId"::text,
		       "codAmountKes"::text, "priceKes"::text, "codCollectDeliveryFee"
		FROM parcel WHERE code = $1 FOR UPDATE`, code).
		Scan(&parcelID, &codStatus, &status, &currentHolder, &senderPartyID, &codAmountText, &priceText, &collectFee)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return nil, err
	}
	if codAmountText == nil || codStatus == CodNotApplicable {
		return nil, &ParcelError{"BAD_INPUT", "This isn't a cash-on-delivery parcel"}
	}
	if codStatus != CodPending {
		// Already collected, remitted or settled — a replayed tap, not a
		// second payment.
		return nil, &ParcelError{"BAD_INPUT", "This parcel's payment has already been recorded"}
	}
	// Money is only ever taken at a hand-over that actually happened.
	// DELIVERED is the state both callers run against (the delivery flow
	// closes the parcel out first; the standalone retry exists precisely
	// for a delivered parcel whose COD bookkeeping failed), so anything
	// else means nobody took this parcel to its buyer.
	if status != "DELIVERED" {
		return nil, &ParcelError{"BAD_INPUT", "This parcel hasn't been delivered yet"}
	}
	// Custody, not capability: whoever physically has the parcel is who
	// can be handed cash for it. Same rule every other at-the-door
	// action in this vertical follows.
	if currentHolder == nil || *currentHolder != byPartyID {
		return nil, &ParcelError{"FORBIDDEN", "You aren't holding this parcel"}
	}

	codAmount, err := parseFloatOrZero(*codAmountText)
	if err != nil {
		return nil, err
	}
	priceKes, err := parseAgentFee(priceText)
	if err != nil {
		return nil, err
	}

	feeKes, goodsKes := AllocateCodCollection(collectedKes, priceKes, collectFee)
	expected := CodExpectedKes(codAmount, priceKes, collectFee)
	result := &CodCollectionResult{
		ExpectedKes: expected, CollectedKes: collectedKes,
		FeeKes: feeKes, GoodsKes: goodsKes,
		ShortfallKes: (money.FromKES(expected) - money.FromKES(collectedKes)).KES(),
	}
	if result.ShortfallKes < 0 {
		// Overpayment isn't a shortfall; the extra rides with the goods
		// money and the seller can sort it out with their buyer.
		result.ShortfallKes = 0
	}

	heldAcct, err := ledger.EnsureAccount(ctx, pool, &byPartyID, "PARCEL_COD_HELD", "KES")
	if err != nil {
		return nil, err
	}
	revenueAcct, err := ledger.EnsureAccount(ctx, pool, nil, "PARCEL_REVENUE", "KES")
	if err != nil {
		return nil, err
	}
	// A guest sender has no party to credit — their goods money sits in
	// the platform's settlement account and is paid out by hand.
	goodsAcctKind, goodsAcctParty := "PARCEL_COD_PAYABLE", senderPartyID
	if senderPartyID == nil {
		goodsAcctKind, goodsAcctParty = "SETTLEMENT", nil
	}
	goodsAcct, err := ledger.EnsureAccount(ctx, pool, goodsAcctParty, goodsAcctKind, "KES")
	if err != nil {
		return nil, err
	}

	postings := []ledger.Posting{{AccountID: heldAcct, AmountCents: ledger.CentsFromKES(collectedKes)}}
	if goodsKes > 0 {
		postings = append(postings, ledger.Posting{AccountID: goodsAcct, AmountCents: ledger.CentsFromKES(-goodsKes)})
	}
	if feeKes > 0 {
		postings = append(postings, ledger.Posting{AccountID: revenueAcct, AmountCents: ledger.CentsFromKES(-feeKes)})
	}
	if collectedKes > 0 {
		if _, err := ledger.PostEntryTx(ctx, tx,
			"parcel:"+parcelID, "Cash on delivery collected", "core-go:parcel-cod:"+parcelID,
			postings); err != nil {
			return nil, err
		}
	}

	// paidAt is set here, not at booking — for a COD parcel this is the
	// moment money actually arrived, which is what every revenue sum in
	// this package means by "paid".
	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET
			"codStatus" = $1, "codCollectedKes" = $2, "codCollectedAt" = now(),
			"codCollectedByPartyId" = $3,
			"paidAt" = COALESCE("paidAt", now())
		WHERE id = $4 AND "codStatus" = $5`, CodCollected, collectedKes, byPartyID, parcelID, CodPending); err != nil {
		return nil, err
	}
	// The delivery fee is the only part of a COD collection that is
	// Esoqo's revenue, so that — not the whole collection — is what the
	// company's commission splits against.
	if feeKes > 0 {
		if err := writeParcelRevenueSplitTx(ctx, tx, pool, parcelID, feeKes); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

// ── Remittance ───────────────────────────────────────────────────────

// RiderCodHolding is what one courier is still carrying.
type RiderCodHolding struct {
	ParcelCount int          `json:"parcelCount"`
	AmountKes   money.Amount `json:"amountKes"`
}

// GetRiderCodHolding sums the cash a rider has collected and not yet
// handed over. Read from the parcels themselves rather than the
// ledger balance so the figure and the list of parcels behind it can
// never disagree on screen.
func GetRiderCodHolding(ctx context.Context, pool *pgxpool.Pool, riderPartyID string) (*RiderCodHolding, error) {
	var h RiderCodHolding
	err := pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(SUM("codCollectedKes"), 0)::text
		FROM parcel
		WHERE "codCollectedByPartyId" = $1 AND "codStatus" = $2`,
		riderPartyID, CodCollected).Scan(&h.ParcelCount, &h.AmountKes)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// RemitCod records a rider handing their collected cash over.
//
// The batch closes every parcel the rider is currently holding cash
// for, and records what was actually counted alongside what was
// expected. Those two are allowed to disagree — that is the entire
// point of a reconciliation record, and a short hand-over that the
// schema cannot represent is a short hand-over nobody ever chases.
//
// Moves the money on the ledger from the rider's pocket into Esoqo's
// settlement account. The seller's payable is untouched: it was
// credited at collection and stays owed until they are actually paid.
func RemitCod(ctx context.Context, pool *pgxpool.Pool, riderPartyID string, amountKes float64, receivedByStaffID, receivedByOrgStaffID *string, note *string) (remittanceID string, expectedKes float64, err error) {
	if riderPartyID == "" {
		return "", 0, &ParcelError{"BAD_INPUT", "Say whose cash this is"}
	}
	if amountKes < 0 {
		return "", 0, &ParcelError{"BAD_INPUT", "That isn't a valid amount"}
	}
	if receivedByStaffID == nil && receivedByOrgStaffID == nil {
		// Somebody has to be accountable for a bag of notes.
		return "", 0, &ParcelError{"BAD_INPUT", "Record who received the cash"}
	}

	// The counted amount, the ledger movement, the parcel status flips
	// and the reconciliation row all commit together. Posted after the
	// commit instead — the earlier shape — a crash in between left
	// parcels marked REMITTED with the ledger never moved: the money in
	// was on nobody's books, the rider's holding showed zero, and no
	// retry was possible because the parcels were no longer COLLECTED.
	// The winner that is left is a silent reconciliation gap nobody
	// ever chases.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// What the rider is actually holding is read inside the transaction
	// and its parcels locked FOR UPDATE, so a collection landing
	// mid-handover can't be swept into this remittance by a batch that
	// was computed before it existed — nor silently skipped by a row
	// count the transaction can't account for. The aggregate is
	// computed in Go over the locked rows: Postgres rejects FOR UPDATE
	// on an aggregate query.
	rows, err := tx.Query(ctx, `
		SELECT "codCollectedKes"::text
		FROM parcel
		WHERE "codCollectedByPartyId" = $1 AND "codStatus" = $2
		FOR UPDATE`, riderPartyID, CodCollected)
	if err != nil {
		return "", 0, err
	}
	var expected money.Cents
	parcelCount := 0
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			rows.Close()
			return "", 0, err
		}
		expected += money.MustParseKES(text)
		parcelCount++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", 0, err
	}
	if parcelCount == 0 {
		return "", 0, &ParcelError{"BAD_INPUT", "That rider isn't holding any cash-on-delivery money"}
	}
	expectedKes = expected.KES()

	// The counted amount in the same unit as expected, converted once.
	// CentsFromKES rounds to the nearest cent, which is the finest
	// granularity a currency amount has here — so what lands on the
	// comparison is the number of notes actually counted, not a float
	// that only approximates it.
	counted := money.Cents(ledger.CentsFromKES(amountKes))

	// A hand-over that doesn't match the parcels is exactly what the
	// expected/counted gap exists to surface, so it is allowed — but never
	// silently. A short count over real parcels is somebody's money
	// unaccounted for, and without a word about it the record reads as a
	// routine handover.
	//
	// The comparison is on Cents, not on the two float64s: the counted
	// amount arrives as a float and expected as money.Cents, so comparing
	// those directly asks a 20.10 to equal 20.099999999999998, and a
	// correctly counted hand-over would demand an explanation for a
	// discrepancy that doesn't exist.
	//
	// Both directions need the note, not just the short one. An OVER-count
	// is stranger money the rider is carrying that belongs to no parcel,
	// and the ledger below posts the counted figure — so a surplus that
	// arrives unexplained is posted as if it were somebody's delivery.
	if counted != expected {
		if note == nil || strings.TrimSpace(*note) == "" {
			if counted < expected {
				return "", 0, &ParcelError{"BAD_INPUT", "That's less than the parcels say is owed — record what happened"}
			}
			return "", 0, &ParcelError{"BAD_INPUT", "That's more than the parcels say is owed — record where the extra came from"}
		}
	}

	if err := tx.QueryRow(ctx, `
		INSERT INTO parcel_cod_remittance (
			id, "riderPartyId", "receivedByStaffId", "receivedByOrgStaffId",
			"amountKes", "expectedKes", note, "createdAt"
		) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
		RETURNING id`,
		riderPartyID, receivedByStaffID, receivedByOrgStaffID,
		// Both money columns get exact decimal strings, not float8. This is
		// about removing a conversion, not correcting a broken one:
		// Postgres's float8→numeric cast does round sensibly, so the old
		// shape was not landing a hundredth off. But the value is already
		// exact cents in `counted` two lines above, and handing a driver a
		// float means the number makes a round trip through binary
		// floating point to get back to the decimal it came from — for a
		// column whose entire purpose is that the difference between
		// amountKes and expectedKes is real. Written as the decimal it is.
		counted.Decimal(), expected.Decimal(), note).
		Scan(&remittanceID); err != nil {
		return "", 0, err
	}
	// RowsAffected is checked, not discarded. The UPDATE carries the same
	// predicate the count was taken with, so a mismatch means a parcel
	// left COLLECTED between the two statements and this remittance would
	// silently leave that rider's cash out of the batch — a holding that
	// no longer matches the sum of the parcels behind it, which is the
	// one invariant this function exists to keep.
	tag, err := tx.Exec(ctx, `
		UPDATE parcel SET "codStatus" = $1, "codRemittanceId" = $2
		WHERE "codCollectedByPartyId" = $3 AND "codStatus" = $4`,
		CodRemitted, remittanceID, riderPartyID, CodCollected)
	if err != nil {
		return "", 0, err
	}
	if int(tag.RowsAffected()) != parcelCount {
		return "", 0, &ParcelError{"CONFLICT", "That rider's cash changed while this was being recorded — try again"}
	}

	// What was COUNTED is posted, not what was expected: the ledger has
	// to agree with the notes on the table, and a discrepancy lives in
	// the gap between remittance.amountKes and expectedKes where somebody
	// can see it.
	//
	// Posted from `counted`, the same cents the comparison above used, so
	// the ledger, the row and the note all describe one number. Recomputing
	// it here from amountKes would be a second conversion of the same
	// input and could disagree with the first by a cent.
	if counted > 0 {
		heldAcct, aerr := ledger.EnsureAccount(ctx, pool, &riderPartyID, "PARCEL_COD_HELD", "KES")
		if aerr != nil {
			return "", 0, aerr
		}
		settlementAcct, aerr := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
		if aerr != nil {
			return "", 0, aerr
		}
		if _, perr := ledger.PostEntryTx(ctx, tx,
			"parcel-cod-remittance:"+remittanceID, "Courier remitted cash on delivery",
			"core-go:parcel-cod-remit:"+remittanceID,
			[]ledger.Posting{
				{AccountID: settlementAcct, AmountCents: int64(counted)},
				{AccountID: heldAcct, AmountCents: -int64(counted)},
			}); perr != nil {
			return "", 0, perr
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", 0, err
	}
	return remittanceID, expectedKes, nil
}

// ParcelNeedsCodCollection — does closing this parcel out still require
// taking money? True only while a COD parcel's cash is PENDING, so a
// re-attempted delivery on a parcel whose payment was already recorded
// (the dropped-connection case) doesn't demand it twice.
func ParcelNeedsCodCollection(ctx context.Context, pool *pgxpool.Pool, code string) (bool, error) {
	var codStatus string
	err := pool.QueryRow(ctx, `SELECT "codStatus" FROM parcel WHERE code = $1`, code).Scan(&codStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return codStatus == CodPending, nil
}

// RiderBelongsToOrg — is this party one of [orgID]'s people? True for
// either a staff PIN login linked to them or a courier on the company's
// books, since a company's riders arrive through both doors.
func RiderBelongsToOrg(ctx context.Context, pool *pgxpool.Pool, riderPartyID, orgID string) (bool, error) {
	if riderPartyID == "" {
		return false, nil
	}
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM parcel_org_staff
			WHERE "orgId" = $1 AND "partyId" = $2 AND active = true
			UNION ALL
			SELECT 1 FROM parcel_courier
			WHERE "parcelOrgId" = $1 AND "partyId" = $2
		)`, orgID, riderPartyID).Scan(&ok)
	return ok, err
}

// GetPartyContact — a party's phone and display name, for the one-off
// notifications that address somebody who isn't on the parcel itself
// (a seller being settled, say). Returns empty strings rather than an
// error when there's nobody to reach: an SMS that can't be sent must
// never fail the money movement that triggered it.
func GetPartyContact(ctx context.Context, pool *pgxpool.Pool, partyID string) (msisdn, name string, err error) {
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(msisdn, ''), COALESCE("knownAs", "officialName", '')
		FROM person WHERE "partyId" = $1`, partyID).Scan(&msisdn, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	return msisdn, name, err
}

// ── Settlement to the seller ─────────────────────────────────────────

// SellerCodOwed — one seller's unsettled goods money.
type SellerCodOwed struct {
	SenderPartyID string       `json:"senderPartyId"`
	SenderName    string       `json:"senderName"`
	SenderMsisdn  string       `json:"senderMsisdn"`
	ParcelCount   int          `json:"parcelCount"`
	GoodsKes      money.Amount `json:"goodsKes"`
	// ReadyKes is the portion already remitted by a rider and therefore
	// actually payable. Money still in a rider's pocket is owed but not
	// yet Esoqo's to pay out, and showing one number for both would
	// invite paying out cash nobody has counted.
	ReadyKes money.Amount `json:"readyKes"`
}

// ListSellersOwedCod — who is waiting to be paid, most owed first.
func ListSellersOwedCod(ctx context.Context, pool *pgxpool.Pool) ([]SellerCodOwed, error) {
	rows, err := pool.Query(ctx, `
		SELECT p."senderPartyId"::text,
		       max(p."senderName"), max(p."senderMsisdn"),
		       count(*),
		       COALESCE(SUM(
		         CASE WHEN p."codCollectDeliveryFee"
		              THEN GREATEST(p."codCollectedKes" - COALESCE(p."priceKes", 0), 0)
		              ELSE p."codCollectedKes" END
		       ), 0)::text,
		       COALESCE(SUM(
		         CASE WHEN p."codStatus" = $2 THEN
		           CASE WHEN p."codCollectDeliveryFee"
		                THEN GREATEST(p."codCollectedKes" - COALESCE(p."priceKes", 0), 0)
		                ELSE p."codCollectedKes" END
		         ELSE 0 END
		       ), 0)::text
		FROM parcel p
		WHERE p."senderPartyId" IS NOT NULL
		  AND p."codStatus" IN ($1, $2)
		GROUP BY p."senderPartyId"
		ORDER BY 5 DESC`, CodCollected, CodRemitted)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SellerCodOwed
	for rows.Next() {
		var s SellerCodOwed
		if err := rows.Scan(&s.SenderPartyID, &s.SenderName, &s.SenderMsisdn,
			&s.ParcelCount, &s.GoodsKes, &s.ReadyKes); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// SettleSellerCod pays a seller everything of theirs that has actually
// been remitted, less the policy's handling fee.
//
// Only REMITTED parcels settle. Money still in a rider's pocket is owed
// to the seller but is not yet Esoqo's to pay out, and paying against
// it would mean paying out cash nobody has counted.
//
// One transaction holds the whole thing: a second concurrent settle for
// the same seller blocks on the FOR UPDATE lock (and, per row, sees the
// rows the first settle already transitioned out of REMITTED), so the
// same money cannot be paid twice. The status flip and the ledger post
// commit together, so a ledger failure rolls the flips back and the
// retry is not met with "nothing remitted" for a settlement that never
// happened. The actor who ran it is written into the settlement record
// — a money-out operation with no actor is a fraud you cannot even
// begin to chase.
func SettleSellerCod(ctx context.Context, pool *pgxpool.Pool, senderPartyID, staffID string) (paidKes, feeKes float64, count int, err error) {
	policy, err := GetCodPolicy(ctx, pool)
	if err != nil {
		return 0, 0, 0, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, 0, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT id,
		       CASE WHEN "codCollectDeliveryFee"
		            THEN GREATEST("codCollectedKes" - COALESCE("priceKes", 0), 0)
		            ELSE "codCollectedKes" END::float8
		FROM parcel
		WHERE "senderPartyId" = $1 AND "codStatus" = $2
		FOR UPDATE`, senderPartyID, CodRemitted)
	if err != nil {
		return 0, 0, 0, err
	}
	type settling struct {
		id    string
		goods float64
	}
	var items []settling
	for rows.Next() {
		var it settling
		if err := rows.Scan(&it.id, &it.goods); err != nil {
			rows.Close()
			return 0, 0, 0, err
		}
		items = append(items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, 0, err
	}
	if len(items) == 0 {
		return 0, 0, 0, &ParcelError{"BAD_INPUT", "There's nothing remitted to settle for this seller"}
	}

	// Fees are computed and stored per parcel, not once on the batch, so
	// a later query about any single parcel can still say exactly what
	// was withheld on it.
	// Accumulated in exact cents. Per-parcel fees are rounded
	// individually (each is written to its own parcel row and must match
	// what a later per-parcel query reports) and the run total is their
	// exact sum — so the sum of the parts always equals the whole, which
	// a float accumulation over many parcels does not guarantee.
	var gross, fee money.Cents
	for i := range items {
		goods := money.FromKES(items[i].goods)
		parcelFee := goods.Percent(policy.HandlingFeePct)
		fee += parcelFee
		gross += goods
		if _, err := tx.Exec(ctx, `
			UPDATE parcel SET "codStatus" = $1, "codSettledAt" = now(), "codHandlingFeeKes" = $2::numeric
			WHERE id = $3 AND "codStatus" = $4`, CodSettled, parcelFee.Decimal(), items[i].id, CodRemitted); err != nil {
			return 0, 0, 0, err
		}
	}
	paid := gross - fee
	feeKes = fee.KES()
	paidKes = paid.KES()

	payableAcct, err := ledger.EnsureAccount(ctx, pool, &senderPartyID, "PARCEL_COD_PAYABLE", "KES")
	if err != nil {
		return 0, 0, 0, err
	}
	settlementAcct, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return 0, 0, 0, err
	}
	feeAcct, err := ledger.EnsureAccount(ctx, pool, nil, "FEE_INCOME", "KES")
	if err != nil {
		return 0, 0, 0, err
	}
	postings := []ledger.Posting{
		// Clear the whole payable; the seller receives the net and the
		// handling fee becomes Esoqo's income. Three legs so the fee is
		// visible as income rather than silently never owed.
		// Posted straight from the exact cents, not via the float64
		// return values: gross - paid - fee is identically zero in
		// integer arithmetic, so this three-leg entry balances by
		// construction rather than by rounding luck. It is one of the two
		// entries whose residue the ledger's old ±0.005 tolerance used to
		// absorb — see docs/proposals/money-representation.md.
		{AccountID: payableAcct, AmountCents: int64(gross)},
		{AccountID: settlementAcct, AmountCents: -int64(paid)},
	}
	if fee.IsPositive() {
		postings = append(postings, ledger.Posting{AccountID: feeAcct, AmountCents: -int64(fee)})
	}
	// Idempotency is the transaction itself here — the FOR UPDATE lock
	// serializes concurrent settles and the leading "codStatus = REMITTED"
	// predicate makes the rows themselves the guard — so the key can be
	// the stable "one settlement per seller" shape the ledger's replay
	// check (query the existing id) handles without double-counting.
	// A seller settling repeatedly is a set of distinct events, each
	// serialized against the last by the lock before it, so the stable
	// key cannot masquerade two real settlements as one replay.
	idem := "core-go:parcel-cod-settle:" + senderPartyID + ":" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if _, err := ledger.PostEntryTx(ctx, tx,
		"parcel-cod-settlement:"+senderPartyID, "Cash on delivery settled to seller", idem,
		postings); err != nil {
		return 0, 0, 0, err
	}

	// Money out, and the record of who moved it. The settlement ledger
	// entry carries the actor in its reference, and a dedicated row
	// (parcel_cod_settlement) names staffId + the totals + the parcels,
	// so the question "who paid this seller, and for what" is answered
	// by one financial record rather than a grep across logs.
	parcelIDs := make([]string, 0, len(items))
	for _, it := range items {
		parcelIDs = append(parcelIDs, it.id)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_cod_settlement (
			id, "senderPartyId", "settledByStaffId", "paidKes", "feeKes",
			"parcelIds", "createdAt"
		) VALUES (gen_random_uuid(), $1, $2, $3::numeric, $4::numeric, $5, now())`,
		senderPartyID, staffID, paid.Decimal(), feeKes, parcelIDs); err != nil {
		return 0, 0, 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, 0, err
	}
	return paidKes, feeKes, len(items), nil
}
