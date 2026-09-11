// Package dbx (parcels.go) — a physical object's custody chain: who
// booked it, who's holding it right now, and the append-only
// ParcelHandoff log of every transfer in between. No payment (unlike
// every checkout-shaped model elsewhere in this package) — this is
// logistics tracking, not a marketplace, per the schema's own comment.
// No TS DAL to port from — this is new.
package dbx

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/fleetqr"
	"github.com/esoko/core-go/internal/ledger"
	"github.com/esoko/core-go/internal/loyalty"
)

type ParcelError struct {
	Code    string // BAD_INPUT | NOT_FOUND | FORBIDDEN | WRONG_CODE | ALREADY_DELIVERED
	Message string
}

func (e *ParcelError) Error() string { return e.Message }

// ValidParcelTypes — the 5 brackets from the standard rate card (see
// ParcelPricingRule / the 20260910000001 migration's seed rows). Kept
// as a plain slice, not derived from the DB, so BookParcel can reject
// an unknown type before ever touching pricing.
var ValidParcelTypes = []string{"ENVELOPE_DOCUMENT", "SMALL", "MEDIUM", "LARGE", "HEAVY_OVERSIZE"}

func isValidParcelType(t string) bool {
	for _, v := range ValidParcelTypes {
		if v == t {
			return true
		}
	}
	return false
}

type BookParcelInput struct {
	SenderPartyID    *string
	SenderName       string
	SenderMsisdn     string
	ReceiverName     string
	ReceiverMsisdn   string
	OriginLabel      string
	DestinationLabel string
	Notes            *string
	ParcelType       string
	WeightKg         *float64
	Fragile          bool
	// OriginZoneID/DestinationZoneID are optional — a booking that skips
	// zone selection degrades to flat weight-bracket pricing (see
	// DistanceSurchargeKes's own comment). Not validated against
	// parcel_zone here; an unknown id just never matches a zone at
	// price-calc time, same "fail open to the simpler price" choice.
	OriginZoneID      *string
	DestinationZoneID *string
	// ExistingCode — a code already printed and stuck on the physical
	// parcel ahead of time (see ParcelLabelStock), rather than one
	// minted fresh here. When set, BookParcel validates it against the
	// unused pool and spends it atomically with the insert instead of
	// generating a new fleetqr code.
	ExistingCode *string
}

// BookParcel mints the parcel's own tracking code (PKG-…, via
// fleetqr's minting contract — see the security posture's rule on
// never hand-rolling a short code) plus a second, separate
// deliveryCode only the sender ever sees, only the receiver ever types
// in (see DeliverParcel). Starts life as DRAFT_PENDING_PAYMENT, same
// "don't count it until it's paid" rule store checkout's
// PENDING_PAYMENT status already follows — SetParcelPrice then
// PayParcelWithPoints/ConfirmParcelPaymentByCheckoutID are what turn it
// into a real, BOOKED parcel.
func BookParcel(ctx context.Context, pool *pgxpool.Pool, in BookParcelInput) (parcelID, code, deliveryCode string, err error) {
	if in.SenderName == "" || in.SenderMsisdn == "" {
		return "", "", "", &ParcelError{"BAD_INPUT", "Sender name and phone are required"}
	}
	if in.ReceiverName == "" || in.ReceiverMsisdn == "" {
		return "", "", "", &ParcelError{"BAD_INPUT", "Receiver name and phone are required"}
	}
	if in.OriginLabel == "" || in.DestinationLabel == "" {
		return "", "", "", &ParcelError{"BAD_INPUT", "Origin and destination are required"}
	}
	if !isValidParcelType(in.ParcelType) {
		return "", "", "", &ParcelError{"BAD_INPUT", "Choose a valid parcel type"}
	}
	pricing, err := GetParcelPricing(ctx, pool, in.ParcelType)
	if err != nil {
		return "", "", "", err
	}
	if pricing == nil {
		return "", "", "", &ParcelError{"BAD_INPUT", "That parcel type is not priced yet — ask an admin to set it up"}
	}
	deliveryCode, err = generateDeliveryCode()
	if err != nil {
		return "", "", "", err
	}

	insertParcel := func(useCode string) error {
		return pool.QueryRow(ctx, `
			INSERT INTO parcel (
				id, code, "deliveryCode", "senderPartyId", "senderName", "senderMsisdn",
				"receiverName", "receiverMsisdn", "originLabel", "destinationLabel", notes,
				"parcelType", "weightKg", fragile, "transportMode", "originZoneId", "destinationZoneId",
				status, "createdAt"
			) VALUES (
				gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
				$11::"ParcelType", $12, $13, $14::"ParcelTransportMode", $15, $16,
				'DRAFT_PENDING_PAYMENT', now()
			) RETURNING id`,
			useCode, deliveryCode, in.SenderPartyID, in.SenderName, in.SenderMsisdn,
			in.ReceiverName, in.ReceiverMsisdn, in.OriginLabel, in.DestinationLabel, in.Notes,
			in.ParcelType, in.WeightKg, in.Fragile, pricing.SuggestedTransportMode,
			in.OriginZoneID, in.DestinationZoneID).
			Scan(&parcelID)
	}

	if in.ExistingCode != nil && *in.ExistingCode != "" {
		// A pre-printed label being filled in — see ParcelLabelStock's
		// own comment. Claiming the stock row and inserting the parcel
		// happen in one transaction so two staff scanning the same
		// physical label at once can't both win it.
		code = *in.ExistingCode
		tx, terr := pool.Begin(ctx)
		if terr != nil {
			return "", "", "", terr
		}
		defer func() { _ = tx.Rollback(ctx) }()
		var stockID string
		lockErr := tx.QueryRow(ctx, `
			SELECT id FROM parcel_label_stock WHERE code = $1 AND "usedAt" IS NULL FOR UPDATE`,
			code).Scan(&stockID)
		if errors.Is(lockErr, pgx.ErrNoRows) {
			return "", "", "", &ParcelError{"BAD_INPUT", "That label code isn't a known, unused pre-printed label"}
		}
		if lockErr != nil {
			return "", "", "", lockErr
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO parcel (
				id, code, "deliveryCode", "senderPartyId", "senderName", "senderMsisdn",
				"receiverName", "receiverMsisdn", "originLabel", "destinationLabel", notes,
				"parcelType", "weightKg", fragile, "transportMode", "originZoneId", "destinationZoneId",
				status, "createdAt"
			) VALUES (
				gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
				$11::"ParcelType", $12, $13, $14::"ParcelTransportMode", $15, $16,
				'DRAFT_PENDING_PAYMENT', now()
			) RETURNING id`,
			code, deliveryCode, in.SenderPartyID, in.SenderName, in.SenderMsisdn,
			in.ReceiverName, in.ReceiverMsisdn, in.OriginLabel, in.DestinationLabel, in.Notes,
			in.ParcelType, in.WeightKg, in.Fragile, pricing.SuggestedTransportMode,
			in.OriginZoneID, in.DestinationZoneID).
			Scan(&parcelID); err != nil {
			return "", "", "", err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE parcel_label_stock SET "usedAt" = now(), "usedByParcelId" = $1 WHERE id = $2`,
			parcelID, stockID); err != nil {
			return "", "", "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", "", "", err
		}
		return parcelID, code, deliveryCode, nil
	}

	err = retryUnique(func() error {
		code = fleetqr.ShortCodeChecked(fleetqr.PrefixParcel, 6)
		return insertParcel(code)
	})
	return parcelID, code, deliveryCode, err
}

// BargainReason — one admin-configured "make an offer" option, e.g.
// {"reason":"Not fragile","extraDiscountPct":5}. Never a free-typed
// discount: SetParcelPrice only ever accepts a price that lands on one
// of these, re-derived server-side.
type BargainReason struct {
	Reason           string  `json:"reason"`
	ExtraDiscountPct float64 `json:"extraDiscountPct"`
}

// ParcelPricing is ParcelPricingRule's read-side projection — the
// admin app (Prisma) is the sole writer of parcel_pricing_rule; this
// is core-go's read-only view of it at booking/pricing time.
type ParcelPricing struct {
	ParcelType             string          `json:"parcelType"`
	WeightLabel            string          `json:"weightLabel"`
	MinWeightKg            float64         `json:"minWeightKg"`
	MaxWeightKg            float64         `json:"maxWeightKg"`
	MinKes                 float64         `json:"minKes"`
	MaxKes                 float64         `json:"maxKes"`
	BargainMinPct          float64         `json:"bargainMinPct"`
	BargainMaxPct          float64         `json:"bargainMaxPct"`
	BargainReasons         []BargainReason `json:"bargainReasons"`
	SuggestedTransportMode string          `json:"suggestedTransportMode"`
}

const parcelPricingColumns = `
	"parcelType"::text, "weightLabel", "minWeightKg"::text, "maxWeightKg"::text,
	"minKes"::text, "maxKes"::text, "bargainMinPct"::text, "bargainMaxPct"::text,
	"bargainReasons", "suggestedTransportMode"::text`

// scanParcelPricing reads one parcelPricingColumns row — shared by
// GetParcelPricing (one type) and ListParcelPricing (every type, for
// the mobile booking form's weight-to-bracket matching).
func scanParcelPricing(row pgx.Row) (*ParcelPricing, error) {
	var p ParcelPricing
	var minWeightText, maxWeightText, minText, maxText, bargainMinText, bargainMaxText string
	var reasonsRaw []byte
	err := row.Scan(&p.ParcelType, &p.WeightLabel, &minWeightText, &maxWeightText,
		&minText, &maxText, &bargainMinText, &bargainMaxText, &reasonsRaw, &p.SuggestedTransportMode)
	if err != nil {
		return nil, err
	}
	for _, f := range []struct {
		text string
		dst  *float64
	}{
		{minWeightText, &p.MinWeightKg}, {maxWeightText, &p.MaxWeightKg},
		{minText, &p.MinKes}, {maxText, &p.MaxKes},
		{bargainMinText, &p.BargainMinPct}, {bargainMaxText, &p.BargainMaxPct},
	} {
		if *f.dst, err = strconv.ParseFloat(f.text, 64); err != nil {
			return nil, err
		}
	}
	if err := json.Unmarshal(reasonsRaw, &p.BargainReasons); err != nil {
		return nil, err
	}
	return &p, nil
}

func GetParcelPricing(ctx context.Context, pool *pgxpool.Pool, parcelType string) (*ParcelPricing, error) {
	row := pool.QueryRow(ctx, `SELECT `+parcelPricingColumns+`
		FROM parcel_pricing_rule WHERE "parcelType" = $1::"ParcelType"`, parcelType)
	p, err := scanParcelPricing(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return p, err
}

// ListParcelPricing — every parcel type's pricing, lightest first, so
// the mobile booking form can show each dropdown option's own weight/
// price range up front and match an entered weight to a bracket
// without a round trip per keystroke.
func ListParcelPricing(ctx context.Context, pool *pgxpool.Pool) ([]ParcelPricing, error) {
	rows, err := pool.Query(ctx, `SELECT `+parcelPricingColumns+`
		FROM parcel_pricing_rule ORDER BY "minWeightKg" ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelPricing
	for rows.Next() {
		p, err := scanParcelPricing(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// priceTolerance absorbs float round-tripping through Decimal↔text↔
// float64 — a client sending back exactly the number this endpoint
// quoted it should never bounce on a cent of drift.
const priceTolerance = 0.5

// SetParcelPrice re-validates the sender's chosen price against
// ParcelPricingRule server-side — the client's number is only ever a
// UI convenience, never trusted. With no bargainReason, priceKes must
// land in [minKes, maxKes]; with one, it must land in
// [minKes*(1-effectivePct/100), minKes], where effectivePct is
// bargainMinPct plus that reason's extraDiscountPct, capped at
// bargainMaxPct.
func SetParcelPrice(ctx context.Context, pool *pgxpool.Pool, code string, priceKes float64, bargainReason *string) error {
	var status, parcelType string
	var originZoneID, destinationZoneID *string
	err := pool.QueryRow(ctx, `
		SELECT status::text, "parcelType"::text, "originZoneId"::text, "destinationZoneId"::text
		FROM parcel WHERE code = $1`, code).
		Scan(&status, &parcelType, &originZoneID, &destinationZoneID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if status != "DRAFT_PENDING_PAYMENT" {
		return &ParcelError{"BAD_INPUT", "This parcel's price can no longer be changed"}
	}
	pricing, err := GetParcelPricing(ctx, pool, parcelType)
	if err != nil {
		return err
	}
	if pricing == nil {
		return &ParcelError{"BAD_INPUT", "This parcel type is not priced"}
	}

	// Distance surcharge is additive on top of the weight bracket, only
	// when both zones are set and an admin has configured a per-km rate
	// — see DistanceSurchargeKes's own comment on the graceful-
	// degradation path when either is missing.
	surchargeKes, _, err := DistanceSurchargeKes(ctx, pool, originZoneID, destinationZoneID)
	if err != nil {
		return err
	}
	pricing.MinKes += surchargeKes
	pricing.MaxKes += surchargeKes

	if bargainReason == nil || *bargainReason == "" {
		if priceKes < pricing.MinKes-priceTolerance || priceKes > pricing.MaxKes+priceTolerance {
			return &ParcelError{"BAD_INPUT", "That price is outside the standard range"}
		}
	} else {
		var matched *BargainReason
		for i := range pricing.BargainReasons {
			if strings.EqualFold(strings.TrimSpace(pricing.BargainReasons[i].Reason), strings.TrimSpace(*bargainReason)) {
				matched = &pricing.BargainReasons[i]
				break
			}
		}
		if matched == nil {
			return &ParcelError{"BAD_INPUT", "That's not one of the offer reasons for this parcel type"}
		}
		effectivePct := pricing.BargainMinPct + matched.ExtraDiscountPct
		if effectivePct > pricing.BargainMaxPct {
			effectivePct = pricing.BargainMaxPct
		}
		floorKes := pricing.MinKes * (1 - effectivePct/100)
		if priceKes < floorKes-priceTolerance || priceKes > pricing.MinKes+priceTolerance {
			return &ParcelError{"BAD_INPUT", "That offer is outside the allowed range for this reason"}
		}
	}

	_, err = pool.Exec(ctx, `UPDATE parcel SET "priceKes" = $1, "bargainReason" = $2 WHERE code = $3`, priceKes, bargainReason, code)
	return err
}

// GetParcelForPayment — the small "code → priceKes, status" lookup
// handlePayParcel needs to start an STK push without pulling in the
// whole ParcelStatusView.
func GetParcelForPayment(ctx context.Context, pool *pgxpool.Pool, code string) (priceKes float64, status string, err error) {
	var priceKesText *string
	err = pool.QueryRow(ctx, `SELECT "priceKes"::text, status::text FROM parcel WHERE code = $1`, code).
		Scan(&priceKesText, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return 0, "", err
	}
	if priceKesText != nil {
		priceKes, err = strconv.ParseFloat(*priceKesText, 64)
		if err != nil {
			return 0, "", err
		}
	}
	return priceKes, status, nil
}

// AttachParcelPaymentCheckoutID — same "stash the STK checkout id so
// the webhook can find its way back" role as
// store.AttachOrderCheckoutRequestID.
func AttachParcelPaymentCheckoutID(ctx context.Context, pool *pgxpool.Pool, code, checkoutRequestID string) error {
	_, err := pool.Exec(ctx, `UPDATE parcel SET "paymentMethod" = 'MPESA_STK', "paymentCheckoutRequestId" = $1 WHERE code = $2`, checkoutRequestID, code)
	return err
}

// ErrParcelPaymentNotFound lets the STK callback dispatcher
// (handlers_payments_webhook.go) fall through to the next Go-owned
// domain, same "only continue on NOT_FOUND" shape ErrOrderNotFound
// already follows.
var ErrParcelPaymentNotFound = errors.New("no parcel for that checkout request")

// ConfirmParcelPaymentByCheckoutID mirrors
// ConfirmStoreOrderPaymentByCheckoutID's shape: idempotent on
// checkoutRequestId, posts to the ledger (platform-pooled
// PARCEL_REVENUE — parcels are an Esoko-run service, not a
// per-merchant marketplace, so there's no revenue split to make),
// earns loyalty for a signed-in sender. Returns the parcel's own code
// and whether this call is the one that actually confirmed it (vs. a
// replayed callback finding it already BOOKED) — callers use that to
// send the payment-confirmation SMS exactly once (see
// handlers_parcels.go / handlers_payments_webhook.go).
func ConfirmParcelPaymentByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID, mpesaReceiptCode string, loyaltyEnabled bool) (code string, justConfirmed bool, err error) {
	var parcelID, status, priceKesText string
	var senderPartyID *string
	err = pool.QueryRow(ctx, `
		SELECT id, code, status::text, "priceKes"::text, "senderPartyId" FROM parcel
		WHERE "paymentCheckoutRequestId" = $1`, checkoutRequestID).
		Scan(&parcelID, &code, &status, &priceKesText, &senderPartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, ErrParcelPaymentNotFound
	}
	if err != nil {
		return "", false, err
	}
	if status != "DRAFT_PENDING_PAYMENT" {
		return code, false, nil // already confirmed — replayed callback
	}
	priceKes, err := strconv.ParseFloat(priceKesText, 64)
	if err != nil {
		return "", false, err
	}

	settlementAcct, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return "", false, err
	}
	revenueAcct, err := ledger.EnsureAccount(ctx, pool, nil, "PARCEL_REVENUE", "KES")
	if err != nil {
		return "", false, err
	}
	if _, err := ledger.PostEntry(ctx, pool,
		"parcel:"+parcelID, "Parcel delivery payment", "core-go:parcel:"+parcelID,
		[]ledger.Posting{{AccountID: settlementAcct, AmountKES: priceKes}, {AccountID: revenueAcct, AmountKES: -priceKes}}); err != nil {
		return "", false, err
	}

	if senderPartyID != nil {
		_ = loyalty.EarnForSpend(ctx, pool, *senderPartyID, priceKes, "parcel:"+parcelID, loyaltyEnabled)
	}

	var receiptCol *string
	if mpesaReceiptCode != "" {
		receiptCol = &mpesaReceiptCode
	}
	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET "paidAt" = now(), status = 'BOOKED', "mpesaReceiptCode" = $1,
		       "slaDeadlineAt" = now() + (SELECT "slaHours" FROM parcel_pricing_rule WHERE "parcelType" = parcel."parcelType") * interval '1 hour'
		WHERE id = $2`, receiptCol, parcelID); err != nil {
		return "", false, err
	}
	return code, true, nil
}

// PayParcelWithPoints — the ESOKO_POINTS payment path, settled inline
// (no STK round trip), same shape store checkout's VOUCHER method
// already follows. Only the party that booked the parcel can spend
// their own points on it — a guest booking (senderPartyId nil) can
// never match, so this cleanly forces guests onto MPESA_STK instead.
func PayParcelWithPoints(ctx context.Context, pool *pgxpool.Pool, code, partyID string) error {
	var status, priceKesText string
	err := pool.QueryRow(ctx, `
		SELECT status::text, "priceKes"::text FROM parcel WHERE code = $1 AND "senderPartyId" = $2`, code, partyID).
		Scan(&status, &priceKesText)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if status != "DRAFT_PENDING_PAYMENT" {
		return &ParcelError{"BAD_INPUT", "This parcel is not awaiting payment"}
	}
	priceKes, err := strconv.ParseFloat(priceKesText, 64)
	if err != nil {
		return err
	}
	if priceKes <= 0 {
		return &ParcelError{"BAD_INPUT", "Choose a price before paying"}
	}
	points := loyalty.PointsForKES(priceKes)
	if err := loyalty.SpendFromParty(ctx, pool, partyID, points, "parcel:"+code); err != nil {
		if errors.Is(err, loyalty.ErrInsufficientLoyalty) {
			return &ParcelError{"INSUFFICIENT_POINTS", "Not enough Esoko points for this parcel"}
		}
		return err
	}
	_, err = pool.Exec(ctx, `
		UPDATE parcel SET "paymentMethod" = 'ESOKO_POINTS', "paidAt" = now(), status = 'BOOKED',
		       "slaDeadlineAt" = now() + (SELECT "slaHours" FROM parcel_pricing_rule WHERE "parcelType" = parcel."parcelType") * interval '1 hour'
		WHERE code = $1`, code)
	return err
}

// generateDeliveryCode mirrors generatePickupCode's alphabet trick
// (store.go) — short, no ambiguous characters, read aloud by a human
// rather than scanned.
func generateDeliveryCode() (string, error) {
	b := make([]byte, 6)
	if _, err := cryptorand.Read(b); err != nil {
		return "", err
	}
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	out := make([]byte, 6)
	for i := range out {
		out[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(out), nil
}

// ParcelStatusView is the guest-safe status pill projection anyone
// pointing a scanner or typing the code sees — status, route, dates.
// No sender/receiver name or phone: same PII-minimal rule
// ResolveTicketByCode/OrderHit already follow for a guest-safe scan.
type ParcelStatusView struct {
	Code                  string     `json:"code"`
	Status                string     `json:"status"`
	OriginLabel           string     `json:"originLabel"`
	DestinationLabel      string     `json:"destinationLabel"`
	ParcelType            string     `json:"parcelType"`
	PriceKes              *string    `json:"priceKes"`
	CollectionScheduledAt *time.Time `json:"collectionScheduledAt"`
	CreatedAt             time.Time  `json:"createdAt"`
	DeliveredAt           *time.Time `json:"deliveredAt"`
	// CancellationReason/CancelledAt are operational text, not PII — safe
	// on this guest-safe projection (unlike refund status, which stays
	// admin-only). Without these the CANCELLED status had nothing to
	// show beyond the bare enum value.
	CancellationReason *string    `json:"cancellationReason"`
	CancelledAt        *time.Time `json:"cancelledAt"`
	// ReceiptConfirmedAt — set once the receiver has OTP-confirmed
	// receipt (see ConfirmParcelReceipt). Rating/feedback stay off this
	// public view; they surface to the sender via SMS and to admin via
	// AdminParcelRow instead.
	ReceiptConfirmedAt *time.Time `json:"receiptConfirmedAt"`
	// PreLabel/PreLabelInfo — set only on the pre-printed-label
	// fallback below, when [code] isn't a real, booked Parcel (yet).
	// Status reads "LABEL_PRINTED" in that case — a sentinel no real
	// Parcel row ever has, so a client can tell the two cases apart
	// from this one JSON shape without a separate endpoint.
	PreLabel     bool             `json:"preLabel"`
	PreLabelInfo *ParcelLabelInfo `json:"preLabelInfo"`
}

// ParcelLabelInfo is the structured info a handler attached to a
// pre-printed label in the field (see AttachParcelLabelInfo) — nil
// until at least an item description has been filled in, even for a
// genuinely pre-printed (but still blank) label.
type ParcelLabelInfo struct {
	ItemDescription string    `json:"itemDescription"`
	Destination     *string   `json:"destination"`
	OwnerName       *string   `json:"ownerName"`
	OwnerContact    *string   `json:"ownerContact"`
	OwnerGender     *string   `json:"ownerGender"`
	ItemType        *string   `json:"itemType"`
	WeightRangeKg   *string   `json:"weightRangeKg"`
	AttachedAt      time.Time `json:"attachedAt"`
}

// GetParcelStatus is the guest-safe projection anyone scanning or
// typing a PKG- code sees, on the web track page and the mobile scan
// flow alike. A code that was pre-printed (see ParcelLabelStock) but
// never became a real booking still resolves here instead of 404ing —
// falls back to whatever field note was attached to it (see
// AttachParcelLabelInfo), so "scan the label, see what's on it" works
// the same whether or not the item behind it was ever formally booked.
func GetParcelStatus(ctx context.Context, pool *pgxpool.Pool, code string) (*ParcelStatusView, error) {
	var v ParcelStatusView
	err := pool.QueryRow(ctx, `
		SELECT code, status::text, "originLabel", "destinationLabel", "parcelType"::text,
		       "priceKes"::text, "collectionScheduledAt", "createdAt", "deliveredAt",
		       "cancellationReason", "cancelledAt", "receiptConfirmedAt"
		FROM parcel WHERE code = $1`, code).
		Scan(&v.Code, &v.Status, &v.OriginLabel, &v.DestinationLabel, &v.ParcelType,
			&v.PriceKes, &v.CollectionScheduledAt, &v.CreatedAt, &v.DeliveredAt,
			&v.CancellationReason, &v.CancelledAt, &v.ReceiptConfirmedAt)
	if err == nil {
		return &v, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	var stock ParcelStatusView
	var createdAt time.Time
	var itemDescription *string
	var info ParcelLabelInfo
	var infoAttachedAt *time.Time
	serr := pool.QueryRow(ctx, `
		SELECT code, "createdAt", "itemDescription", destination, "ownerName", "ownerContact",
		       "ownerGender", "itemType", "weightRangeKg", "infoAttachedAt"
		FROM parcel_label_stock WHERE code = $1`, code).
		Scan(&stock.Code, &createdAt, &itemDescription, &info.Destination, &info.OwnerName,
			&info.OwnerContact, &info.OwnerGender, &info.ItemType, &info.WeightRangeKg, &infoAttachedAt)
	if errors.Is(serr, pgx.ErrNoRows) {
		return nil, nil
	}
	if serr != nil {
		return nil, serr
	}
	stock.Status = "LABEL_PRINTED"
	stock.CreatedAt = createdAt
	stock.PreLabel = true
	if itemDescription != nil {
		info.ItemDescription = *itemDescription
		if infoAttachedAt != nil {
			info.AttachedAt = *infoAttachedAt
		}
		stock.PreLabelInfo = &info
	}
	return &stock, nil
}

// ParcelLabel is what a handler prints and sticks on the physical
// parcel — enough to sort/route it and confirm the receiver by eye,
// deliberately short of the full ParcelRow: no phone numbers, no
// price, no sender/receiver address — a label rides in the open on the
// outside of the package, so it gets the same PII-minimal treatment
// ParcelStatusView gives anyone who scans the code. ReceiverPhoneLast4
// is the one exception, and only the last 4 digits — enough for a
// courier to confirm "is this your parcel?" at the door without the
// label itself being a usable contact card if the parcel is lost.
type ParcelLabel struct {
	Code               string    `json:"code"`
	Status             string    `json:"status"`
	ParcelType         string    `json:"parcelType"`
	WeightKg           *float64  `json:"weightKg"`
	OriginLabel        string    `json:"originLabel"`
	DestinationLabel   string    `json:"destinationLabel"`
	ReceiverName       string    `json:"receiverName"`
	ReceiverPhoneLast4 string    `json:"receiverPhoneLast4"`
	CreatedAt          time.Time `json:"createdAt"`
}

// GetParcelLabel loads the label projection for [code]. Authorization
// is the caller's job (see handleGetParcelLabel) — this is a pure
// read, same split GetParcelStatus/ScanHandoff already keep between
// "can they see it" and "what's in it".
func GetParcelLabel(ctx context.Context, pool *pgxpool.Pool, code string) (*ParcelLabel, error) {
	var v ParcelLabel
	var receiverMsisdn string
	err := pool.QueryRow(ctx, `
		SELECT code, status::text, "parcelType"::text, "weightKg", "originLabel", "destinationLabel",
		       "receiverName", "receiverMsisdn", "createdAt"
		FROM parcel WHERE code = $1`, code).
		Scan(&v.Code, &v.Status, &v.ParcelType, &v.WeightKg, &v.OriginLabel, &v.DestinationLabel,
			&v.ReceiverName, &receiverMsisdn, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(receiverMsisdn) >= 4 {
		v.ReceiverPhoneLast4 = receiverMsisdn[len(receiverMsisdn)-4:]
	}
	return &v, nil
}

// IsParcelHandler — true when [partyID] is either currently holding
// [code] or is the collector an admin assigned it to, the same two
// custody-adjacent roles ScanHandoff already treats as entitled to act
// on the parcel. A handler in either state has physical possession (or
// is about to), so seeing/printing its label is no wider a grant than
// what they already have.
func IsParcelHandler(ctx context.Context, pool *pgxpool.Pool, code, partyID string) (bool, error) {
	if partyID == "" {
		return false, nil
	}
	var currentHolder, assignedCollector *string
	err := pool.QueryRow(ctx, `
		SELECT "currentHolderPartyId", "assignedCollectorPartyId" FROM parcel WHERE code = $1`, code).
		Scan(&currentHolder, &assignedCollector)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return (currentHolder != nil && *currentHolder == partyID) ||
		(assignedCollector != nil && *assignedCollector == partyID), nil
}

// ParcelLabelStockRow is one pre-printed, not-yet-spent label — wire
// type matching dbx.ListUnusedParcelLabelStock, what an ops screen
// re-prints a batch of blank labels from.
type ParcelLabelStockRow struct {
	Code      string    `json:"code"`
	CreatedAt time.Time `json:"createdAt"`
}

// errCodeSpaceCollision — GenerateParcelLabelStock's own signal to
// retryUnique that a freshly-minted code needs re-rolling, for the one
// collision case that never touches Postgres's real unique index: the
// candidate code matches an *already-booked* parcel's own code (a
// different table, so no DB constraint catches it). Satisfies the same
// `SQLState() string` shape isUniqueViolation checks for.
type sqlStateError string

func (e sqlStateError) Error() string    { return string(e) }
func (e sqlStateError) SQLState() string { return "23505" }

var errCodeSpaceCollision = sqlStateError("code already used by a booked parcel")

// GenerateParcelLabelStock mints [count] fresh, unbound PKG-… codes —
// same fleetqr contract BookParcel's own code minting uses, so a blank
// pre-printed label and a booked-at-checkout label look identical and
// share one scanning/QR pipeline. Returns them in mint order, newest
// last, so the caller can print/display "batch of N" as one strip.
func GenerateParcelLabelStock(ctx context.Context, pool *pgxpool.Pool, count int, staffID *string) ([]string, error) {
	if count < 1 || count > 500 {
		return nil, &ParcelError{"BAD_INPUT", "Generate between 1 and 500 labels at a time"}
	}
	codes := make([]string, 0, count)
	for i := 0; i < count; i++ {
		var code string
		err := retryUnique(func() error {
			code = fleetqr.ShortCodeChecked(fleetqr.PrefixParcel, 6)
			// Same code space as parcel.code (both PKG-…, both unique)
			// — check both tables so a blank label can never collide
			// with an already-booked parcel's own tracking code.
			var exists bool
			if qerr := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM parcel WHERE code = $1)`, code).Scan(&exists); qerr != nil {
				return qerr
			}
			if exists {
				return errCodeSpaceCollision // forces retryUnique to mint another
			}
			_, err := pool.Exec(ctx, `
				INSERT INTO parcel_label_stock (id, code, "createdAt", "createdByStaffId")
				VALUES (gen_random_uuid(), $1, now(), $2)`, code, staffID)
			return err
		})
		if err != nil {
			return codes, err
		}
		codes = append(codes, code)
	}
	return codes, nil
}

// ListUnusedParcelLabelStock — the still-genuinely-blank half of the
// pool (never bound to a real parcel, never even had a note attached
// in the field), newest first, for a "reprint this batch" or "how
// many do we have left" view. A label with itemInfo attached is
// excluded the same as a used one — it's already spoken for, even if
// it never becomes a real booking.
func ListUnusedParcelLabelStock(ctx context.Context, pool *pgxpool.Pool, limit int) ([]ParcelLabelStockRow, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := pool.Query(ctx, `
		SELECT code, "createdAt" FROM parcel_label_stock
		WHERE "usedAt" IS NULL AND "infoAttachedAt" IS NULL
		ORDER BY "createdAt" DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelLabelStockRow
	for rows.Next() {
		var r ParcelLabelStockRow
		if err := rows.Scan(&r.Code, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AttachParcelLabelInfo writes a free-form note onto a pre-printed
// label — "TV stand for Kevin, HQ -> Westlands" — the moment a
// handler sticks it on a physical item in the field, well before (if
// ever) that item goes through a full sender/receiver/pricing/payment
// booking. Overwrites any previous note on repeat calls (correcting a
// typo shouldn't need a separate "clear" step) but refuses once the
// code has already been spent on a real booking — that's a stronger,
// one-way commitment ExistingCode already made; a note at that point
// would just be confusing about which system of record is current.
// ParcelLabelInfoInput is what a handler fills in for a pre-printed
// label in the field — see AttachParcelLabelInfo's own comment. Every
// field is optional individually (a handler might only know the item
// and destination at first), but at least ItemDescription is required
// — a completely empty attach is a no-op that shouldn't have been
// called.
type ParcelLabelInfoInput struct {
	ItemDescription string
	Destination     *string
	OwnerName       *string
	OwnerContact    *string
	OwnerGender     *string
	ItemType        *string
	WeightRangeKg   *string
}

// AttachParcelLabelInfo writes structured info onto a pre-printed
// label — item description, destination, owner name/contact/gender,
// item type, weight range — the moment a handler sticks it on a
// physical item in the field, well before (if ever) that item goes
// through a full sender/receiver/pricing/payment booking. Overwrites
// (never merges) on repeat calls — the caller always resends the full
// set it wants kept, same as an edit form re-submitting every field —
// but refuses once the code has already been spent on a real booking:
// that's a stronger, one-way commitment ExistingCode already made,
// and an in-field note at that point would just be a second, possibly
// conflicting system of record.
func AttachParcelLabelInfo(ctx context.Context, pool *pgxpool.Pool, code string, in ParcelLabelInfoInput, staffID *string) error {
	if in.ItemDescription == "" {
		return &ParcelError{"BAD_INPUT", "A short item description is required"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_label_stock
		SET "itemDescription" = $1, "destination" = $2, "ownerName" = $3, "ownerContact" = $4,
		    "ownerGender" = $5, "itemType" = $6, "weightRangeKg" = $7,
		    "infoAttachedAt" = now(), "infoAttachedByStaffId" = $8
		WHERE code = $9 AND "usedAt" IS NULL`,
		in.ItemDescription, in.Destination, in.OwnerName, in.OwnerContact,
		in.OwnerGender, in.ItemType, in.WeightRangeKg, staffID, code)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists, used bool
		_ = pool.QueryRow(ctx, `SELECT true, "usedAt" IS NOT NULL FROM parcel_label_stock WHERE code = $1`, code).Scan(&exists, &used)
		if used {
			return &ParcelError{"BAD_INPUT", "That label is already bound to a booked parcel — info can't be attached to it anymore"}
		}
		return &ParcelError{"NOT_FOUND", "That label code isn't a known pre-printed label"}
	}
	return nil
}

// ParcelNotifyInfo is what the handoff/delivery handlers need to
// compose the notify.Parcel* SMS pair — kept as its own lookup (rather
// than threading these through ScanHandoff/DeliverParcel's return
// values) so those two stay focused on the custody-chain state change.
type ParcelNotifyInfo struct {
	SenderName       string
	SenderMsisdn     string
	ReceiverName     string
	ReceiverMsisdn   string
	OriginLabel      string
	DestinationLabel string
	DeliveredAt      *time.Time
	PriceKes         *string
	MpesaReceiptCode *string
	// CurrentHolderName — whoever has custody right now, resolved for
	// display (e.g. "picked up by {name}") — nil before the first
	// handoff, when the parcel is still with the sender.
	CurrentHolderName *string
	// DeliveryCode — the code DeliverParcel checks against. The
	// receiver is the one who has to produce it for the courier, so it
	// has to reach the receiver somehow; it was generated at booking
	// and shown only to the sender's own "Sent" list, with nothing
	// ever actually relaying it to the receiver. See the pickup SMS
	// below, which is what now closes that gap.
	DeliveryCode string
}

func GetParcelNotifyInfo(ctx context.Context, pool *pgxpool.Pool, code string) (*ParcelNotifyInfo, error) {
	var v ParcelNotifyInfo
	err := pool.QueryRow(ctx, `
		SELECT p."senderName", p."senderMsisdn", p."receiverName", p."receiverMsisdn", p."originLabel", p."destinationLabel",
		       p."deliveredAt", p."priceKes"::text, p."mpesaReceiptCode", COALESCE(pr."knownAs", pr."officialName"), p."deliveryCode"
		FROM parcel p
		LEFT JOIN person pr ON pr."partyId" = p."currentHolderPartyId"
		WHERE p.code = $1`, code).
		Scan(&v.SenderName, &v.SenderMsisdn, &v.ReceiverName, &v.ReceiverMsisdn, &v.OriginLabel, &v.DestinationLabel,
			&v.DeliveredAt, &v.PriceKes, &v.MpesaReceiptCode, &v.CurrentHolderName, &v.DeliveryCode)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// ScanHandoff is a driver/handler scanning a parcel into their own
// custody. Possession of the code plus being signed in is enough for
// every leg *after* the first — but the very first pickup
// (BOOKED→PICKED_UP) is gated by AssignParcelCollector's assignment,
// when one exists: an admin who scheduled a specific collector meant
// that scheduling to be enforced, not just a courtesy SMS. With nobody
// assigned yet, the first signed-in scanner still takes it, matching
// the physical reality of an unscheduled walk-in collection.
// Idempotent: scanning a code you already hold is a no-op, not an
// error, so a nervous double-scan on a slow network never fails.
// wasFirstPickup tells the caller whether this was the BOOKED→PICKED_UP
// transition specifically — that's the one moment handlers_parcels.go
// sends the pickup SMS; every later leg (IN_TRANSIT) and every replayed
// scan stays silent.
func ScanHandoff(ctx context.Context, pool *pgxpool.Pool, code, scannedByPartyID string) (status string, wasFirstPickup bool, err error) {
	if scannedByPartyID == "" {
		return "", false, &ParcelError{"FORBIDDEN", "Sign in to accept a parcel"}
	}
	var parcelID, currentStatus string
	var currentHolder, assignedCollector *string
	err = pool.QueryRow(ctx, `
		SELECT id, status::text, "currentHolderPartyId", "assignedCollectorPartyId" FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &currentStatus, &currentHolder, &assignedCollector)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", false, err
	}
	if currentStatus == "DELIVERED" {
		return "", false, &ParcelError{"ALREADY_DELIVERED", "This parcel has already been delivered"}
	}
	if currentStatus == "DRAFT_PENDING_PAYMENT" {
		return "", false, &ParcelError{"BAD_INPUT", "This parcel hasn't been paid for yet"}
	}
	if currentHolder != nil && *currentHolder == scannedByPartyID {
		return currentStatus, false, nil // already holding it — replayed scan
	}
	if currentStatus == "BOOKED" && assignedCollector != nil && *assignedCollector != scannedByPartyID {
		return "", false, &ParcelError{"FORBIDDEN", "This parcel is assigned to another collector"}
	}

	nextStatus := nextHandoffStatus(currentStatus)
	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET status = $1::"ParcelStatus", "currentHolderPartyId" = $2 WHERE id = $3`,
		nextStatus, scannedByPartyID, parcelID); err != nil {
		return "", false, err
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO parcel_handoff (id, "parcelId", "fromPartyId", "toPartyId", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, now())`, parcelID, currentHolder, scannedByPartyID); err != nil {
		return "", false, err
	}
	return nextStatus, currentStatus == "BOOKED", nil
}

// nextHandoffStatus — a first scan (still BOOKED) means the courier
// just picked it up; every scan after that is just another leg of the
// journey. Pure so it's directly testable without a DB fixture, same
// pattern validDineInStatus/crewOwnsTrip already use elsewhere.
func nextHandoffStatus(current string) string {
	if current == "BOOKED" {
		return "PICKED_UP"
	}
	return "IN_TRANSIT"
}

// DeliverParcel is the terminal handoff — proof of receipt via the
// deliveryCode only the sender was shown, checked case-insensitively
// (see ConfirmOrderCollected's own comment on why: a human reading a
// code aloud won't reliably preserve case). Only the parcel's current
// holder can deliver it — a courier who never scanned custody can't
// short-circuit the chain.
func DeliverParcel(ctx context.Context, pool *pgxpool.Pool, code, deliveryCode, deliveredByPartyID string) error {
	var parcelID, status, storedDeliveryCode string
	var currentHolder *string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "deliveryCode", "currentHolderPartyId" FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &status, &storedDeliveryCode, &currentHolder)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if status == "DELIVERED" {
		return &ParcelError{"ALREADY_DELIVERED", "This parcel has already been delivered"}
	}
	if currentHolder == nil || *currentHolder != deliveredByPartyID {
		return &ParcelError{"FORBIDDEN", "You aren't holding this parcel"}
	}
	if !strings.EqualFold(strings.TrimSpace(deliveryCode), storedDeliveryCode) {
		return &ParcelError{"WRONG_CODE", "That delivery code doesn't match"}
	}
	_, err = pool.Exec(ctx, `
		UPDATE parcel SET status = 'DELIVERED', "deliveredAt" = now() WHERE id = $1`, parcelID)
	return err
}

// ParcelRow — one line on either "parcels I sent" or "parcels I'm
// holding". DeliveryCode only populates for the sender's own list
// (see ListMyParcels) — a handler never needs it and shouldn't see it.
type ParcelRow struct {
	ID               string
	Code             string
	DeliveryCode     *string
	SenderName       string
	ReceiverName     string
	OriginLabel      string
	DestinationLabel string
	Status           string
	PriceKes         *string
	CreatedAt        time.Time
	DeliveredAt      *time.Time
}

// ListMyParcels — every parcel this party has sent, newest first,
// including the deliveryCode so the sender can pass it on to the
// receiver, and priceKes so a DRAFT_PENDING_PAYMENT row can show what's
// owed and route back into the payment step.
func ListMyParcels(ctx context.Context, pool *pgxpool.Pool, senderPartyID string) ([]ParcelRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, code, "deliveryCode", "senderName", "receiverName", "originLabel", "destinationLabel", status::text, "priceKes"::text, "createdAt", "deliveredAt"
		FROM parcel WHERE "senderPartyId" = $1
		ORDER BY "createdAt" DESC`, senderPartyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelRow
	for rows.Next() {
		var r ParcelRow
		var deliveryCode string
		if err := rows.Scan(&r.ID, &r.Code, &deliveryCode, &r.SenderName, &r.ReceiverName, &r.OriginLabel, &r.DestinationLabel, &r.Status, &r.PriceKes, &r.CreatedAt, &r.DeliveredAt); err != nil {
			return nil, err
		}
		r.DeliveryCode = &deliveryCode
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListParcelsHeld — the handler/driver-facing "parcels I'm holding"
// list: everything currently in this party's custody, not yet
// delivered.
func ListParcelsHeld(ctx context.Context, pool *pgxpool.Pool, holderPartyID string) ([]ParcelRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, code, "senderName", "receiverName", "originLabel", "destinationLabel", status::text, "createdAt", "deliveredAt"
		FROM parcel WHERE "currentHolderPartyId" = $1 AND status IN ('PICKED_UP', 'IN_TRANSIT')
		ORDER BY "createdAt" ASC`, holderPartyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelRow
	for rows.Next() {
		var r ParcelRow
		if err := rows.Scan(&r.ID, &r.Code, &r.SenderName, &r.ReceiverName, &r.OriginLabel, &r.DestinationLabel, &r.Status, &r.CreatedAt, &r.DeliveredAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ── Admin: visibility, collector search, collection scheduling ──

// AdminParcelRow — one line on the admin parcels list, including
// DRAFT_PENDING_PAYMENT rows (an abandoned booking is still something
// an admin should be able to see) and whoever's been assigned to
// collect it, if anyone.
type AdminParcelRow struct {
	ID                      string
	Code                    string
	SenderName              string
	SenderMsisdn            string
	ReceiverName            string
	ReceiverMsisdn          string
	OriginLabel             string
	DestinationLabel        string
	ParcelType              string
	Status                  string
	PriceKes                *string
	AssignedCollectorName   *string
	AssignedCollectorMsisdn *string
	CollectionScheduledAt   *time.Time
	CollectionNote          *string
	CreatedAt               time.Time
	PaymentMethod           *string
	MpesaReceiptCode        *string
	RefundStatus            string
	RefundedAt              *time.Time
	ReceiptConfirmedAt      *time.Time
	ReceiptConditionRating  *int
	ReceiptFeedback         *string
	SlaDeadlineAt           *time.Time
	ExceptionNote           *string
	ExceptionFlaggedAt      *time.Time
	Notes                   *string
	CancellationReason      *string
	CancelledAt             *time.Time
	DeliveredAt             *time.Time
}

// AdminParcelStats is the parcels operations dashboard's whole
// "what needs my attention today" surface — every number here answers
// a real operational question (how much is stuck unpriced, how much
// is booked but nobody's been sent to collect it, how much is already
// late) rather than being a vanity count.
type AdminParcelStats struct {
	StatusCounts       map[string]int `json:"statusCounts"`
	RevenueTodayKes    float64        `json:"revenueTodayKes"`
	RevenueKes         float64        `json:"revenueKes"`
	NeedingAssignment  int            `json:"needingAssignment"`
	OverdueCollections int            `json:"overdueCollections"`
	StaleDrafts        int            `json:"staleDrafts"`
	CancelledToday     int            `json:"cancelledToday"`
	RefundsOwed        int            `json:"refundsOwed"`
	OverdueDeliveries  int            `json:"overdueDeliveries"`
}

// GetAdminParcelStats powers the Parcels overview panel. Every count
// is a plain aggregate over the same `parcel` table AdminListParcels
// already reads — no new tracking, just read for the first time as an
// operational signal, same reasoning the cross-domain report page's
// feature-adoption panel already uses for the audit log.
func GetAdminParcelStats(ctx context.Context, pool *pgxpool.Pool) (*AdminParcelStats, error) {
	stats := &AdminParcelStats{StatusCounts: map[string]int{}}

	rows, err := pool.Query(ctx, `SELECT status::text, count(*) FROM parcel GROUP BY status`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			rows.Close()
			return nil, err
		}
		stats.StatusCounts[status] = n
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM("priceKes"), 0)::float8 FROM parcel
		WHERE "paidAt" IS NOT NULL AND status != 'CANCELLED'`).Scan(&stats.RevenueKes); err != nil {
		return nil, err
	}
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM("priceKes"), 0)::float8 FROM parcel
		WHERE "paidAt" IS NOT NULL AND status != 'CANCELLED' AND "paidAt" >= date_trunc('day', now())`).Scan(&stats.RevenueTodayKes); err != nil {
		return nil, err
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM parcel WHERE status = 'BOOKED' AND "assignedCollectorPartyId" IS NULL`).Scan(&stats.NeedingAssignment); err != nil {
		return nil, err
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM parcel
		WHERE status = 'BOOKED' AND "collectionScheduledAt" IS NOT NULL AND "collectionScheduledAt" < now()`).Scan(&stats.OverdueCollections); err != nil {
		return nil, err
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM parcel WHERE status = 'DRAFT_PENDING_PAYMENT' AND "createdAt" < now() - interval '24 hours'`).Scan(&stats.StaleDrafts); err != nil {
		return nil, err
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM parcel WHERE status = 'CANCELLED' AND "cancelledAt" >= date_trunc('day', now())`).Scan(&stats.CancelledToday); err != nil {
		return nil, err
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM parcel WHERE "refundStatus" = 'PENDING'`).Scan(&stats.RefundsOwed); err != nil {
		return nil, err
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM parcel
		WHERE status IN ('PICKED_UP', 'IN_TRANSIT') AND "slaDeadlineAt" IS NOT NULL AND "slaDeadlineAt" < now()`).
		Scan(&stats.OverdueDeliveries); err != nil {
		return nil, err
	}
	return stats, nil
}

// AdminListParcels — status is an exact filter (or all statuses when
// nil); q matches sender/receiver name or the tracking code, same
// "search box over a couple of text columns" shape other admin lists
// in this package already use.
func AdminListParcels(ctx context.Context, pool *pgxpool.Pool, status, q *string) ([]AdminParcelRow, error) {
	query := `
		SELECT p.id, p.code, p."senderName", p."senderMsisdn", p."receiverName", p."receiverMsisdn",
		       p."originLabel", p."destinationLabel", p."parcelType"::text, p.status::text, p."priceKes"::text,
		       COALESCE(pr."knownAs", pr."officialName"), pr.msisdn, p."collectionScheduledAt", p."collectionNote", p."createdAt",
		       p."paymentMethod", p."mpesaReceiptCode", p."refundStatus", p."refundedAt",
		       p."receiptConfirmedAt", p."receiptConditionRating", p."receiptFeedback",
		       p."slaDeadlineAt", p."exceptionNote", p."exceptionFlaggedAt",
		       p.notes, p."cancellationReason", p."cancelledAt", p."deliveredAt"
		FROM parcel p
		LEFT JOIN person pr ON pr."partyId" = p."assignedCollectorPartyId"
		WHERE ($1::text IS NULL OR p.status::text = $1)
		  AND ($2::text IS NULL OR p."senderName" ILIKE '%'||$2||'%' OR p."receiverName" ILIKE '%'||$2||'%' OR p.code ILIKE '%'||$2||'%')
		ORDER BY p."createdAt" DESC
		LIMIT 200`
	rows, err := pool.Query(ctx, query, status, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminParcelRow
	for rows.Next() {
		var r AdminParcelRow
		if err := rows.Scan(&r.ID, &r.Code, &r.SenderName, &r.SenderMsisdn, &r.ReceiverName, &r.ReceiverMsisdn,
			&r.OriginLabel, &r.DestinationLabel, &r.ParcelType, &r.Status, &r.PriceKes,
			&r.AssignedCollectorName, &r.AssignedCollectorMsisdn, &r.CollectionScheduledAt, &r.CollectionNote, &r.CreatedAt,
			&r.PaymentMethod, &r.MpesaReceiptCode, &r.RefundStatus, &r.RefundedAt,
			&r.ReceiptConfirmedAt, &r.ReceiptConditionRating, &r.ReceiptFeedback,
			&r.SlaDeadlineAt, &r.ExceptionNote, &r.ExceptionFlaggedAt,
			&r.Notes, &r.CancellationReason, &r.CancelledAt, &r.DeliveredAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CollectorLite — a candidate collector for the admin's assign panel.
// Deliberately just "an existing Party with a phone" (the same
// identity that already shows up in ListParcelsHeld/ScanHandoff), not
// a separate courier role — see the plan's note on why.
type CollectorLite struct {
	PartyID string
	Name    string
	Msisdn  *string
}

func SearchCollectorParties(ctx context.Context, pool *pgxpool.Pool, q string) ([]CollectorLite, error) {
	rows, err := pool.Query(ctx, `
		SELECT pr."partyId", COALESCE(pr."knownAs", pr."officialName"), pr.msisdn
		FROM person pr
		WHERE pr."officialName" ILIKE '%'||$1||'%' OR pr."knownAs" ILIKE '%'||$1||'%' OR pr.msisdn ILIKE '%'||$1||'%'
		ORDER BY pr."officialName"
		LIMIT 20`, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CollectorLite
	for rows.Next() {
		var c CollectorLite
		if err := rows.Scan(&c.PartyID, &c.Name, &c.Msisdn); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// AssignParcelCollector — an admin scheduling who's going to collect a
// paid, BOOKED parcel and when. Distinct from currentHolderPartyId,
// which only changes once that person actually scans the code (see
// ScanHandoff) — this is just the heads-up. Returns enough for the
// caller to compose+send the "someone is coming" SMS itself (kept a
// handler-layer concern, same as pickup/delivery — see
// handlers_admin_parcels.go).
func AssignParcelCollector(ctx context.Context, pool *pgxpool.Pool, parcelID, collectorPartyID string, scheduledAt time.Time, note *string) (code, collectorName, collectorMsisdn, senderMsisdn, senderName, originLabel string, err error) {
	var status string
	err = pool.QueryRow(ctx, `SELECT status::text, code, "senderMsisdn", "senderName", "originLabel" FROM parcel WHERE id = $1`, parcelID).
		Scan(&status, &code, &senderMsisdn, &senderName, &originLabel)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", "", "", "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", "", "", "", "", "", err
	}
	if status != "BOOKED" {
		return "", "", "", "", "", "", &ParcelError{"BAD_INPUT", "Only a paid, booked parcel can be scheduled for collection"}
	}
	var collectorMsisdnPtr *string
	err = pool.QueryRow(ctx, `SELECT COALESCE("knownAs", "officialName"), msisdn FROM person WHERE "partyId" = $1`, collectorPartyID).
		Scan(&collectorName, &collectorMsisdnPtr)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", "", "", "", &ParcelError{"BAD_INPUT", "That collector was not found"}
	}
	if err != nil {
		return "", "", "", "", "", "", err
	}
	if collectorMsisdnPtr != nil {
		collectorMsisdn = *collectorMsisdnPtr
	}
	// Enforced here too, not just in the admin search that feeds this
	// call — a request that skips the search box and posts a partyId
	// directly must still land on a real, vetted courier (see
	// ParcelCourier's own comment on why "any Party" wasn't enough).
	if active, err := IsActiveCourier(ctx, pool, collectorPartyID); err != nil {
		return "", "", "", "", "", "", err
	} else if !active {
		return "", "", "", "", "", "", &ParcelError{"BAD_INPUT", "That person isn't an active courier"}
	}
	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET "assignedCollectorPartyId" = $1, "collectionScheduledAt" = $2, "collectionNote" = $3 WHERE id = $4`,
		collectorPartyID, scheduledAt, note, parcelID); err != nil {
		return "", "", "", "", "", "", err
	}
	return code, collectorName, collectorMsisdn, senderMsisdn, senderName, originLabel, nil
}

// CancelParcelResult tells the caller what still needs doing —
// composing the sender's SMS and, for an M-Pesa payment, flagging that
// a real refund (Safaricom B2C, not built here) is still owed are both
// handler-layer concerns, same split every other admin action in this
// file follows.
type CancelParcelResult struct {
	Code              string
	SenderMsisdn      string
	SenderName        string
	PriceKes          *string
	PaymentMethod     *string
	PointsRefunded    bool
	NeedsManualRefund bool // true only for a cancelled, M-Pesa-paid parcel
}

// CancelParcel — an admin stopping a parcel before it's physically in
// motion. Only DRAFT_PENDING_PAYMENT (never paid) and BOOKED (paid,
// not yet scanned into a courier's custody) are cancellable; once
// ScanHandoff has recorded a first pickup the parcel is somewhere on
// the road and cancelling it here would just be a lie the database
// tells while a courier is still holding a real box. A points payment
// is refunded automatically (the same safe ledger reversal
// loyalty.SpendFromParty's callers already use elsewhere); an M-Pesa
// payment is flagged for a manual refund — there's no Safaricom B2C
// integration in this codebase to reverse it automatically. Keyed by
// the parcel's UUID id, same convention AssignParcelCollector already
// uses for an admin-console action driven off the admin list's own
// row (which always has both id and code to hand, unlike the
// sender/receiver-facing endpoints, which only ever see the code).
func CancelParcel(ctx context.Context, pool *pgxpool.Pool, parcelID, cancelledByStaffID, reason string) (*CancelParcelResult, error) {
	if strings.TrimSpace(reason) == "" {
		return nil, &ParcelError{"BAD_INPUT", "A cancellation reason is required"}
	}
	var code, status, senderName, senderMsisdn string
	var priceKesText, paymentMethod *string
	var senderPartyID *string
	err := pool.QueryRow(ctx, `
		SELECT code, status::text, "senderName", "senderMsisdn", "priceKes"::text, "paymentMethod", "senderPartyId"
		FROM parcel WHERE id = $1`, parcelID).
		Scan(&code, &status, &senderName, &senderMsisdn, &priceKesText, &paymentMethod, &senderPartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return nil, err
	}
	if status != "DRAFT_PENDING_PAYMENT" && status != "BOOKED" {
		return nil, &ParcelError{"BAD_INPUT", "Only a draft or a paid, not-yet-picked-up parcel can be cancelled"}
	}

	result := &CancelParcelResult{Code: code, SenderMsisdn: senderMsisdn, SenderName: senderName, PriceKes: priceKesText, PaymentMethod: paymentMethod}

	// refundStatus mirrors the two branches below: an auto-reversed
	// points payment is REFUNDED immediately, an M-Pesa payment sits
	// PENDING until an admin closes it out via MarkParcelRefunded — see
	// that function's own comment on why there's no automatic reversal.
	refundStatus := "NOT_APPLICABLE"
	var refundedAt *time.Time
	if status == "BOOKED" && paymentMethod != nil {
		switch *paymentMethod {
		case "ESOKO_POINTS":
			if senderPartyID != nil && priceKesText != nil {
				priceKes, perr := strconv.ParseFloat(*priceKesText, 64)
				if perr != nil {
					return nil, perr
				}
				points := loyalty.PointsForKES(priceKes)
				if err := loyalty.RefundToParty(ctx, pool, *senderPartyID, points, "parcel-cancel:"+parcelID); err != nil {
					return nil, err
				}
				result.PointsRefunded = true
				refundStatus = "REFUNDED"
				now := time.Now()
				refundedAt = &now
			}
		case "MPESA_STK":
			result.NeedsManualRefund = true
			refundStatus = "PENDING"
		}
	}

	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET status = 'CANCELLED', "cancelledAt" = now(), "cancellationReason" = $1, "cancelledByStaffId" = $2,
		       "refundStatus" = $3, "refundedAt" = $4
		WHERE id = $5`, reason, cancelledByStaffID, refundStatus, refundedAt, parcelID); err != nil {
		return nil, err
	}
	return result, nil
}

// FlagParcelException — a staff member marking a live (PICKED_UP or
// IN_TRANSIT) parcel as needing attention. Distinct from CancelParcel:
// this doesn't stop the parcel, it's a "keep an eye on this one" note,
// same shape CollectionNote already is for a scheduled pickup — just
// surfaced with its own timestamp/pill instead of tucked into a detail
// view, since an exception is what the "Overdue deliveries" KPI and its
// alert banner exist to catch attention for.
func FlagParcelException(ctx context.Context, pool *pgxpool.Pool, parcelID, note, staffID string) error {
	if strings.TrimSpace(note) == "" {
		return &ParcelError{"BAD_INPUT", "An exception note is required"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET "exceptionNote" = $1, "exceptionFlaggedAt" = now(), "exceptionFlaggedByStaffId" = $2
		WHERE id = $3 AND status IN ('PICKED_UP', 'IN_TRANSIT')`, note, staffID, parcelID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"BAD_INPUT", "Only a parcel that's picked up or in transit can be flagged"}
	}
	return nil
}

// ClearParcelException — the other half of FlagParcelException's
// lifecycle: an admin marking whatever needed a second look as
// resolved. Only clears an actual flag (RowsAffected guards against
// "nothing to clear" reading as success).
func ClearParcelException(ctx context.Context, pool *pgxpool.Pool, parcelID string) error {
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET "exceptionNote" = NULL, "exceptionFlaggedAt" = NULL, "exceptionFlaggedByStaffId" = NULL
		WHERE id = $1 AND "exceptionNote" IS NOT NULL`, parcelID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"BAD_INPUT", "This parcel has no exception flagged"}
	}
	return nil
}

// UpdateParcelDetails — an admin correcting receiver contact info, the
// destination label, or notes. Same "only before the first pickup"
// boundary CancelParcel already draws (see that function's own
// comment): once ScanHandoff has recorded a courier taking custody,
// the label on the physical box is already set — changing what's on
// file here wouldn't change what's written on the parcel itself. Origin/
// sender aren't editable here on purpose — that's the account that
// booked and is paying for it, not a detail an operator should be able
// to silently swap.
func UpdateParcelDetails(ctx context.Context, pool *pgxpool.Pool, parcelID, receiverName, receiverMsisdn, destinationLabel string, notes *string) error {
	if strings.TrimSpace(receiverName) == "" || strings.TrimSpace(receiverMsisdn) == "" || strings.TrimSpace(destinationLabel) == "" {
		return &ParcelError{"BAD_INPUT", "Receiver name, phone and destination are required"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET "receiverName" = $1, "receiverMsisdn" = $2, "destinationLabel" = $3, notes = $4
		WHERE id = $5 AND status IN ('DRAFT_PENDING_PAYMENT', 'BOOKED')`,
		receiverName, receiverMsisdn, destinationLabel, notes, parcelID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"BAD_INPUT", "Only a draft or paid, not-yet-picked-up parcel can be edited"}
	}
	return nil
}

// ── Receiver receipt confirmation (guest-safe, OTP-gated) ──

// maskMsisdn — "+254712345678" → "+254 71•• •••78", enough for a
// receiver to recognize their own number without this endpoint ever
// handing the full number back to whoever's holding the code.
func maskMsisdn(msisdn string) string {
	if len(msisdn) < 6 {
		return "••••••"
	}
	keepStart := 6
	keepEnd := 2
	if keepStart+keepEnd >= len(msisdn) {
		return msisdn
	}
	masked := msisdn[:keepStart]
	for range msisdn[keepStart : len(msisdn)-keepEnd] {
		masked += "•"
	}
	return masked + msisdn[len(msisdn)-keepEnd:]
}

// RequestParcelReceiptOtp — sends a code to the parcel's own registered
// receiverMsisdn (never a client-supplied number, so nobody can point
// this endpoint's OTPs at an arbitrary phone by knowing/guessing a
// code), gated on the parcel actually being DELIVERED and not already
// confirmed. Returns a masked form of the number for the UI to show
// ("we're texting 07•• •••78") — the caller never learns the full
// number from this endpoint.
func RequestParcelReceiptOtp(ctx context.Context, pool *pgxpool.Pool, otp *authsvc.OtpService, code, ip string) (maskedMsisdn string, err error) {
	var status, receiverMsisdn string
	var receiptConfirmedAt *time.Time
	err = pool.QueryRow(ctx, `
		SELECT status::text, "receiverMsisdn", "receiptConfirmedAt" FROM parcel WHERE code = $1`, code).
		Scan(&status, &receiverMsisdn, &receiptConfirmedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", err
	}
	if status != "DELIVERED" {
		return "", &ParcelError{"BAD_INPUT", "This parcel hasn't been marked delivered yet"}
	}
	if receiptConfirmedAt != nil {
		return "", &ParcelError{"ALREADY_DELIVERED", "Receipt for this parcel has already been confirmed"}
	}
	if _, err := otp.IssueOtp(ctx, receiverMsisdn, authsvc.OtpParcelReceipt, ip); err != nil {
		return "", err
	}
	return maskMsisdn(receiverMsisdn), nil
}

// ConfirmParcelReceipt — the receiver proving control of the number
// already on the parcel, then rating the condition it arrived in.
// Re-checks the same DELIVERED/not-already-confirmed guard
// RequestParcelReceiptOtp does, since these are two separate requests
// with no session tying them together.
func ConfirmParcelReceipt(ctx context.Context, pool *pgxpool.Pool, otp *authsvc.OtpService, code, otpCode string, rating int, feedback *string) (senderMsisdn, senderName, receiverName string, err error) {
	if rating < 1 || rating > 5 {
		return "", "", "", &ParcelError{"BAD_INPUT", "Rate the condition it arrived in from 1 to 5"}
	}
	var parcelID, status, receiverMsisdn string
	var receiptConfirmedAt *time.Time
	err = pool.QueryRow(ctx, `
		SELECT id, status::text, "receiverMsisdn", "senderMsisdn", "senderName", "receiverName", "receiptConfirmedAt"
		FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &status, &receiverMsisdn, &senderMsisdn, &senderName, &receiverName, &receiptConfirmedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", "", "", err
	}
	if status != "DELIVERED" {
		return "", "", "", &ParcelError{"BAD_INPUT", "This parcel hasn't been marked delivered yet"}
	}
	if receiptConfirmedAt != nil {
		return "", "", "", &ParcelError{"ALREADY_DELIVERED", "Receipt for this parcel has already been confirmed"}
	}
	ok, verr := otp.VerifyOtp(ctx, receiverMsisdn, authsvc.OtpParcelReceipt, otpCode)
	if verr != nil {
		return "", "", "", verr
	}
	if !ok {
		return "", "", "", &ParcelError{"WRONG_CODE", "That code is not right"}
	}
	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET "receiptConfirmedAt" = now(), "receiptConditionRating" = $1, "receiptFeedback" = $2
		WHERE id = $3`, rating, feedback, parcelID); err != nil {
		return "", "", "", err
	}
	return senderMsisdn, senderName, receiverName, nil
}

// ── Stale draft sweep ──

// SweepStaleParcelDrafts — an unpaid DRAFT_PENDING_PAYMENT booking
// abandoned over 24h ago is never coming back; cancel it so it stops
// cluttering "all statuses" admin views and GetAdminParcelStats.StaleDrafts
// forever. No refund logic (nothing was ever paid) and no SMS (nobody
// claimed it — a guest-entered phone number here may not even be the
// real sender). Meant to run from a periodic sweep (see
// cmd/api/main.go's ticker), same shape SweepDueWithdrawals follows.
func SweepStaleParcelDrafts(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET status = 'CANCELLED', "cancelledAt" = now(),
		       "cancellationReason" = 'Abandoned — payment never completed'
		WHERE status = 'DRAFT_PENDING_PAYMENT' AND "createdAt" < now() - interval '24 hours'`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ── Chain of custody ──

// HandoffRow — one custody transfer, names resolved for display.
// FromName is nil on the very first pickup (meaning "from the sender").
type HandoffRow struct {
	FromName  *string
	ToName    string
	CreatedAt time.Time
}

// ListParcelHandoffs — the append-only parcel_handoff log, finally
// read back: who held this and when, oldest first. Used by both the
// admin console (any parcel) and the sender's own authenticated status
// view (see handleListParcelHandoffs's ownership check).
func ListParcelHandoffs(ctx context.Context, pool *pgxpool.Pool, parcelID string) ([]HandoffRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT COALESCE(fromP."knownAs", fromP."officialName"),
		       COALESCE(toP."knownAs", toP."officialName", 'Unknown'),
		       h."createdAt"
		FROM parcel_handoff h
		LEFT JOIN person fromP ON fromP."partyId" = h."fromPartyId"
		LEFT JOIN person toP ON toP."partyId" = h."toPartyId"
		WHERE h."parcelId" = $1
		ORDER BY h."createdAt" ASC`, parcelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HandoffRow
	for rows.Next() {
		var r HandoffRow
		if err := rows.Scan(&r.FromName, &r.ToName, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetParcelSenderPartyID — the small lookup handleListParcelHandoffs
// needs to check the caller actually owns this parcel before handing
// back its custody chain.
func GetParcelSenderPartyID(ctx context.Context, pool *pgxpool.Pool, code string) (parcelID string, senderPartyID *string, err error) {
	err = pool.QueryRow(ctx, `SELECT id, "senderPartyId" FROM parcel WHERE code = $1`, code).Scan(&parcelID, &senderPartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	return parcelID, senderPartyID, err
}

// MarkParcelRefunded — an admin closing out a cancelled parcel's
// PENDING M-Pesa refund once they've actually processed it out of
// band (there's no Safaricom B2C integration here to do it
// automatically). Only valid from PENDING — a NOT_APPLICABLE or already
// REFUNDED parcel has nothing to close out.
func MarkParcelRefunded(ctx context.Context, pool *pgxpool.Pool, parcelID, staffID string) (code, senderMsisdn, senderName string, priceKes *string, err error) {
	var refundStatus string
	err = pool.QueryRow(ctx, `SELECT code, "senderMsisdn", "senderName", "refundStatus", "priceKes"::text FROM parcel WHERE id = $1`, parcelID).
		Scan(&code, &senderMsisdn, &senderName, &refundStatus, &priceKes)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", nil, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", "", "", nil, err
	}
	if refundStatus != "PENDING" {
		return "", "", "", nil, &ParcelError{"BAD_INPUT", "This parcel has no refund pending"}
	}
	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET "refundStatus" = 'REFUNDED', "refundedAt" = now(), "refundedByStaffId" = $1 WHERE id = $2`,
		staffID, parcelID); err != nil {
		return "", "", "", nil, err
	}
	return code, senderMsisdn, senderName, priceKes, nil
}
