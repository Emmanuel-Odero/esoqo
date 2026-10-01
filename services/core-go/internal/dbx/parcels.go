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
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/fleetqr"
	"github.com/esoqo/core-go/internal/ledger"
	"github.com/esoqo/core-go/internal/loyalty"
	"github.com/esoqo/core-go/internal/money"
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

	// LengthCm/WidthCm/HeightCm — measured at intake, for the volumetric
	// weight a bulky parcel is charged on (see VolumetricKg). All three
	// or none; a partial measurement is not a volume.
	LengthCm *float64
	WidthCm  *float64
	HeightCm *float64
	// ContentsDeclaredByStaffID — the clerk who asked the sender about
	// prohibited contents and got a no. Nil means nobody asked, which is
	// every booking made away from a counter.
	ContentsDeclaredByStaffID *string

	// BinderOrgID — the courier company whose staff session is making
	// this booking, or nil for a guest or an ordinary customer.
	//
	// Deliberately NOT ParcelOrgID below. That field is the company the
	// *sender chose* to carry the parcel: it arrives in the request
	// body on a public endpoint, so anyone can put anything in it, and
	// it cannot gate anything. This one is read from the session and is
	// therefore the only trustworthy answer to "who is binding this
	// label", which is the question owned stock has to be checked
	// against. See the ExistingCode path below.
	BinderOrgID *string
	// BinderIsPlatformStaff — an Esoqo operator acting on any company's
	// behalf, which is the one legitimate way to bind another org's
	// stock (recovering a pad from a company that has folded, say).
	BinderIsPlatformStaff bool

	// DestinationAgentID — the pickup point the receiver will collect
	// from, when the sender chose the cheap agent leg over a doorstep
	// delivery (see parcel_agents.go). Optional; nil means doorstep,
	// which stays the default.
	DestinationAgentID *string

	// DeclaredValueKes/CoverageTierID — what the sender says the
	// contents are worth and the cover they bought against it. Both or
	// neither: a tier with no declared value can't be priced, and a
	// declared value with no tier buys nothing. The fee is computed
	// here and frozen onto the row, never recomputed later — an admin
	// re-pricing a tier next month must not change what an in-flight
	// parcel was charged or what it's owed on a claim.
	DeclaredValueKes *float64
	CoverageTierID   *string

	// OriginLat/Lng, DestinationLat/Lng — a real dropped pin for either
	// end, when the sender gave one. Independent of the zone ids above
	// (a pricing coordinate); this is where the parcel is actually
	// going. See Parcel.originLat's own comment on why both exist.
	OriginLat      *float64
	OriginLng      *float64
	DestinationLat *float64
	DestinationLng *float64

	// ParcelOrgID — the courier company carrying this parcel, or nil for
	// Esoqo-operated dispatch (the default, and every parcel booked
	// before tenancy existed). Decides which rate card applies, and is
	// frozen onto the row: the revenue split computed at payment time
	// has to belong to whoever was carrying it when it was priced.
	ParcelOrgID *string

	// OriginMethod — see Parcel.originMethod's own schema comment.
	// Empty defaults to SCHEDULED_PICKUP at the SQL layer (the column's
	// own DEFAULT), same "zero value is the safe historical answer"
	// convention the rest of this struct's optional fields already
	// follow.
	OriginMethod string

	// PayAtCounter — no price is quoted or collected online for this
	// parcel, and it lands straight in BOOKED with paymentMethod
	// "PAY_AT_COUNTER" instead of the usual DRAFT_PENDING_PAYMENT ->
	// SetParcelPrice -> Pay sequence. priceKes stays NULL (nobody has
	// weighed or priced it yet — that happens physically, in person) and
	// no revenue split is computed. Valid for either OriginMethod: a
	// walk-in drop-off settles at the station's own counter, a scheduled
	// pickup settles with the courier who collects it — this flag just
	// means "not online", not "specifically at a desk".
	PayAtCounter bool

	// The sender's own declaration — see Parcel.senderDeclaredContents
	// and the bookParcelRequest field comments for why these are a
	// separate, weaker fact from ContentsDeclaredByStaffID above rather
	// than a widening of it.
	//
	// The two booleans become timestamps in SQL. They arrive as booleans
	// because that is genuinely all the client knows ("the box was
	// ticked"); the *when* is the server's to say, for the same reason
	// no other timestamp in this struct is client-supplied.
	SenderDeclaredContents *string
	LawfulContentsAttested bool
	TermsAccepted          bool
	TermsVersion           *string
	CarrierTermsVersion    *string
}

// isForeignLabelCode reports whether code was printed outside Esoqo.
// Only PKG-… codes are ever minted here (fleetqr.PrefixParcel); a
// company self-print (own serials, barcodes from another system) never
// carries that prefix. Used to reject retired company prints with a
// FOREIGN_LABEL error the UI can explain, instead of a bare NOT_FOUND.
func isForeignLabelCode(code string) bool {
	upper := strings.ToUpper(strings.TrimSpace(code))
	return !strings.HasPrefix(upper, "PKG-")
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
func BookParcel(ctx context.Context, pool *pgxpool.Pool, in BookParcelInput) (parcelID, code, deliveryCode, serviceTicketNumber string, err error) {
	if in.SenderName == "" || in.SenderMsisdn == "" {
		return "", "", "", "", &ParcelError{"BAD_INPUT", "Sender name and phone are required"}
	}
	if in.ReceiverName == "" || in.ReceiverMsisdn == "" {
		return "", "", "", "", &ParcelError{"BAD_INPUT", "Receiver name and phone are required"}
	}
	if in.OriginLabel == "" || in.DestinationLabel == "" {
		return "", "", "", "", &ParcelError{"BAD_INPUT", "Origin and destination are required"}
	}
	if !isValidParcelType(in.ParcelType) {
		return "", "", "", "", &ParcelError{"BAD_INPUT", "Choose a valid parcel type"}
	}
	pricing, err := GetParcelPricing(ctx, pool, in.ParcelType, in.ParcelOrgID)
	if err != nil {
		return "", "", "", "", err
	}
	if pricing == nil {
		return "", "", "", "", &ParcelError{"BAD_INPUT", "That parcel type is not priced yet — ask an admin to set it up"}
	}
	// Cover is priced once, here, and written onto the row — see
	// BookParcelInput.CoverageTierID's own comment on why it's frozen
	// rather than derived on read.
	var coverageFeeKes *float64
	if in.CoverageTierID != nil && *in.CoverageTierID != "" {
		if in.DeclaredValueKes == nil || *in.DeclaredValueKes <= 0 {
			return "", "", "", "", &ParcelError{"BAD_INPUT", "Say what the contents are worth to add cover"}
		}
		tier, terr := GetCoverageTier(ctx, pool, *in.CoverageTierID)
		if terr != nil {
			return "", "", "", "", terr
		}
		if tier == nil || !tier.Active {
			return "", "", "", "", &ParcelError{"BAD_INPUT", "That cover level isn't available"}
		}
		// This is the number frozen onto the parcel, and it must equal what
		// the quote endpoint showed the sender — same method, same cents,
		// no second derivation.
		fee := tier.CoverageFee(money.FromKES(*in.DeclaredValueKes)).KES()
		coverageFeeKes = &fee
	}
	originMethod := in.OriginMethod
	if originMethod == "" {
		originMethod = "SCHEDULED_PICKUP"
	}
	if originMethod != "SCHEDULED_PICKUP" && originMethod != "SELF_DROPOFF" {
		return "", "", "", "", &ParcelError{"BAD_INPUT", "Unknown origin method"}
	}
	// A self-drop-off has to name a real, walk-in-capable station —
	// otherwise a front desk somewhere would be expecting a walk-in
	// nobody told them about, or a company that never agreed to run one
	// at all. Same "refused at booking, not discovered later" rule the
	// destination agent check just below already follows.
	if originMethod == "SELF_DROPOFF" {
		if in.ParcelOrgID == nil || *in.ParcelOrgID == "" {
			return "", "", "", "", &ParcelError{"BAD_INPUT", "Choose which station you're dropping this off at"}
		}
		org, oerr := GetParcelOrg(ctx, pool, *in.ParcelOrgID)
		if oerr != nil {
			return "", "", "", "", oerr
		}
		if org == nil || org.Status != ParcelOrgActive || !org.AcceptsWalkIn {
			return "", "", "", "", &ParcelError{"BAD_INPUT", "That station isn't taking walk-in drop-offs"}
		}
	}
	// A pickup point that's full or switched off is refused at booking
	// rather than discovered by a courier standing in the shop.
	if in.DestinationAgentID != nil && *in.DestinationAgentID != "" {
		agent, aerr := GetParcelAgent(ctx, pool, *in.DestinationAgentID)
		if aerr != nil {
			return "", "", "", "", aerr
		}
		if agent == nil || !agent.Active {
			return "", "", "", "", &ParcelError{"BAD_INPUT", "That pickup point isn't available"}
		}
		if agent.ParcelsHeld >= agent.Capacity {
			return "", "", "", "", &ParcelError{"BAD_INPUT", "That pickup point is full — pick another one"}
		}
	}

	deliveryCode, err = generateDeliveryCode()
	if err != nil {
		return "", "", "", "", err
	}
	// serviceTicketNumber — minted unconditionally, on every booking
	// path (fresh code or a pre-printed label). See its own schema
	// comment: this, not the real tracking code, is what a self-service
	// booking's response actually carries. Checksummed like every other
	// short code someone might type back in at a counter.
	serviceTicketNumber = fleetqr.ShortCodeChecked(fleetqr.PrefixServiceTicket, 6)

	insertParcel := func(useCode string) error {
		// PayAtCounter skips the whole DRAFT_PENDING_PAYMENT -> price ->
		// pay sequence and lands directly in BOOKED, same slaDeadlineAt
		// formula PayParcelWithPoints uses at its own payment-confirmation
		// moment — a parcel settled in person still deserves an SLA clock,
		// it just starts at booking instead of at payment because there
		// is no separate payment step to start it from.
		status := "DRAFT_PENDING_PAYMENT"
		var paymentMethod *string
		if in.PayAtCounter {
			status = "BOOKED"
			m := "PAY_AT_COUNTER"
			paymentMethod = &m
		}
		return pool.QueryRow(ctx, `
			INSERT INTO parcel (
				id, code, "deliveryCode", "senderPartyId", "senderName", "senderMsisdn",
				"receiverName", "receiverMsisdn", "originLabel", "destinationLabel", notes,
				"parcelType", "weightKg", fragile, "transportMode", "originZoneId", "destinationZoneId",
				"destinationAgentId", "declaredValueKes", "coverageTierId", "coverageFeeKes",
				"parcelOrgId", "originLat", "originLng", "destinationLat", "destinationLng",
				"lengthCm", "widthCm", "heightCm",
				"contentsDeclaredAt", "contentsDeclaredByStaffId",
				"originMethod", "paymentMethod", "slaDeadlineAt",
				status, "createdAt", "serviceTicketNumber",
				"senderDeclaredContents", "lawfulContentsAttestedAt",
				"termsAcceptedAt", "termsVersion", "carrierTermsVersion"
			) VALUES (
				gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
				$11::"ParcelType", $12, $13, $14::"ParcelTransportMode", $15, $16,
				$17, $18, $19, $20, $21, $22, $23, $24, $25,
				$26, $27, $28,
				-- Stamped together: the timestamp is only meaningful
				-- alongside the person who asked.
				CASE WHEN $29::uuid IS NULL THEN NULL ELSE now() END, $29::uuid,
				$30::"ParcelOriginMethod", $31,
				CASE WHEN $32::text != 'BOOKED' THEN NULL ELSE now() + (
					SELECT r."slaHours" FROM parcel_pricing_rule r
					WHERE r."parcelType" = $11::"ParcelType"
					  AND (r."parcelOrgId" IS NULL OR r."parcelOrgId" = $21::uuid)
					ORDER BY r."parcelOrgId" NULLS LAST
					LIMIT 1
				) * interval '1 hour' END,
				$32::"ParcelStatus", now(), $33,
				-- The booleans become timestamps here rather than in Go,
				-- so the recorded moment is the same now() the row itself
				-- is stamped with. A version is only kept alongside an
				-- acceptance: "v3" with no termsAcceptedAt would claim an
				-- agreement nobody made.
				$34,
				CASE WHEN $35::boolean THEN now() ELSE NULL END,
				CASE WHEN $36::boolean THEN now() ELSE NULL END,
				CASE WHEN $36::boolean THEN $37 ELSE NULL END,
				CASE WHEN $36::boolean THEN $38 ELSE NULL END
			) RETURNING id`,
			useCode, deliveryCode, in.SenderPartyID, in.SenderName, in.SenderMsisdn,
			in.ReceiverName, in.ReceiverMsisdn, in.OriginLabel, in.DestinationLabel, in.Notes,
			in.ParcelType, in.WeightKg, in.Fragile, pricing.SuggestedTransportMode,
			in.OriginZoneID, in.DestinationZoneID,
			in.DestinationAgentID, in.DeclaredValueKes, in.CoverageTierID, coverageFeeKes,
			in.ParcelOrgID,
			in.OriginLat, in.OriginLng, in.DestinationLat, in.DestinationLng,
			in.LengthCm, in.WidthCm, in.HeightCm, in.ContentsDeclaredByStaffID,
			originMethod, paymentMethod, status, serviceTicketNumber,
			in.SenderDeclaredContents, in.LawfulContentsAttested,
			in.TermsAccepted, in.TermsVersion, in.CarrierTermsVersion).
			Scan(&parcelID)
	}

	if in.ExistingCode != nil && *in.ExistingCode != "" {
		// A pre-printed label being filled in — see ParcelLabelStock's
		// own comment. Claiming the stock row and inserting the parcel
		// happen in one transaction so two staff scanning the same
		// physical label at once can't both win it.
		code = *in.ExistingCode
		// Strict PKG-only: labels a company printed itself (its own
		// serials, never minted here) are retired — they have no stock
		// row and no signature, so they can never verify. Reject with a
		// code the UI can explain, not a bare NOT_FOUND: the desk's next
		// step is to re-print on Esoqo stock and keep their number as
		// the parcel's external reference.
		if isForeignLabelCode(code) {
			return "", "", "", "", &ParcelError{"FOREIGN_LABEL", "That looks like a label printed outside Esoqo (" + strings.ToUpper(strings.TrimSpace(code)) + "). Only Esoqo PKG-… labels scan now — re-print on Esoqo stock and keep your number as the external reference"}
		}
		tx, terr := pool.Begin(ctx)
		if terr != nil {
			return "", "", "", "", terr
		}
		defer func() { _ = tx.Rollback(ctx) }()
		var stockID string
		var stockOrgID *string
		var voidedAt *time.Time
		var voidedReason *string
		lockErr := tx.QueryRow(ctx, `
			SELECT id, "parcelOrgId"::text, "voidedAt", "voidedReason"
			FROM parcel_label_stock WHERE code = $1 AND "usedAt" IS NULL FOR UPDATE`,
			code).Scan(&stockID, &stockOrgID, &voidedAt, &voidedReason)
		if errors.Is(lockErr, pgx.ErrNoRows) {
			// LABEL_ALREADY_SPENT, not BAD_INPUT, because one caller
			// treats this as success: the offline counter queue replays a
			// booking it never saw the reply for, and "that label is no
			// longer unused" is how it learns the parcel already exists
			// (see packages/ui/src/parcelOfflineQueue.ts). That client
			// used to regex this sentence — a copy-edit here silently
			// broke its dedupe and stranded a queued parcel that had in
			// fact shipped. The code is the contract now; the prose is
			// free to change.
			return "", "", "", "", &ParcelError{"LABEL_ALREADY_SPENT", "That label code isn't a known, unused pre-printed label"}
		}
		if lockErr != nil {
			return "", "", "", "", lockErr
		}
		// A withdrawn pad. Checked inside the lock alongside everything
		// else, so voiding a batch while somebody is mid-booking races
		// cleanly rather than letting a recalled label through.
		if voidedAt != nil {
			msg := "That label has been withdrawn and can't be used"
			if voidedReason != nil && *voidedReason != "" {
				msg += " — " + *voidedReason
			}
			return "", "", "", "", &ParcelError{"BAD_INPUT", msg}
		}
		// The induction check: a pad issued to a company is spendable
		// only by that company. This is the moment the physical label
		// meets the system, and it is the only moment the check can be
		// made — printing is not a commitment, and nothing before this
		// point knows who is holding the sticker.
		//
		// Stock with no owner is the shared Esoqo pool and stays
		// bindable by anyone, which is every label minted to date.
		if stockOrgID != nil && !in.BinderIsPlatformStaff {
			if in.BinderOrgID == nil || *in.BinderOrgID != *stockOrgID {
				// Deliberately doesn't name the owning company. Whoever is
				// holding this sticker isn't entitled to learn which of our
				// partners it was printed for.
				return "", "", "", "", &ParcelError{"FORBIDDEN", "That label was issued to another company — use one of your own"}
			}
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO parcel (
				id, code, "deliveryCode", "senderPartyId", "senderName", "senderMsisdn",
				"receiverName", "receiverMsisdn", "originLabel", "destinationLabel", notes,
				"parcelType", "weightKg", fragile, "transportMode", "originZoneId", "destinationZoneId",
				"destinationAgentId", "declaredValueKes", "coverageTierId", "coverageFeeKes",
				"parcelOrgId", "originLat", "originLng", "destinationLat", "destinationLng",
				"lengthCm", "widthCm", "heightCm",
				"contentsDeclaredAt", "contentsDeclaredByStaffId",
				status, "createdAt", "serviceTicketNumber"
			) VALUES (
				gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
				$11::"ParcelType", $12, $13, $14::"ParcelTransportMode", $15, $16,
				$17, $18, $19, $20, $21, $22, $23, $24, $25,
				$26, $27, $28,
				-- Stamped together: the timestamp is only meaningful
				-- alongside the person who asked.
				CASE WHEN $29::uuid IS NULL THEN NULL ELSE now() END, $29::uuid,
				'DRAFT_PENDING_PAYMENT', now(), $30
			) RETURNING id`,
			code, deliveryCode, in.SenderPartyID, in.SenderName, in.SenderMsisdn,
			in.ReceiverName, in.ReceiverMsisdn, in.OriginLabel, in.DestinationLabel, in.Notes,
			in.ParcelType, in.WeightKg, in.Fragile, pricing.SuggestedTransportMode,
			in.OriginZoneID, in.DestinationZoneID,
			in.DestinationAgentID, in.DeclaredValueKes, in.CoverageTierID, coverageFeeKes,
			in.ParcelOrgID,
			in.OriginLat, in.OriginLng, in.DestinationLat, in.DestinationLng,
			in.LengthCm, in.WidthCm, in.HeightCm, in.ContentsDeclaredByStaffID,
			serviceTicketNumber).
			Scan(&parcelID); err != nil {
			return "", "", "", "", err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE parcel_label_stock SET "usedAt" = now(), "usedByParcelId" = $1 WHERE id = $2`,
			parcelID, stockID); err != nil {
			return "", "", "", "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", "", "", "", err
		}
		return parcelID, code, deliveryCode, serviceTicketNumber, nil
	}

	err = retryUnique(func() error {
		code = fleetqr.ShortCodeChecked(fleetqr.PrefixParcel, 6)
		// Regenerated on every retry, not just `code` — a collision on
		// either @unique column fails the same INSERT, and holding onto
		// a stale ticket number across retries would just collide again.
		serviceTicketNumber = fleetqr.ShortCodeChecked(fleetqr.PrefixServiceTicket, 6)
		return insertParcel(code)
	})
	return parcelID, code, deliveryCode, serviceTicketNumber, err
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
	MinKes                 money.Amount    `json:"minKes"`
	MaxKes                 money.Amount    `json:"maxKes"`
	BargainMinPct          float64         `json:"bargainMinPct"`
	BargainMaxPct          float64         `json:"bargainMaxPct"`
	BargainReasons         []BargainReason `json:"bargainReasons"`
	SuggestedTransportMode string          `json:"suggestedTransportMode"`
	AgentDropDiscountPct   float64         `json:"agentDropDiscountPct"`
}

const parcelPricingColumns = `
	"parcelType"::text, "weightLabel", "minWeightKg"::text, "maxWeightKg"::text,
	"minKes"::text, "maxKes"::text, "bargainMinPct"::text, "bargainMaxPct"::text,
	"bargainReasons", "suggestedTransportMode"::text, "agentDropDiscountPct"::text`

// scanParcelPricing reads one parcelPricingColumns row — shared by
// GetParcelPricing (one type) and ListParcelPricing (every type, for
// the mobile booking form's weight-to-bracket matching).
func scanParcelPricing(row pgx.Row) (*ParcelPricing, error) {
	var p ParcelPricing
	var minWeightText, maxWeightText, minText, maxText, bargainMinText, bargainMaxText, agentDiscountText string
	var reasonsRaw []byte
	err := row.Scan(&p.ParcelType, &p.WeightLabel, &minWeightText, &maxWeightText,
		&minText, &maxText, &bargainMinText, &bargainMaxText, &reasonsRaw, &p.SuggestedTransportMode,
		&agentDiscountText)
	if err != nil {
		return nil, err
	}
	for _, f := range []struct {
		text string
		dst  *float64
	}{
		{minWeightText, &p.MinWeightKg}, {maxWeightText, &p.MaxWeightKg},
		{bargainMinText, &p.BargainMinPct}, {bargainMaxText, &p.BargainMaxPct},
		{agentDiscountText, &p.AgentDropDiscountPct},
	} {
		if *f.dst, err = strconv.ParseFloat(f.text, 64); err != nil {
			return nil, err
		}
	}
	// The money fields are parsed exactly rather than through
	// ParseFloat — they are the price band a sender is quoted against.
	p.MinKes = money.AmountOf(money.MustParseKES(minText))
	p.MaxKes = money.AmountOf(money.MustParseKES(maxText))
	if err := json.Unmarshal(reasonsRaw, &p.BargainReasons); err != nil {
		return nil, err
	}
	return &p, nil
}

// GetParcelPricing resolves one bracket, preferring [orgID]'s own rate
// over the platform default.
//
// `ORDER BY "parcelOrgId" NULLS LAST LIMIT 1` is the whole fallback: a
// company that set its own price for this type gets its row, one that
// didn't gets the platform row, and a company only has to override the
// brackets it actually prices differently rather than restate all five.
// orgID nil (Esoqo-operated dispatch) matches the platform row alone.
func GetParcelPricing(ctx context.Context, pool *pgxpool.Pool, parcelType string, orgID *string) (*ParcelPricing, error) {
	row := pool.QueryRow(ctx, `SELECT `+parcelPricingColumns+`
		FROM parcel_pricing_rule
		WHERE "parcelType" = $1::"ParcelType"
		  AND ("parcelOrgId" IS NULL OR "parcelOrgId" = $2::uuid)
		ORDER BY "parcelOrgId" NULLS LAST
		LIMIT 1`, parcelType, orgID)
	p, err := scanParcelPricing(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return p, err
}

// How far a company's own rate may sit from the platform card it forks
// from — half the platform floor at the low end, double the platform
// ceiling at the high end.
const (
	orgPriceFloorFactor   = 0.5
	orgPriceCeilingFactor = 2.0
)

// OrgPriceBounds — the range a courier company's own rate for a bracket
// must land inside, given the platform card's band for that bracket.
//
// Bounds exist because "a company sets its own price" and "a company
// sets any price at all" are different products. The only check here
// used to be minKes > 0, so a company could quote KES 1 or KES 1,000,000
// for an envelope and GetParcelPricing would serve that straight to a
// sender as the quote. On a marketplace where Esoqo takes a percentage
// of the fare, letting the counterparty set the base unilaterally and
// without limit is a structural hole, not a missing validation.
//
// The band is deliberately wide: this is a guardrail against
// fat-fingers and abuse, not a pricing committee. A company that
// genuinely needs to sit outside it is having a commercial
// conversation, which is what a platform-card change is for.
//
// Pure so it's directly testable without a DB fixture, same pattern
// nextHandoffStatus and SplitParcelRevenue already use.
func OrgPriceBounds(platformMin, platformMax money.Cents) (floor, ceiling money.Cents) {
	return platformMin.Scale(orgPriceFloorFactor), platformMax.Scale(orgPriceCeilingFactor)
}

// UpsertOrgParcelPricingRule — a courier company setting its own price
// for one parcel type, the self-service counterpart to admin's
// Prisma-backed platform-card editor (see this file's own "sole writer"
// comment on ParcelPricing — that's true for the platform card;
// company-owned rows are a second, cleanly partitioned writer, the same
// shape ParcelOrgStaff already has between handleAdminUpsertParcelOrgStaff
// and handleUpsertMyOrgStaff).
//
// Deliberately narrow: a company sets minKes/maxKes only. Everything
// else on the row (weight bracket, bargain range, suggested transport
// mode, agent discount, SLA) is copied in from the current platform
// default at save time, not left editable — those describe the bracket
// itself, which has to mean the same weight range for every company, not
// something each one can quietly redefine. The tradeoff this accepts:
// if admin changes those platform fields later, a company's existing
// override only picks up the change the next time it saves its own
// price, not immediately — the same staleness any org-specific row
// already has against the platform card it forked from.
func UpsertOrgParcelPricingRule(ctx context.Context, pool *pgxpool.Pool, orgID, parcelType string, minKes, maxKes float64) error {
	if minKes <= 0 || maxKes < minKes {
		return &ParcelError{"BAD_INPUT", "minKes must be positive and maxKes must be at least minKes"}
	}
	platform, err := GetParcelPricing(ctx, pool, parcelType, nil)
	if err != nil {
		return err
	}
	if platform == nil {
		return &ParcelError{"BAD_INPUT", "That parcel type is not priced on the platform yet — ask Esoqo to set it up first"}
	}

	floor, ceiling := OrgPriceBounds(platform.MinKes.Cents(), platform.MaxKes.Cents())
	if money.FromKES(minKes) < floor || money.FromKES(maxKes) > ceiling {
		return &ParcelError{"BAD_INPUT", fmt.Sprintf(
			"Your price for this parcel type has to sit between KES %.0f and KES %.0f",
			money.AmountOf(floor).KES(), money.AmountOf(ceiling).KES())}
	}
	reasonsJSON, err := json.Marshal(platform.BargainReasons)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO parcel_pricing_rule (
			id, "parcelOrgId", "parcelType", "weightLabel", "minWeightKg", "maxWeightKg",
			"minKes", "maxKes", "bargainMinPct", "bargainMaxPct", "bargainReasons",
			"suggestedTransportMode", "agentDropDiscountPct", "updatedAt"
		) VALUES (
			gen_random_uuid(), $1, $2::"ParcelType", $3, $4, $5,
			$6, $7, $8, $9, $10::jsonb,
			$11::"ParcelTransportMode", $12, now()
		)
		ON CONFLICT ("parcelOrgId", "parcelType") DO UPDATE SET
			"weightLabel" = $3, "minWeightKg" = $4, "maxWeightKg" = $5,
			"minKes" = $6, "maxKes" = $7, "bargainMinPct" = $8, "bargainMaxPct" = $9,
			"bargainReasons" = $10::jsonb, "suggestedTransportMode" = $11::"ParcelTransportMode",
			"agentDropDiscountPct" = $12, "updatedAt" = now()`,
		orgID, parcelType, platform.WeightLabel, platform.MinWeightKg, platform.MaxWeightKg,
		minKes, maxKes, platform.BargainMinPct, platform.BargainMaxPct, reasonsJSON,
		platform.SuggestedTransportMode, platform.AgentDropDiscountPct)
	return err
}

// ListParcelPricing — every parcel type's pricing, lightest first, so
// the booking forms can show each option's own weight/price range up
// front and match an entered weight to a bracket without a round trip
// per keystroke. Same per-org override and platform fallback
// GetParcelPricing documents, applied once per type via DISTINCT ON.
func ListParcelPricing(ctx context.Context, pool *pgxpool.Pool, orgID *string) ([]ParcelPricing, error) {
	rows, err := pool.Query(ctx, `
		SELECT `+parcelPricingColumns+` FROM (
			SELECT DISTINCT ON ("parcelType") *
			FROM parcel_pricing_rule
			WHERE "parcelOrgId" IS NULL OR "parcelOrgId" = $1::uuid
			ORDER BY "parcelType", "parcelOrgId" NULLS LAST
		) resolved
		ORDER BY "minWeightKg" ASC`, orgID)
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

// priceTolerance was 0.5 KES, and its reason was float round-tripping
// through Decimal↔text↔float64: a client sending back exactly the
// number this endpoint quoted it must never bounce on a cent of drift.
//
// The band is now exact cents on both sides of that round trip, so the
// drift it absorbed cannot occur. It is kept at one cent rather than
// removed outright because a client may legitimately round its own
// display before sending — but it is no longer covering for arithmetic.
const priceToleranceCents = money.Cents(1)

// SetParcelPrice re-validates the sender's chosen price against
// ParcelPricingRule server-side — the client's number is only ever a
// UI convenience, never trusted. With no bargainReason, priceKes must
// land in [minKes, maxKes]; with one, it must land in
// [minKes*(1-effectivePct/100), minKes], where effectivePct is
// bargainMinPct plus that reason's extraDiscountPct, capped at
// bargainMaxPct.
// PriceBandInput describes everything that moves a parcel's price off
// its bare weight bracket.
type PriceBandInput struct {
	ParcelType        string
	OriginZoneID      *string
	DestinationZoneID *string
	// HasDestinationAgent — the receiver collects from a pickup point
	// rather than a door, which skips the last mile and earns
	// ParcelPricingRule.agentDropDiscountPct.
	HasDestinationAgent bool
	// CoverageFeeKes — already computed (see BookParcelInput), added
	// flat on top. Cover is a fee, not a discountable part of the
	// dispatch price, so it lands after the agent discount rather than
	// before it: discounting someone's insurance premium because they
	// chose a cheap delivery leg would be nonsense.
	CoverageFeeKes float64
	// ParcelOrgID selects the carrying company's rate card, falling back
	// to the platform default (see GetParcelPricing).
	ParcelOrgID *string
}

// ParcelPriceBand is the single derivation of "what may this parcel
// cost", shared by the public quote endpoint and by SetParcelPrice's
// own server-side enforcement.
//
// It exists as one function specifically so those two can never drift.
// The client's number has always been a UI convenience that the server
// re-derives (see SetParcelPrice's own comment); that guarantee is only
// worth anything if "what the server re-derives" and "what the quote
// endpoint showed the sender" are the same arithmetic, in the same
// order. Three add-ons applied in three places in two different orders
// is how a sender ends up staring at a price the server then rejects.
func ParcelPriceBand(ctx context.Context, pool *pgxpool.Pool, in PriceBandInput) (pricing *ParcelPricing, distanceKm float64, err error) {
	pricing, err = GetParcelPricing(ctx, pool, in.ParcelType, in.ParcelOrgID)
	if err != nil {
		return nil, 0, err
	}
	if pricing == nil {
		return nil, 0, &ParcelError{"BAD_INPUT", "This parcel type is not priced"}
	}

	// 1. Distance surcharge is additive on top of the weight bracket,
	// only when both zones are set and an admin has configured a per-km
	// rate — see DistanceSurchargeKes's own comment on the graceful-
	// degradation path when either is missing.
	surchargeKes, distanceKm, err := DistanceSurchargeKes(ctx, pool, in.OriginZoneID, in.DestinationZoneID)
	if err != nil {
		return nil, 0, err
	}
	surcharge := money.FromKES(surchargeKes)
	pricing.MinKes = money.AmountOf(pricing.MinKes.Cents() + surcharge)
	pricing.MaxKes = money.AmountOf(pricing.MaxKes.Cents() + surcharge)

	// 2. Agent collection discount, applied to the dispatch price
	// (bracket + distance) as a whole — the saving is on the journey,
	// so it scales with the journey.
	if in.HasDestinationAgent && pricing.AgentDropDiscountPct > 0 {
		factor := 1 - pricing.AgentDropDiscountPct/100
		if factor < 0 {
			factor = 0
		}
		pricing.MinKes = money.AmountOf(pricing.MinKes.Cents().Scale(factor))
		pricing.MaxKes = money.AmountOf(pricing.MaxKes.Cents().Scale(factor))
	}

	// 3. Cover, flat, last.
	cover := money.FromKES(in.CoverageFeeKes)
	pricing.MinKes = money.AmountOf(pricing.MinKes.Cents() + cover)
	pricing.MaxKes = money.AmountOf(pricing.MaxKes.Cents() + cover)

	return pricing, distanceKm, nil
}

func SetParcelPrice(ctx context.Context, pool *pgxpool.Pool, code string, priceKes float64, bargainReason *string) error {
	var status, parcelType string
	var originZoneID, destinationZoneID, destinationAgentID, coverageFeeText, parcelOrgID *string
	err := pool.QueryRow(ctx, `
		SELECT status::text, "parcelType"::text, "originZoneId"::text, "destinationZoneId"::text,
		       "destinationAgentId"::text, "coverageFeeKes"::text, "parcelOrgId"::text
		FROM parcel WHERE code = $1`, code).
		Scan(&status, &parcelType, &originZoneID, &destinationZoneID, &destinationAgentID,
			&coverageFeeText, &parcelOrgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if status != "DRAFT_PENDING_PAYMENT" {
		return &ParcelError{"BAD_INPUT", "This parcel's price can no longer be changed"}
	}
	coverageFeeKes, err := parseAgentFee(coverageFeeText)
	if err != nil {
		return err
	}
	price := money.FromKES(priceKes)
	pricing, _, err := ParcelPriceBand(ctx, pool, PriceBandInput{
		ParcelType:          parcelType,
		OriginZoneID:        originZoneID,
		DestinationZoneID:   destinationZoneID,
		HasDestinationAgent: destinationAgentID != nil && *destinationAgentID != "",
		CoverageFeeKes:      coverageFeeKes,
		ParcelOrgID:         parcelOrgID,
	})
	if err != nil {
		return err
	}

	if bargainReason == nil || *bargainReason == "" {
		if price < pricing.MinKes.Cents()-priceToleranceCents || price > pricing.MaxKes.Cents()+priceToleranceCents {
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
		floor := pricing.MinKes.Cents().Scale(1 - effectivePct/100)
		if price < floor-priceToleranceCents || price > pricing.MinKes.Cents()+priceToleranceCents {
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
// PARCEL_REVENUE — parcels are an Esoqo-run service, not a
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
		[]ledger.Posting{{AccountID: settlementAcct, AmountCents: ledger.CentsFromKES(priceKes)}, {AccountID: revenueAcct, AmountCents: ledger.CentsFromKES(-priceKes)}}); err != nil {
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
		       "slaDeadlineAt" = now() + (
		           SELECT r."slaHours" FROM parcel_pricing_rule r
		           WHERE r."parcelType" = parcel."parcelType"
		             AND (r."parcelOrgId" IS NULL OR r."parcelOrgId" = parcel."parcelOrgId")
		           ORDER BY r."parcelOrgId" NULLS LAST
		           LIMIT 1
		       ) * interval '1 hour'
		WHERE id = $2`, receiptCol, parcelID); err != nil {
		return "", false, err
	}
	// Frozen here, on the one transition that makes a parcel real money.
	if err := writeParcelRevenueSplit(ctx, pool, parcelID, priceKes); err != nil {
		return "", false, err
	}
	return code, true, nil
}

// ConfirmParcelCashPayment — the counter-cash payment path: a staff
// member confirming the sender physically handed over the dispatch
// fee, rather than an STK/points round trip. Same shape as
// ConfirmParcelPaymentByCheckoutID (idempotent on status, same
// SETTLEMENT/PARCEL_REVENUE ledger posting, same loyalty earn, same
// frozen revenue split, same SLA-deadline rule) — looked up by parcel
// id (an admin action, not a webhook) rather than a checkout request,
// and with no mpesaReceiptCode to record. staffID is who confirmed it,
// for the same audit reason refundedByStaffId/cancelledByStaffId exist.
func ConfirmParcelCashPayment(ctx context.Context, pool *pgxpool.Pool, parcelID, staffID string, loyaltyEnabled bool) (code string, err error) {
	var status, priceKesText string
	var senderPartyID *string
	err = pool.QueryRow(ctx, `
		SELECT code, status::text, "priceKes"::text, "senderPartyId" FROM parcel WHERE id = $1`, parcelID).
		Scan(&code, &status, &priceKesText, &senderPartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", err
	}
	if status != "DRAFT_PENDING_PAYMENT" {
		return "", &ParcelError{"BAD_INPUT", "This parcel is not awaiting payment"}
	}
	priceKes, err := strconv.ParseFloat(priceKesText, 64)
	if err != nil {
		return "", err
	}
	if priceKes <= 0 {
		return "", &ParcelError{"BAD_INPUT", "Choose a price before confirming payment"}
	}

	settlementAcct, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return "", err
	}
	revenueAcct, err := ledger.EnsureAccount(ctx, pool, nil, "PARCEL_REVENUE", "KES")
	if err != nil {
		return "", err
	}
	if _, err := ledger.PostEntry(ctx, pool,
		"parcel:"+parcelID, "Parcel delivery payment (cash)", "core-go:parcel:"+parcelID,
		[]ledger.Posting{{AccountID: settlementAcct, AmountCents: ledger.CentsFromKES(priceKes)}, {AccountID: revenueAcct, AmountCents: ledger.CentsFromKES(-priceKes)}}); err != nil {
		return "", err
	}

	if senderPartyID != nil {
		_ = loyalty.EarnForSpend(ctx, pool, *senderPartyID, priceKes, "parcel:"+parcelID, loyaltyEnabled)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET "paidAt" = now(), status = 'BOOKED', "paymentMethod" = 'CASH', "paidByStaffId" = $1,
		       "slaDeadlineAt" = now() + (
		           SELECT r."slaHours" FROM parcel_pricing_rule r
		           WHERE r."parcelType" = parcel."parcelType"
		             AND (r."parcelOrgId" IS NULL OR r."parcelOrgId" = parcel."parcelOrgId")
		           ORDER BY r."parcelOrgId" NULLS LAST
		           LIMIT 1
		       ) * interval '1 hour'
		WHERE id = $2`, staffID, parcelID); err != nil {
		return "", err
	}
	// Frozen here, on the one transition that makes a parcel real money —
	// same rule ConfirmParcelPaymentByCheckoutID's own comment describes.
	if err := writeParcelRevenueSplit(ctx, pool, parcelID, priceKes); err != nil {
		return "", err
	}
	return code, nil
}

// PayParcelWithPoints — the ESOKO_POINTS payment path, settled inline
// (no STK round trip), same shape store checkout's VOUCHER method
// already follows. Only the party that booked the parcel can spend
// their own points on it — a guest booking (senderPartyId nil) can
// never match, so this cleanly forces guests onto MPESA_STK instead.
func PayParcelWithPoints(ctx context.Context, pool *pgxpool.Pool, code, partyID string) error {
	// The points debit and the parcel's move to BOOKED are one
	// transaction. Split apart they double-charge: a sender tapping
	// "pay with points" twice (or two tabs racing) sees the status read
	// as DRAFT_PENDING_PAYMENT both times, and SpendFromParty's
	// balance check is itself a read-then-insert with no lock — so the
	// same parcel's points are spent twice while only one of the
	// attempts finds the status to flip. The debit's own check (bal <
	// points) is racy in the same way, letting a balance go negative
	// against its own rule. FOR UPDATE on the parcel serialises the two
	// attempts; the second sees BOOKED and is refused before it can
	// debit.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var parcelID, status, priceKesText string
	err = tx.QueryRow(ctx, `
		SELECT id, status::text, "priceKes"::text
		FROM parcel WHERE code = $1 AND "senderPartyId" = $2 FOR UPDATE`, code, partyID).
		Scan(&parcelID, &status, &priceKesText)
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
	if err := loyalty.SpendFromPartyTx(ctx, tx, partyID, points, "parcel:"+code); err != nil {
		if errors.Is(err, loyalty.ErrInsufficientLoyalty) {
			return &ParcelError{"INSUFFICIENT_POINTS", "Not enough Esoqo points for this parcel"}
		}
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET "paymentMethod" = 'ESOKO_POINTS', "paidAt" = now(), status = 'BOOKED',
		       "slaDeadlineAt" = now() + (
		           SELECT r."slaHours" FROM parcel_pricing_rule r
		           WHERE r."parcelType" = parcel."parcelType"
		             AND (r."parcelOrgId" IS NULL OR r."parcelOrgId" = parcel."parcelOrgId")
		           ORDER BY r."parcelOrgId" NULLS LAST
		           LIMIT 1
		       ) * interval '1 hour'
		WHERE code = $1 AND status = 'DRAFT_PENDING_PAYMENT'`, code); err != nil {
		return err
	}
	if err := writeParcelRevenueSplitTx(ctx, tx, parcelID, priceKes); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SettleCounterParcel records the money actually taken, in person, for
// a PAY_AT_COUNTER parcel — the clerk weighing a walk-in box at the
// desk, or the rider who collected a scheduled pickup coming back with
// the fare.
//
// This closes the one funnel that had no settlement at all. BookParcel's
// PayAtCounter branch deliberately lands a parcel in BOOKED with
// priceKes NULL, because nobody has weighed it yet — but nothing
// anywhere ever filled that in afterwards. SetParcelPrice can't: it only
// accepts DRAFT_PENDING_PAYMENT, and a counter parcel skipped straight
// past that. So every walk-in and every pay-on-collection parcel stayed
// permanently unpriced and unpaid: no priceKes, no paidAt, no revenue
// split, nothing for AccrueCourierEarnings to pay a courier out of
// (it bails at priceKes <= 0), and no row in any revenue report. The
// whole counter business was invisible to the platform's own books.
//
// Priced against the same band a sender would have been quoted (see
// ParcelPriceBand), not a free number: the counter is a different place
// to pay, not a licence to charge what you like. Bargains are
// deliberately not offered here — a negotiated fare belongs to the
// booking flow where the reason is captured and auditable; a clerk who
// needs to go off-card should be discounting through that path.
//
// Idempotent by guard rather than by check-then-act: the UPDATE itself
// requires paidAt IS NULL, so two clerks settling the same box at once
// produce one settlement and one "already settled", never two revenue
// splits.
func SettleCounterParcel(ctx context.Context, pool *pgxpool.Pool, code string, priceKes float64, orgScope *string) error {
	if priceKes <= 0 {
		return &ParcelError{"BAD_INPUT", "Enter what the sender actually paid"}
	}

	var parcelID, status, parcelType string
	var paymentMethod, paidAt, originZoneID, destinationZoneID, destinationAgentID, coverageFeeText, parcelOrgID *string
	// Code or serviceTicketNumber, same reasoning ScanHandoff's own
	// lookup gives: the clerk settling the fare is holding whichever
	// reference the sender walked in with, and for a walk-in that is the
	// ticket number. Settling is gated by capability and tenancy below,
	// never by which reference was quoted.
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "parcelType"::text, "paymentMethod"::text, "paidAt"::text,
		       "originZoneId"::text, "destinationZoneId"::text, "destinationAgentId"::text,
		       "coverageFeeKes"::text, "parcelOrgId"::text
		FROM parcel WHERE code = $1 OR "serviceTicketNumber" = $1`, code).
		Scan(&parcelID, &status, &parcelType, &paymentMethod, &paidAt,
			&originZoneID, &destinationZoneID, &destinationAgentID, &coverageFeeText, &parcelOrgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	// Tenancy, same reasoning handleUpsertMyOrgStaff's own comment
	// gives: a clerk settles their own company's parcels, and the scope
	// comes from the session, never from the body. Nil means Esoqo staff
	// acting with an explicit capability — no narrowing to apply.
	if orgScope != nil && (parcelOrgID == nil || *parcelOrgID != *orgScope) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if paymentMethod == nil || *paymentMethod != "PAY_AT_COUNTER" {
		return &ParcelError{"BAD_INPUT", "This parcel wasn't booked to be paid at the counter"}
	}
	if paidAt != nil {
		return &ParcelError{"ALREADY_SETTLED", "This parcel has already been settled"}
	}
	if status == "CANCELLED" || status == "RETURNED_TO_SENDER" {
		return &ParcelError{"BAD_INPUT", "This parcel's journey is already closed"}
	}

	coverageFeeKes, err := parseAgentFee(coverageFeeText)
	if err != nil {
		return err
	}
	pricing, _, err := ParcelPriceBand(ctx, pool, PriceBandInput{
		ParcelType:          parcelType,
		OriginZoneID:        originZoneID,
		DestinationZoneID:   destinationZoneID,
		HasDestinationAgent: destinationAgentID != nil && *destinationAgentID != "",
		CoverageFeeKes:      coverageFeeKes,
		ParcelOrgID:         parcelOrgID,
	})
	if err != nil {
		return err
	}
	price := money.FromKES(priceKes)
	if price < pricing.MinKes.Cents()-priceToleranceCents || price > pricing.MaxKes.Cents()+priceToleranceCents {
		return &ParcelError{"BAD_INPUT", "That amount is outside the standard range for this parcel"}
	}

	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET "priceKes" = $1, "paidAt" = now()
		WHERE id = $2 AND "paidAt" IS NULL`, priceKes, parcelID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"ALREADY_SETTLED", "This parcel has already been settled"}
	}
	return writeParcelRevenueSplit(ctx, pool, parcelID, priceKes)
}

// generateDeliveryCode mirrors generatePickupCode's alphabet trick
// (store.go) — short, no ambiguous characters, read aloud by a human
// rather than scanned.
// SplitParcelRevenue divides a paid parcel price between Esoqo's
// commission and the carrying company's earnings.
//
// Pure and rounded to whole cents, so both numbers are exact money and
// — the part that matters — they always add back up to priceKes. The
// org's share is derived by subtraction rather than by a second
// percentage calculation precisely so a rounding remainder can never
// strand a cent that belongs to nobody, which is the classic way a
// settlement report stops reconciling.
//
// Called once, at payment confirmation, and the result is frozen onto
// the parcel (see Parcel.platformFeeKes) — never recomputed on read,
// because a renegotiated commission must not rewrite what an
// already-paid parcel earned.
func SplitParcelRevenue(priceKes, commissionPct float64) (platformFeeKes, orgEarningsKes float64) {
	if commissionPct < 0 {
		commissionPct = 0
	}
	if commissionPct > 100 {
		commissionPct = 100
	}
	// The org's earnings are the remainder, never a second independent
	// percentage — that is what stops a rounding remainder stranding a
	// cent. In exact cents the reconciliation is guaranteed rather than
	// merely very likely: money.Cents arithmetic is integer arithmetic,
	// so fee + earnings == price for every price and every rate (see
	// money.TestPercentSplitAlwaysReconciles).
	price := money.FromKES(priceKes)
	fee := price.Percent(commissionPct)
	return fee.KES(), (price - fee).KES()
}

// parcelOrgCommission — the carrying company and its commission rate
// for [parcelID], or (nil, 0) for an Esoqo-operated parcel. Its own
// lookup so both payment paths (STK callback and points) split revenue
// from the same source rather than each assembling their own join.
func parcelOrgCommission(ctx context.Context, pool *pgxpool.Pool, parcelID string) (orgID *string, commissionPct float64, err error) {
	var commissionText *string
	err = pool.QueryRow(ctx, `
		SELECT p."parcelOrgId"::text, o."commissionPct"::text
		FROM parcel p LEFT JOIN parcel_org o ON o.id = p."parcelOrgId"
		WHERE p.id = $1`, parcelID).Scan(&orgID, &commissionText)
	if err != nil {
		return nil, 0, err
	}
	if orgID == nil || commissionText == nil {
		return nil, 0, nil
	}
	commissionPct, err = parseFloatOrZero(*commissionText)
	return orgID, commissionPct, err
}

// parcelOrgCommissionTx is parcelOrgCommission on a caller's transaction,
// so the commission rate that gets frozen is read from the same
// snapshot the split is written in.
func parcelOrgCommissionTx(ctx context.Context, tx pgx.Tx, parcelID string) (orgID *string, commissionPct float64, err error) {
	var commissionText *string
	err = tx.QueryRow(ctx, `
		SELECT p."parcelOrgId"::text, o."commissionPct"::text
		FROM parcel p LEFT JOIN parcel_org o ON o.id = p."parcelOrgId"
		WHERE p.id = $1`, parcelID).Scan(&orgID, &commissionText)
	if err != nil {
		return nil, 0, err
	}
	if orgID == nil || commissionText == nil {
		return nil, 0, nil
	}
	commissionPct, err = parseFloatOrZero(*commissionText)
	return orgID, commissionPct, err
}

// writeParcelRevenueSplit stores the frozen split. A no-op for an
// Esoqo-operated parcel, where the whole price is already Esoqo's and
// writing a "split" of 100/0 would be a fiction that later reports
// would have to special-case anyway.
func writeParcelRevenueSplit(ctx context.Context, pool *pgxpool.Pool, parcelID string, priceKes float64) error {
	orgID, commissionPct, err := parcelOrgCommission(ctx, pool, parcelID)
	if err != nil || orgID == nil {
		return err
	}
	platformFee, orgEarnings := SplitParcelRevenue(priceKes, commissionPct)
	_, err = pool.Exec(ctx, `
		UPDATE parcel SET "platformFeeKes" = $1, "orgEarningsKes" = $2 WHERE id = $3`,
		platformFee, orgEarnings, parcelID)
	return err
}

// writeParcelRevenueSplitTx is writeParcelRevenueSplit inside the
// caller's transaction. The split is frozen on the same transition that
// makes the parcel real money, so it has to be in the same commit as the
// payment — a crash between them left a paid parcel with no revenue
// split, and nothing replays it: the money is taken and the courier
// company's share is simply never recorded.
func writeParcelRevenueSplitTx(ctx context.Context, tx pgx.Tx, parcelID string, priceKes float64) error {
	orgID, commissionPct, err := parcelOrgCommissionTx(ctx, tx, parcelID)
	if err != nil || orgID == nil {
		return err
	}
	platformFee, orgEarnings := SplitParcelRevenue(priceKes, commissionPct)
	_, err = tx.Exec(ctx, `
		UPDATE parcel SET "platformFeeKes" = $1, "orgEarningsKes" = $2 WHERE id = $3`,
		platformFee, orgEarnings, parcelID)
	return err
}

// DeliveryCodeDigits is the length of a newly issued delivery code.
//
// Six DIGITS, not the six mixed letters-and-digits this used to mint.
// The code's whole job is to survive a trip through the physical world:
// it is read off an SMS by a receiver, often spoken down a phone to a
// clerk, and typed by that clerk on a counter handset. Letters cost on
// every one of those legs — "is that an M or an N", upper or lower, and
// a full QWERTY keyboard on a phone where a numeric pad would do. A
// digits-only code opens the system numeric keypad (inputMode="numeric"
// on the counter's entry field), reads aloud unambiguously in any
// language spoken at the desk, and needs no case handling at all.
//
// The cost is entropy: 10^6 rather than 32^6, about a thousandth of the
// space. That is acceptable ONLY because handleDeliverParcel now locks
// a parcel's code after DeliveryCodeMaxAttempts wrong tries — without
// that throttle a courier holding a parcel could simply enumerate the
// million and launder a diverted box as a clean DELIVERY_CODE handover
// rather than the photo-and-name STAFF_OVERRIDE that leaves a trail.
// The two changes are one decision; neither is safe to revert alone.
//
// Codes already issued stay valid: DeliverParcel compares against the
// stored value with EqualFold and never re-derives the format, so every
// alphanumeric code in flight keeps working until its parcel lands.
const DeliveryCodeDigits = 6

// DeliveryCodeMaxAttempts — wrong delivery codes tolerated per parcel
// before the handover has to fall back to an auditable route (OTP to
// the number on file, or a staff override with photo and name).
const DeliveryCodeMaxAttempts = 5

func generateDeliveryCode() (string, error) {
	const digits = "0123456789"
	out := make([]byte, DeliveryCodeDigits)
	// Rejection sampling, not modulo. 256 divides evenly by the old
	// 32-character alphabet, so the previous `% len(alphabet)` was
	// unbiased by luck; 256 % 10 is 6, so the same trick would make
	// 0–5 measurably likelier than 6–9 in every position. On a code
	// this short, a skewed digit distribution is real entropy lost.
	for i := range out {
		for {
			var b [1]byte
			if _, err := cryptorand.Read(b[:]); err != nil {
				return "", err
			}
			if b[0] < 250 { // 250 = 25 * 10, the largest multiple of 10 that fits
				out[i] = digits[int(b[0])%10]
				break
			}
		}
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
	// SlaDeadlineAt — the delivery promise frozen at payment time (see
	// Parcel.slaDeadlineAt). On this projection purely so the tracking
	// page can say "arriving by 4pm today" instead of showing a
	// five-dot stepper with no sense of time at all — the single most
	// common question a tracking page exists to answer, and one this
	// view had the data for all along without ever surfacing it.
	SlaDeadlineAt *time.Time `json:"slaDeadlineAt"`

	// IntakeConfirmedAt — when the box was first physically received
	// (a counter receipt or the first pickup). Exposed on this
	// guest-safe view so the tracker can date its "received" stage; a
	// timestamp carries no PII. handleGetParcelStatus still uses its
	// presence to decide whether the caller gets this full view at all,
	// or the reduced pre-intake stub.
	IntakeConfirmedAt *time.Time `json:"intakeConfirmedAt"`

	// Failed-attempt summary. A receiver who was out needs to know an
	// attempt happened and why far more than they need the status
	// string; without this a FAILED_DELIVERY parcel reads as "stuck"
	// with no explanation and no obvious next step.
	DeliveryAttempts  int        `json:"deliveryAttempts"`
	LastAttemptAt     *time.Time `json:"lastAttemptAt"`
	LastAttemptReason *string    `json:"lastAttemptReason"`
	LastAttemptText   *string    `json:"lastAttemptText"`

	// Proof of delivery. A deliberate, narrow departure from this
	// projection's PII-minimal rule: the whole value of POD is that the
	// sender and receiver can settle "who actually took it" themselves,
	// and the tracking code is by design the credential those two (and
	// only those two) hold. Nothing here identifies the courier, and
	// PodReceivedByName is a name the receiver's own household or shop
	// supplied at the door.
	PodPhotoURL       *string `json:"podPhotoUrl"`
	PodReceivedByName *string `json:"podReceivedByName"`
	PodMethod         *string `json:"podMethod"`

	// Agent — where to collect it, when this parcel is on a pickup
	// point's shelf (HELD_AT_AGENT). Nil for a doorstep delivery. A
	// status of "waiting at an agent" is useless without the shop's
	// address, hours and phone, so they travel together.
	Agent *ParcelAgentStop `json:"agent"`

	// PreLabel/PreLabelInfo — set only on the pre-printed-label
	// fallback below, when [code] isn't a real, booked Parcel (yet).
	// Status reads "LABEL_PRINTED" in that case — a sentinel no real
	// Parcel row ever has, so a client can tell the two cases apart
	// from this one JSON shape without a separate endpoint.
	PreLabel bool `json:"preLabel"`

	// LabelVerdict — whether the printed label this was scanned from is
	// genuinely ours. Filled in by the handler, which holds the signing
	// secret; empty on every path that didn't come from a scan.
	//
	//   "genuine"     — the k= matched
	//   "unverified"  — no k= at all, which is a typed code or a label
	//                   printed before signing existed, not a forgery
	//   "forged"      — a k= was presented and did not match
	//
	// The middle value is why this is three states and not a boolean:
	// conflating absent with wrong would show a red "not a genuine
	// label" page to anyone who typed their code by hand.
	LabelVerdict string `json:"labelVerdict,omitempty"`

	PreLabelInfo *ParcelLabelInfo `json:"preLabelInfo"`

	// OrgName — the courier company this parcel or label belongs to, if
	// any. Guest-safe (a company name, not a person) and the whole
	// point of company-issued stock: anyone scanning — our app or an
	// ordinary phone camera — sees whose label they're holding and that
	// Esoqo manages it. Nil for the shared Esoqo pool.
	OrgName *string `json:"orgName"`
	// OrgLogoUrl — the same company's logo, alongside its name, so a
	// scan from an ordinary phone camera can show the co-brand mark
	// next to "managed by Esoqo" rather than a name alone. Nil exactly
	// when OrgName is nil (shared Esoqo pool, no company to brand).
	OrgLogoUrl *string `json:"orgLogoUrl"`

	// Events — the full custody timeline, oldest first, guest-safe: a
	// time and a stage label, never a holder's name or phone. Lets the
	// tracking page show "received at counter 2:14pm, collected 4:02pm"
	// rather than a bare current status. See ListParcelTrackEvents.
	Events []ParcelTrackEvent `json:"events"`
}

// ParcelTrackEvent is one line of the public custody timeline. Status is
// the ParcelStatus the leg produced (may be empty on rows written before
// parcel_handoff.status existed); Label is the human sentence the client
// renders. No holder identity by design — see ParcelStatusView's own
// PII-minimal rule.
type ParcelTrackEvent struct {
	At     time.Time `json:"at"`
	Status string    `json:"status"`
	Label  string    `json:"label"`
	// Severity — INFO | WARNING | CRITICAL. Every custody leg is INFO:
	// a leg exists precisely because something went right. It matters
	// for the parcel_event rows merged in alongside them, which include
	// things that went wrong, and which the web timeline drew as green
	// ticks until this field existed because a tick was all it had.
	Severity string `json:"severity"`
}

// trackEventLabel maps a custody leg's resulting status to a guest-safe
// sentence. Empty (pre-migration rows) falls back to a neutral label.
func trackEventLabel(status string) string {
	switch status {
	case "RECEIVED_AT_COUNTER":
		return "Received at counter"
	case "PICKED_UP":
		return "Collected"
	case "IN_TRANSIT":
		return "In transit"
	case "HELD_AT_AGENT":
		return "Ready for collection"
	case "DELIVERED":
		return "Delivered"
	default:
		return "Custody transfer"
	}
}

// ListParcelTrackEvents — the parcel_handoff legs as guest-safe timeline
// rows, oldest first: time plus the status the leg produced, never a
// holder's identity. See ParcelTrackEvent.
func ListParcelTrackEvents(ctx context.Context, pool *pgxpool.Pool, parcelID string) ([]ParcelTrackEvent, error) {
	rows, err := pool.Query(ctx, `
		SELECT "createdAt", COALESCE(status::text, '')
		FROM parcel_handoff
		WHERE "parcelId" = $1
		ORDER BY "createdAt" ASC`, parcelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelTrackEvent
	for rows.Next() {
		var e ParcelTrackEvent
		if err := rows.Scan(&e.At, &e.Status); err != nil {
			return nil, err
		}
		e.Label = trackEventLabel(e.Status)
		e.Severity = "INFO"
		out = append(out, e)
	}
	return out, rows.Err()
}

// listPublicParcelEvents — the parcel_event rows a guest may see, which
// is exactly those with a publicLabel (see the model's comment on why
// visibility and wording are one column). Status is left empty: these
// are not custody legs and do not move the parcel between states, and
// filling it with something plausible would have the client's stepper
// draw a stage that never happened.
func listPublicParcelEvents(ctx context.Context, pool *pgxpool.Pool, parcelID string) ([]ParcelTrackEvent, error) {
	rows, err := pool.Query(ctx, `
		SELECT "createdAt", "publicLabel", severity::text
		FROM parcel_event
		WHERE "parcelId" = $1 AND "publicLabel" IS NOT NULL
		ORDER BY "createdAt" ASC`, parcelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelTrackEvent
	for rows.Next() {
		var e ParcelTrackEvent
		if err := rows.Scan(&e.At, &e.Label, &e.Severity); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// buildParcelTrackEvents — the full public timeline: booking, every
// custody leg, every public non-custody event, then delivery, in time
// order. Best-effort on both lookups: a failure must not lose the whole
// status response.
func buildParcelTrackEvents(ctx context.Context, pool *pgxpool.Pool, parcelID string, createdAt time.Time, deliveredAt *time.Time) []ParcelTrackEvent {
	events := []ParcelTrackEvent{{At: createdAt, Status: "BOOKED", Label: "Booked", Severity: "INFO"}}
	if legs, err := ListParcelTrackEvents(ctx, pool, parcelID); err == nil {
		events = append(events, legs...)
	}
	if extra, err := listPublicParcelEvents(ctx, pool, parcelID); err == nil {
		events = append(events, extra...)
	}
	if deliveredAt != nil {
		events = append(events, ParcelTrackEvent{At: *deliveredAt, Status: "DELIVERED", Label: "Delivered", Severity: "INFO"})
	}
	// Sorted rather than merged, because three already-sorted sources
	// interleave: a lockout happens between two custody legs, and a
	// timeline that listed every failure after every hand-over would
	// read as though the parcel moved first and the trouble came later.
	// Stable, so same-instant rows keep source order — booking before
	// its own first leg, delivery last.
	sort.SliceStable(events, func(i, j int) bool { return events[i].At.Before(events[j].At) })
	return events
}

// ParcelAgentStop — the collection-point details a receiver needs, cut
// down from the full ParcelAgent (no capacity, no shelf count, no
// owning party — operational numbers that are nobody's business at the
// door).
type ParcelAgentStop struct {
	Name          string       `json:"name"`
	Msisdn        string       `json:"msisdn"`
	LocationHint  string       `json:"locationHint"`
	OpeningHours  *string      `json:"openingHours"`
	Lat           float64      `json:"lat"`
	Lng           float64      `json:"lng"`
	HoldingFeeKes money.Amount `json:"holdingFeeKes"`
}

// ParcelLabelInfo is the structured info a handler attached to a
// pre-printed label in the field (see AttachParcelLabelInfo) — nil
// until at least an item description has been filled in, even for a
// genuinely pre-printed (but still blank) label.
type ParcelLabelInfo struct {
	ItemDescription string    `json:"itemDescription"`
	Destination     *string   `json:"destination"`
	SenderName      *string   `json:"senderName"`
	SenderMsisdn    *string   `json:"senderMsisdn"`
	ReceiverName    *string   `json:"receiverName"`
	ReceiverMsisdn  *string   `json:"receiverMsisdn"`
	ItemType        *string   `json:"itemType"`
	WeightRangeKg   *string   `json:"weightRangeKg"`
	LengthCm        *float64  `json:"lengthCm"`
	WidthCm         *float64  `json:"widthCm"`
	HeightCm        *float64  `json:"heightCm"`
	RouteID         *string   `json:"routeId"`
	RouteLabel      *string   `json:"routeLabel"`
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
	var parcelID string
	var agentName, agentMsisdn, agentHint, agentHours, agentLat, agentLng, agentFee *string
	// Matches by the real code or by serviceTicketNumber — a sender who
	// only has the ticket number (the only thing they were ever given
	// pre-intake, see Parcel.serviceTicketNumber's own comment) still
	// needs some way to check in. handleGetParcelStatus is what actually
	// enforces the pre-intake reduction; this just has to find the row
	// either way.
	err := pool.QueryRow(ctx, `
		SELECT p.id, p.code, p.status::text, p."originLabel", p."destinationLabel", p."parcelType"::text,
		       p."priceKes"::text, p."collectionScheduledAt", p."createdAt", p."deliveredAt",
		       p."cancellationReason", p."cancelledAt", p."receiptConfirmedAt",
		       p."slaDeadlineAt", p."intakeConfirmedAt",
		       p."deliveryAttempts", p."lastAttemptAt", p."lastAttemptReason",
		       p."podPhotoUrl", p."podReceivedByName", p."podMethod",
		       a.name, a.msisdn, a."locationHint", a."openingHours",
		       a.lat::text, a.lng::text, a."holdingFeeKes"::text,
		       o.name, o."logoUrl"
		FROM parcel p
		LEFT JOIN parcel_agent a ON a.id = p."destinationAgentId"
		LEFT JOIN parcel_org o ON o.id = p."parcelOrgId"
		WHERE p.code = $1 OR p."serviceTicketNumber" = $1`, code).
		Scan(&parcelID, &v.Code, &v.Status, &v.OriginLabel, &v.DestinationLabel, &v.ParcelType,
			&v.PriceKes, &v.CollectionScheduledAt, &v.CreatedAt, &v.DeliveredAt,
			&v.CancellationReason, &v.CancelledAt, &v.ReceiptConfirmedAt,
			&v.SlaDeadlineAt, &v.IntakeConfirmedAt,
			&v.DeliveryAttempts, &v.LastAttemptAt, &v.LastAttemptReason,
			&v.PodPhotoURL, &v.PodReceivedByName, &v.PodMethod,
			&agentName, &agentMsisdn, &agentHint, &agentHours,
			&agentLat, &agentLng, &agentFee, &v.OrgName, &v.OrgLogoUrl)
	if err == nil {
		if v.LastAttemptReason != nil {
			// Resolved server-side rather than left to each client to map:
			// web, mobile and any future SMS/USSD surface must all explain
			// a failed attempt with the same sentence, and three copies of
			// a switch statement is three chances to drift.
			text := AttemptReasonText(*v.LastAttemptReason, nil)
			v.LastAttemptText = &text
		}
		if agentName != nil {
			stop := ParcelAgentStop{Name: *agentName}
			if agentMsisdn != nil {
				stop.Msisdn = *agentMsisdn
			}
			if agentHint != nil {
				stop.LocationHint = *agentHint
			}
			stop.OpeningHours = agentHours
			if agentLat != nil {
				stop.Lat, _ = parseFloatOrZero(*agentLat)
			}
			if agentLng != nil {
				stop.Lng, _ = parseFloatOrZero(*agentLng)
			}
			if agentFee != nil {
				stop.HoldingFeeKes = money.AmountOf(money.MustParseKES(*agentFee))
			}
			v.Agent = &stop
		}
		v.Events = buildParcelTrackEvents(ctx, pool, parcelID, v.CreatedAt, v.DeliveredAt)
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
		SELECT s.code, s."createdAt", s."itemDescription", s.destination, s."senderName", s."senderMsisdn",
		       s."receiverName", s."receiverMsisdn", s."itemType", s."weightRangeKg", s."infoAttachedAt",
		       s."lengthCm"::float8, s."widthCm"::float8, s."heightCm"::float8, o.name, o."logoUrl"
		FROM parcel_label_stock s
		LEFT JOIN parcel_org o ON o.id = s."parcelOrgId"
		WHERE s.code = $1`, code).
		Scan(&stock.Code, &createdAt, &itemDescription, &info.Destination, &info.SenderName,
			&info.SenderMsisdn, &info.ReceiverName, &info.ReceiverMsisdn, &info.ItemType, &info.WeightRangeKg, &infoAttachedAt,
			&info.LengthCm, &info.WidthCm, &info.HeightCm, &stock.OrgName, &stock.OrgLogoUrl)
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

// PartyParcelActivityRow is one line on "your parcels" — a staff
// member's own history, reachable from a signed-in session rather than
// a per-code lookup. Role says which of the three ways this party
// touches the row (sender / receiver / current holder), because the
// same person can appear in more than one bucket and a plain list
// wouldn't say which fact earned them a place on it.
type PartyParcelActivityRow struct {
	Code             string `json:"code"`
	Status           string `json:"status"`
	OriginLabel      string `json:"originLabel"`
	DestinationLabel string `json:"destinationLabel"`
	CreatedAt        string `json:"createdAt"`
	Role             string `json:"role"` // SENT | RECEIVING | HOLDING
}

// ListPartyParcelActivity — "parcels you've sent, are receiving, or are
// currently holding", for the signed-in party behind a session, not a
// per-code guest lookup. Receiver matching is by msisdn (Parcel has no
// receiverPartyId — a receiver is often not an Esoqo user at all), so
// this only surfaces the RECEIVING bucket for a party whose own phone
// number is on file; a party with none simply gets an empty bucket
// there; sender and holder queries need no such fallback since both
// already store a real partyId.
func ListPartyParcelActivity(ctx context.Context, pool *pgxpool.Pool, partyID string, limit int) ([]PartyParcelActivityRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := pool.Query(ctx, `
		SELECT p.code, p.status::text, p."originLabel", p."destinationLabel",
		       to_char(p."createdAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'), role
		FROM (
			SELECT id, "createdAt", 'SENT' AS role FROM parcel WHERE "senderPartyId" = $1
			UNION ALL
			SELECT id, "createdAt", 'RECEIVING' FROM parcel
			WHERE "receiverMsisdn" = (SELECT msisdn FROM person WHERE "partyId" = $1)
			UNION ALL
			SELECT id, "createdAt", 'HOLDING' FROM parcel WHERE "currentHolderPartyId" = $1
		) hits
		JOIN parcel p ON p.id = hits.id
		ORDER BY hits."createdAt" DESC
		LIMIT $2`, partyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PartyParcelActivityRow
	for rows.Next() {
		var r PartyParcelActivityRow
		if err := rows.Scan(&r.Code, &r.Status, &r.OriginLabel, &r.DestinationLabel, &r.CreatedAt, &r.Role); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// LabelSigFields returns the owner and batch a label's signature was
// computed over, so a scan can be verified.
//
// Read from parcel_label_stock rather than from the parcel, because
// those can legitimately differ: a parcel booked against shared Esoqo
// stock may be handed to a courier company afterwards, which changes
// the parcel's org but not the sticker that was already printed. The
// signature has to be checked against what was true at print time.
//
// Missing values (a code minted fresh at checkout with no stock row,
// pre-batch stock) come back empty, which is exactly what SignLabel was
// given for them.
func LabelSigFields(ctx context.Context, pool *pgxpool.Pool, code string) (orgID, batchID string, err error) {
	err = pool.QueryRow(ctx, `
		SELECT COALESCE("parcelOrgId"::text, ''), COALESCE("batchId"::text, '')
		FROM parcel_label_stock WHERE code = $1`, code).Scan(&orgID, &batchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	return orgID, batchID, err
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
	// The destination pin, for the one person who needs to navigate to
	// it. Behind the same custody/capability gate the rest of this
	// projection is — a pin is more precise than the free-text label and
	// has no business being on the guest-safe view or printed in the
	// open on the outside of a box.
	DestinationLat *float64 `json:"destinationLat"`
	DestinationLng *float64 `json:"destinationLng"`
	// Reprint branding + signature, so a booked parcel's own label prints
	// genuine with its company's logo (or Esoqo alone for shared pool).
	// Resolved from the stock row (print-time truth), signed by the
	// handler which owns the secret.
	OrgName    *string `json:"orgName"`
	OrgLogoUrl *string `json:"orgLogoUrl"`
	Sig        string  `json:"sig"`
	// Signing inputs (print-time truth from the stock row). Not
	// serialized — the handler signs, then these stay empty on the wire.
	StockOrgID   string `json:"-"`
	StockBatchID string `json:"-"`
}

// GetParcelLabel loads the label projection for [code]. Authorization
// is the caller's job (see handleGetParcelLabel) — this is a pure
// read, same split GetParcelStatus/ScanHandoff already keep between
// "can they see it" and "what's in it".
func GetParcelLabel(ctx context.Context, pool *pgxpool.Pool, code string) (*ParcelLabel, error) {
	var v ParcelLabel
	var receiverMsisdn string
	err := pool.QueryRow(ctx, `
		SELECT p.code, p.status::text, p."parcelType"::text, p."weightKg", p."originLabel", p."destinationLabel",
		       p."receiverName", p."receiverMsisdn", p."createdAt",
		       p."destinationLat"::float8, p."destinationLng"::float8,
		       o.name, o."logoUrl",
		       COALESCE(s."parcelOrgId"::text, ''), COALESCE(s."batchId"::text, '')
		FROM parcel p
		LEFT JOIN parcel_label_stock s ON s.code = p.code
		LEFT JOIN parcel_org o ON o.id = s."parcelOrgId"
		WHERE p.code = $1`, code).
		Scan(&v.Code, &v.Status, &v.ParcelType, &v.WeightKg, &v.OriginLabel, &v.DestinationLabel,
			&v.ReceiverName, &receiverMsisdn, &v.CreatedAt, &v.DestinationLat, &v.DestinationLng,
			&v.OrgName, &v.OrgLogoUrl, &v.StockOrgID, &v.StockBatchID)
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
	// What the printed QR needs beyond the code: who this pad belongs to
	// and which run it came off, so the caller can sign it (see
	// fleetqr.SignLabel). Both empty for the shared Esoqo pool and for
	// stock minted before batches were tracked.
	ParcelOrgID string `json:"parcelOrgId"`
	BatchID     string `json:"batchId"`
	// Sig — the truncated MAC printed as k= in the QR's URL. Filled in
	// by the handler, which holds the secret; dbx deliberately does not.
	Sig string `json:"sig"`
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
// last, so the caller can print/display "batch of N" as one strip,
// along with the batch id that ties them together.
//
// [orgID] is who the pad is printed for — nil mints into the shared
// Esoqo pool. Authorisation is the handler's job (an org admin may
// only mint into their own company); this records what it's told, and
// BookParcel is where the resulting ownership is enforced.
//
// One batch per call, because that is exactly what a batch is: the run
// that came off the printer together and will be carried to a branch
// together. Voiding is a batch-level act for the same reason — pads go
// missing, not individual stickers.
func GenerateParcelLabelStock(
	ctx context.Context, pool *pgxpool.Pool, count int, staffID, orgID *string,
) (codes []string, batchID string, err error) {
	if count < 1 || count > 500 {
		return nil, "", &ParcelError{"BAD_INPUT", "Generate between 1 and 500 labels at a time"}
	}
	// Minted by Postgres rather than in Go, same generator every id in
	// this file already comes from — one source of uuids, no new
	// dependency for a single value.
	if err := pool.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&batchID); err != nil {
		return nil, "", err
	}
	codes = make([]string, 0, count)
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
				INSERT INTO parcel_label_stock (
					id, code, "createdAt", "createdByStaffId", "parcelOrgId", "batchId", "issuedAt"
				) VALUES (gen_random_uuid(), $1, now(), $2, $3::uuid, $4::uuid, now())`,
				code, staffID, orgID, batchID)
			return err
		})
		if err != nil {
			return codes, batchID, err
		}
		codes = append(codes, code)
	}
	return codes, batchID, nil
}

// ListUnusedParcelLabelStock — the still-genuinely-blank half of the
// pool (never bound to a real parcel, never even had a note attached
// in the field), newest first, for a "reprint this batch" or "how
// many do we have left" view. A label with itemInfo attached is
// excluded the same as a used one — it's already spoken for, even if
// it never becomes a real booking.
//
// [orgID] scopes to one company's own pad; nil is the shared Esoqo
// pool. A company must not be shown, let alone able to reprint,
// another's stock — reprinting someone else's codes is how a pad ends
// up in two places at once.
//
// Voided stock is excluded: a withdrawn label is not something anyone
// should be handed a print button for.
func ListUnusedParcelLabelStock(
	ctx context.Context, pool *pgxpool.Pool, limit int, orgID *string,
) ([]ParcelLabelStockRow, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := pool.Query(ctx, `
		SELECT code, "createdAt", COALESCE("parcelOrgId"::text, ''), COALESCE("batchId"::text, '')
		FROM parcel_label_stock
		WHERE "usedAt" IS NULL AND "infoAttachedAt" IS NULL AND "voidedAt" IS NULL
		  AND "parcelOrgId" IS NOT DISTINCT FROM $2::uuid
		ORDER BY "createdAt" DESC LIMIT $1`, limit, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelLabelStockRow
	for rows.Next() {
		var r ParcelLabelStockRow
		if err := rows.Scan(&r.Code, &r.CreatedAt, &r.ParcelOrgID, &r.BatchID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ParcelLabelInfoInput is what a handler fills in for a pre-printed
// label in the field — see AttachParcelLabelInfo's own comment. Every
// field is optional individually (a handler might only know the item
// and destination at first), but at least ItemDescription is required
// — a completely empty attach is a no-op that shouldn't have been
// called.
type ParcelLabelInfoInput struct {
	ItemDescription string
	Destination     *string
	SenderName      *string
	SenderMsisdn    *string
	ReceiverName    *string
	ReceiverMsisdn  *string
	ItemType        *string
	WeightRangeKg   *string
	// Measured in the field, carried into the booking rather than
	// re-asked at the counter — see the intake-capture migration on why
	// all three or none.
	LengthCm *float64
	WidthCm  *float64
	HeightCm *float64
	// The company's operating corridor this label prints with. RouteID
	// is set when a real ParcelRoute was picked; RouteLabel is the
	// snapshot actually printed either way — see the schema's own
	// comment on ParcelLabelStock.routeLabel.
	RouteID    *string
	RouteLabel *string
}

// AttachParcelLabelInfo writes structured info onto a pre-printed
// label — item description, destination, sender/receiver name and
// contact, item type, weight range — the moment a handler sticks it on
// a physical item in the field, well before (if ever) that item goes
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
	// Strict PKG-only, same as BookParcel's ExistingCode path: a
	// company self-print has no stock row and can never verify.
	if isForeignLabelCode(code) {
		return &ParcelError{"FOREIGN_LABEL", "That looks like a label printed outside Esoqo. Only Esoqo PKG-… labels scan now — re-print on Esoqo stock"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_label_stock
		SET "itemDescription" = $1, "destination" = $2, "senderName" = $3, "senderMsisdn" = $4,
		    "receiverName" = $5, "receiverMsisdn" = $6, "itemType" = $7, "weightRangeKg" = $8,
		    "lengthCm" = $11, "widthCm" = $12, "heightCm" = $13,
		    "routeId" = $14, "routeLabel" = $15,
		    "infoAttachedAt" = now(), "infoAttachedByStaffId" = $9
		WHERE code = $10 AND "usedAt" IS NULL AND "voidedAt" IS NULL`,
		in.ItemDescription, in.Destination, in.SenderName, in.SenderMsisdn,
		in.ReceiverName, in.ReceiverMsisdn, in.ItemType, in.WeightRangeKg, staffID, code,
		in.LengthCm, in.WidthCm, in.HeightCm, in.RouteID, in.RouteLabel)
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

// ParcelLabelRegisterRow is one label at whatever point of its life it
// has reached — the register's row, as opposed to ParcelLabelStockRow
// which is only ever a still-blank one waiting to be printed.
type ParcelLabelRegisterRow struct {
	Code      string    `json:"code"`
	CreatedAt time.Time `json:"createdAt"`
	// State is derived from the timestamps rather than stored, so there
	// is no status column to drift out of sync with the facts that are
	// the real record. See ParcelLabelState.
	State           string     `json:"state"`
	ItemDescription *string    `json:"itemDescription"`
	Destination     *string    `json:"destination"`
	SenderName      *string    `json:"senderName"`
	SenderMsisdn    *string    `json:"senderMsisdn"`
	ReceiverName    *string    `json:"receiverName"`
	ReceiverMsisdn  *string    `json:"receiverMsisdn"`
	RouteLabel      *string    `json:"routeLabel"`
	InfoAttachedAt  *time.Time `json:"infoAttachedAt"`
	UsedAt          *time.Time `json:"usedAt"`
	VoidedAt        *time.Time `json:"voidedAt"`
	VoidedReason    *string    `json:"voidedReason"`
	BatchID         *string    `json:"batchId"`
	OrgName         *string    `json:"orgName"`
	// Owning company + batch run, so handlers can sign the QR (see
	// fleetqr.SignLabel). Empty for the shared Esoqo pool / pre-batch.
	ParcelOrgID string `json:"parcelOrgId"`
	// Sig — the truncated MAC printed as k= in the QR's URL. Filled in
	// by handlers that know both the secret and the owning org (the
	// stock endpoint and the company register); empty wherever neither
	// was available. See fleetqr.SignLabel.
	Sig string `json:"sig"`
}

// ParcelLabelStates are the register's tabs, each a predicate over the
// same rows — the label lifecycle named, having previously been only
// implied by which query happened to exclude what.
//
// Shared between the listing and its counts for the same reason
// ParcelQueues is: a tab reading "Filled (12)" that opens 9 rows is a
// bug nobody reports and everybody stops trusting.
//
// "voided" deliberately outranks the rest: a withdrawn label that was
// also filled in is withdrawn first and foremost, because that is the
// fact that decides whether anyone may still act on it.
var ParcelLabelStates = map[string]string{
	"blank":  `"voidedAt" IS NULL AND "usedAt" IS NULL AND "infoAttachedAt" IS NULL`,
	"filled": `"voidedAt" IS NULL AND "usedAt" IS NULL AND "infoAttachedAt" IS NOT NULL`,
	"spent":  `"voidedAt" IS NULL AND "usedAt" IS NOT NULL`,
	"voided": `"voidedAt" IS NOT NULL`,
}

// ListParcelLabelRegister lists stock in one lifecycle state.
//
// The gap this closes: the only listing that existed excluded any
// label with info attached, so filling one in made it vanish from the
// product entirely. A handler could write down what a box was and
// where it was going, and no screen would ever show it again — the
// data was write-only. Every state is now listable.
//
// Blank stock is newest-first (you print the freshest strip); every
// other state is oldest-first, because those are worklists and a
// label that has sat filled-but-unbooked for three weeks is the one
// somebody needs to look at.
func ListParcelLabelRegister(
	ctx context.Context, pool *pgxpool.Pool, state string, orgID *string, limit int,
) ([]ParcelLabelRegisterRow, error) {
	// "all" is a UI convenience over the same four predicates — every
	// label whatever its state, newest first, so the Labels register can
	// show empty vs attached in one place. Not part of ParcelLabelStates
	// (which stays the four lifecycle tabs with matching counts).
	var where string
	effectiveState := state
	if state == "all" {
		where = `TRUE`
	} else {
		var ok bool
		where, ok = ParcelLabelStates[state]
		if !ok {
			return nil, &ParcelError{"BAD_INPUT", "Unknown label state"}
		}
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	order := `s."createdAt" ASC`
	if state == "blank" || state == "all" {
		order = `s."createdAt" DESC`
	}
	rows, err := pool.Query(ctx, `
		SELECT s.code, s."createdAt", s."itemDescription", s.destination, s."senderName", s."senderMsisdn",
		       s."receiverName", s."receiverMsisdn",
		       s."infoAttachedAt", s."usedAt", s."voidedAt", s."voidedReason",
		       s."batchId"::text, o.name, s."routeLabel",
		       COALESCE(s."parcelOrgId"::text, ''), COALESCE(s."batchId"::text, '')
		FROM parcel_label_stock s
		LEFT JOIN parcel_org o ON o.id = s."parcelOrgId"
		WHERE (`+where+`)
		  AND s."parcelOrgId" IS NOT DISTINCT FROM $1::uuid
		ORDER BY `+order+`
		LIMIT $2`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelLabelRegisterRow
	for rows.Next() {
		var r ParcelLabelRegisterRow
		var batchRaw string
		if err := rows.Scan(&r.Code, &r.CreatedAt, &r.ItemDescription, &r.Destination, &r.SenderName, &r.SenderMsisdn,
			&r.ReceiverName, &r.ReceiverMsisdn,
			&r.InfoAttachedAt, &r.UsedAt, &r.VoidedAt, &r.VoidedReason,
			&r.BatchID, &r.OrgName, &r.RouteLabel, &r.ParcelOrgID, &batchRaw); err != nil {
			return nil, err
		}
		if state == "all" {
			// Derive the lifecycle tab this row belongs to so the All
			// view can still badge each row.
			switch {
			case r.VoidedAt != nil:
				effectiveState = "voided"
			case r.UsedAt != nil:
				effectiveState = "spent"
			case r.InfoAttachedAt != nil:
				effectiveState = "filled"
			default:
				effectiveState = "blank"
			}
		}
		r.State = effectiveState
		out = append(out, r)
	}
	return out, rows.Err()
}

// CountParcelLabelStates returns how many labels sit in each state, so
// the register's tabs carry numbers that match what they open.
func CountParcelLabelStates(
	ctx context.Context, pool *pgxpool.Pool, orgID *string,
) (map[string]int, error) {
	counts := map[string]int{}
	total := 0
	for state, where := range ParcelLabelStates {
		var n int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM parcel_label_stock
			WHERE (`+where+`) AND "parcelOrgId" IS NOT DISTINCT FROM $1::uuid`, orgID).Scan(&n); err != nil {
			return nil, err
		}
		counts[state] = n
		total += n
	}
	counts["all"] = total
	return counts, nil
}

// ParcelLabelBatchRow is one minted run, as an ops screen lists it —
// how many came off the printer, how many are still usable, and how
// many have been spent or withdrawn since.
type ParcelLabelBatchRow struct {
	BatchID      string    `json:"batchId"`
	CreatedAt    time.Time `json:"createdAt"`
	ParcelOrgID  *string   `json:"parcelOrgId"`
	OrgName      *string   `json:"orgName"`
	Total        int       `json:"total"`
	Live         int       `json:"live"`
	Used         int       `json:"used"`
	Voided       int       `json:"voided"`
	VoidedReason *string   `json:"voidedReason"`
}

// ParcelLabelRouteOption is one of a company's own defined routes, as
// the label-info picker offers it — just enough to display and to
// snapshot onto a label, not the full stop-by-stop Route dbx.ListRoutes
// returns for the company's own route-management screen.
type ParcelLabelRouteOption struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Code   *string `json:"code"`
	Active bool    `json:"active"`
}

// AdminListParcelRoutes — a company's active routes, for admin to pick
// from when attaching a route to a label. Unlike ListRoutes (the
// company's own self-service route manager) this never assembles
// stops: a label only ever prints the route's name, so there is
// nothing here for a stop list to serve.
func AdminListParcelRoutes(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]ParcelLabelRouteOption, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, name, code, active
		FROM parcel_route
		WHERE "parcelOrgId" = $1
		ORDER BY active DESC, name`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ParcelLabelRouteOption{}
	for rows.Next() {
		var r ParcelLabelRouteOption
		if err := rows.Scan(&r.ID, &r.Name, &r.Code, &r.Active); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListParcelLabelBatches — the pads, newest first, scoped to one
// company (nil for the Esoqo pool).
//
// Grouped rather than stored as its own table: a batch has no
// properties of its own beyond the labels in it, and a `parcel_label_
// batch` row would be a second place for "who was this printed for"
// to live and drift from the labels it supposedly describes.
//
// Pre-batch stock (batchId NULL — see the ownership migration) is
// excluded rather than lumped into one phantom pad, for the same
// reason the migration declined to backfill it.
func ListParcelLabelBatches(
	ctx context.Context, pool *pgxpool.Pool, orgID *string, limit int,
) ([]ParcelLabelBatchRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := pool.Query(ctx, `
		SELECT s."batchId"::text, min(s."createdAt"), s."parcelOrgId"::text, max(o.name),
		       count(*),
		       count(*) FILTER (WHERE s."usedAt" IS NULL AND s."voidedAt" IS NULL),
		       count(*) FILTER (WHERE s."usedAt" IS NOT NULL),
		       count(*) FILTER (WHERE s."voidedAt" IS NOT NULL),
		       max(s."voidedReason")
		FROM parcel_label_stock s
		LEFT JOIN parcel_org o ON o.id = s."parcelOrgId"
		WHERE s."batchId" IS NOT NULL
		  AND s."parcelOrgId" IS NOT DISTINCT FROM $1::uuid
		GROUP BY s."batchId", s."parcelOrgId"
		ORDER BY min(s."createdAt") DESC
		LIMIT $2`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelLabelBatchRow
	for rows.Next() {
		var r ParcelLabelBatchRow
		if err := rows.Scan(&r.BatchID, &r.CreatedAt, &r.ParcelOrgID, &r.OrgName,
			&r.Total, &r.Live, &r.Used, &r.Voided, &r.VoidedReason); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// VoidParcelLabelBatch withdraws every still-usable label in a batch —
// the "a pad walked out of the branch" button, one statement rather
// than one call per sticker.
//
// Only live labels are touched. An already-spent code is deliberately
// left alone: it is bound to a real parcel that is somewhere in the
// world being delivered, and retro-voiding its label would invalidate
// the tracking code on a box in transit to punish a theft that
// happened after it shipped.
//
// [orgID] scopes the act to the caller's own stock, so voiding can
// never reach across into another company's pad.
func VoidParcelLabelBatch(
	ctx context.Context, pool *pgxpool.Pool, batchID string, orgID *string, reason string, staffID *string,
) (voided int, err error) {
	if reason == "" {
		return 0, &ParcelError{"BAD_INPUT", "Say why this batch is being withdrawn"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_label_stock
		SET "voidedAt" = now(), "voidedReason" = $1, "voidedByStaffId" = $2
		WHERE "batchId" = $3::uuid
		  AND "parcelOrgId" IS NOT DISTINCT FROM $4::uuid
		  AND "usedAt" IS NULL AND "voidedAt" IS NULL`,
		reason, staffID, batchID, orgID)
	if err != nil {
		return 0, err
	}
	n := int(tag.RowsAffected())
	if n == 0 {
		// Either no such batch, not this company's, or every label in it
		// was already spent or withdrawn. One message for all three: a
		// caller poking at batch ids shouldn't learn which.
		return 0, &ParcelError{"NOT_FOUND", "No usable labels in that batch"}
	}
	return n, nil
}

// VoidParcelLabelsByCodes withdraws an explicit selection of labels —
// the "discard these unused stickers / throw away this handful" path,
// as opposed to VoidParcelLabelBatch's whole-pad recall.
//
// Only live labels are touched: already-spent codes stay bound to the
// parcels moving in the world, already-withdrawn ones are simply not
// counted. Unknown codes are ignored rather than errors, so a stale
// selection (someone else voided one concurrently) still voids the
// rest. [orgID] scopes exactly like the batch variant: nil is the
// shared Esoqo pool, non-nil is one company's pad, and a code from
// another pad is never touched.
// DeleteParcelLabelsByCodes permanently removes labels that are still
// fully blank — never attached, never used, never withdrawn. Unlike
// VoidParcelLabelsByCodes this is a real DELETE, for genuinely
// mistaken or test batches an admin wants gone rather than recorded as
// withdrawn; anything with history on it (attached, spent or already
// voided) is silently excluded from the match rather than erred on, so
// a mixed selection deletes what it can and leaves the rest for
// Withdraw.
//
// [orgID] scopes the act to the caller's own stock, same as void.
func DeleteParcelLabelsByCodes(
	ctx context.Context, pool *pgxpool.Pool, codes []string, orgID *string,
) (deleted int, err error) {
	clean := make([]string, 0, len(codes))
	seen := map[string]struct{}{}
	for _, c := range codes {
		u := strings.ToUpper(strings.TrimSpace(c))
		if u == "" {
			continue
		}
		if _, dup := seen[u]; dup {
			continue
		}
		seen[u] = struct{}{}
		clean = append(clean, u)
	}
	if len(clean) == 0 {
		return 0, &ParcelError{"BAD_INPUT", "Select at least one label"}
	}
	if len(clean) > 200 {
		return 0, &ParcelError{"BAD_INPUT", "Delete at most 200 labels at once"}
	}
	tag, err := pool.Exec(ctx, `
		DELETE FROM parcel_label_stock
		WHERE upper(code) = ANY($1)
		  AND "parcelOrgId" IS NOT DISTINCT FROM $2::uuid
		  AND "usedAt" IS NULL AND "voidedAt" IS NULL AND "infoAttachedAt" IS NULL`,
		clean, orgID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// DeleteParcelLabelBatch permanently removes every still-blank label in
// a batch. Same "touch only what's untouched" rule as
// DeleteParcelLabelsByCodes: attached, spent or already-voided rows in
// the batch are left exactly where they are.
func DeleteParcelLabelBatch(
	ctx context.Context, pool *pgxpool.Pool, batchID string, orgID *string,
) (deleted int, err error) {
	tag, err := pool.Exec(ctx, `
		DELETE FROM parcel_label_stock
		WHERE "batchId" = $1::uuid
		  AND "parcelOrgId" IS NOT DISTINCT FROM $2::uuid
		  AND "usedAt" IS NULL AND "voidedAt" IS NULL AND "infoAttachedAt" IS NULL`,
		batchID, orgID)
	if err != nil {
		return 0, err
	}
	n := int(tag.RowsAffected())
	if n == 0 {
		return 0, &ParcelError{"NOT_FOUND", "No deletable labels in that batch"}
	}
	return n, nil
}

func VoidParcelLabelsByCodes(
	ctx context.Context, pool *pgxpool.Pool, codes []string, orgID *string, reason string, staffID *string,
) (voided int, err error) {
	if reason == "" {
		return 0, &ParcelError{"BAD_INPUT", "Say why these labels are being withdrawn"}
	}
	clean := make([]string, 0, len(codes))
	seen := map[string]struct{}{}
	for _, c := range codes {
		u := strings.ToUpper(strings.TrimSpace(c))
		if u == "" {
			continue
		}
		if _, dup := seen[u]; dup {
			continue
		}
		seen[u] = struct{}{}
		clean = append(clean, u)
	}
	if len(clean) == 0 {
		return 0, &ParcelError{"BAD_INPUT", "Select at least one label"}
	}
	if len(clean) > 200 {
		return 0, &ParcelError{"BAD_INPUT", "Withdraw at most 200 labels at once"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_label_stock
		SET "voidedAt" = now(), "voidedReason" = $1, "voidedByStaffId" = $2
		WHERE upper(code) = ANY($3)
		  AND "parcelOrgId" IS NOT DISTINCT FROM $4::uuid
		  AND "usedAt" IS NULL AND "voidedAt" IS NULL`,
		reason, staffID, clean, orgID)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// GetParcelLabelStockInfo reads back whatever AttachParcelLabelInfo
// last wrote, so an edit form can load before it saves.
//
// This exists because AttachParcelLabelInfo overwrites rather than
// merges: without a read, a form that opens blank and re-submits every
// field silently erases the six a handler isn't currently editing.
// The write contract is the right one — it's the missing read that
// made it dangerous.
//
// Three outcomes, deliberately distinct: a ParcelError for a code that
// isn't stock at all (or is already spent, which AttachParcelLabelInfo
// would refuse anyway — better to say so before the handler types than
// after); (nil, nil) for a real, still-blank label, which is the
// ordinary first-attach case and not an error; and a populated struct
// for one that already carries info.
func GetParcelLabelStockInfo(ctx context.Context, pool *pgxpool.Pool, code string) (*ParcelLabelInfo, error) {
	var used bool
	var info ParcelLabelInfo
	var itemDescription *string
	var attachedAt *time.Time
	err := pool.QueryRow(ctx, `
		SELECT "usedAt" IS NOT NULL, "itemDescription", destination, "senderName", "senderMsisdn",
		       "receiverName", "receiverMsisdn", "itemType", "weightRangeKg", "infoAttachedAt",
		       "lengthCm"::float8, "widthCm"::float8, "heightCm"::float8,
		       "routeId"::text, "routeLabel"
		FROM parcel_label_stock WHERE code = $1`, code).
		Scan(&used, &itemDescription, &info.Destination, &info.SenderName, &info.SenderMsisdn,
			&info.ReceiverName, &info.ReceiverMsisdn, &info.ItemType, &info.WeightRangeKg, &attachedAt,
			&info.LengthCm, &info.WidthCm, &info.HeightCm,
			&info.RouteID, &info.RouteLabel)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That label code isn't a known pre-printed label"}
	}
	if err != nil {
		return nil, err
	}
	if used {
		return nil, &ParcelError{"BAD_INPUT", "That label is already bound to a booked parcel — info can't be attached to it anymore"}
	}
	if itemDescription == nil {
		return nil, nil
	}
	info.ItemDescription = *itemDescription
	if attachedAt != nil {
		info.AttachedAt = *attachedAt
	}
	return &info, nil
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
	// CarrierOrgName — the courier company carrying this parcel, when
	// one is (nil for Esoqo-operated dispatch). Lets the receiver's
	// pickup SMS say "via Dreamline" instead of a bare "on its way",
	// same reasoning every other message here already names who/what.
	CarrierOrgName *string
	// ParcelOrgID — nil for Esoqo-operated dispatch. Gates the
	// dispatch-summary text to the company's own team (see
	// notify.ParcelOrgDispatchSummary): only a courier company has a
	// "team" to summarize a departure to.
	ParcelOrgID *string
}

func GetParcelNotifyInfo(ctx context.Context, pool *pgxpool.Pool, code string) (*ParcelNotifyInfo, error) {
	var v ParcelNotifyInfo
	err := pool.QueryRow(ctx, `
		SELECT p."senderName", p."senderMsisdn", p."receiverName", p."receiverMsisdn", p."originLabel", p."destinationLabel",
		       p."deliveredAt", p."priceKes"::text, p."mpesaReceiptCode", COALESCE(pr."knownAs", pr."officialName"), p."deliveryCode",
		       po.name, p."parcelOrgId"::text
		FROM parcel p
		LEFT JOIN person pr ON pr."partyId" = p."currentHolderPartyId"
		LEFT JOIN parcel_org po ON po.id = p."parcelOrgId"
		WHERE p.code = $1`, code).
		Scan(&v.SenderName, &v.SenderMsisdn, &v.ReceiverName, &v.ReceiverMsisdn, &v.OriginLabel, &v.DestinationLabel,
			&v.DeliveredAt, &v.PriceKes, &v.MpesaReceiptCode, &v.CurrentHolderName, &v.DeliveryCode, &v.CarrierOrgName,
			&v.ParcelOrgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// CountOrgParcelsDispatchedToday — how many of this company's parcels
// have left its station today, for the team dispatch-summary text (see
// notify.ParcelOrgDispatchSummary). Counts the first handoff
// (fromPartyId IS NULL — the same "genuine first pickup" moment
// ScanHandoff's own wasFirstPickup gates its SMS on) rather than the
// parcel's own createdAt, so a parcel booked yesterday and only
// collected this morning counts today, not yesterday.
// Counted in Africa/Nairobi, not the server's UTC: "today" for a desk
// in Nairobi rolls over at local midnight, and date_trunc on a UTC now()
// would have rolled it at 03:00 EAT — putting every parcel dispatched
// between midnight and 3am on the previous day's tally.
func CountOrgParcelsDispatchedToday(ctx context.Context, pool *pgxpool.Pool, orgID string) (int, error) {
	var n int
	err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM parcel_handoff ph
		JOIN parcel p ON p.id = ph."parcelId"
		WHERE p."parcelOrgId" = $1 AND ph."fromPartyId" IS NULL
		  AND ph."createdAt" >= date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi')
		                        AT TIME ZONE 'Africa/Nairobi'`, orgID).Scan(&n)
	return n, err
}

// ListOrgDispatchDeskMsisdns — who on this company's team actually
// hears about a departure.
//
// Dispatch-capable roles only (DISPATCHER/MANAGER — see
// authsvc.ParcelStaffCapabilities, where CapParcelOrgDispatch is
// exactly the "decides where work goes" tier). It used to be every
// active staff member, which meant every rider on the roster got a text
// about a box they had nothing to do with: a 20-rider company turned
// one scan into 20 messages, all of them drawn against the same global
// daily SMS ceiling that OTP delivery depends on (see
// authsvc.chargeSmsBudget). A dispatch summary is a desk's tool, and
// the desk is who gets it.
//
// Still party/msisdn-gated: an office-only manager with no partyId (see
// ParcelOrgStaff's own comment) simply isn't in this list; there's no
// number to text.
func ListOrgDispatchDeskMsisdns(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT DISTINCT pr.msisdn
		FROM parcel_org_staff st
		JOIN person pr ON pr."partyId" = st."partyId"
		WHERE st."orgId" = $1 AND st.active AND pr.msisdn IS NOT NULL
		  AND st.role IN ('DISPATCHER', 'MANAGER')`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// canTakeParcelCustody — whether this party is someone the platform
// recognises as a carrier for this particular parcel.
//
// This exists because the PKG- code is deliberately a *public* bearer
// credential: it's printed on the outside of the box, and
// GetParcelStatus is guest-safe precisely so anyone who scans it can
// track the parcel without an account. A credential that anyone may
// read cannot also be the thing that proves possession — but ScanHandoff
// used to accept it as exactly that from any signed-in party, so
// photographing a label in a matatu was enough to become
// currentHolderPartyId, and since DeliverParcel requires the current
// holder, enough to then close the parcel out.
//
// Entitlement is therefore a property of the scanner, not of the code:
//   - an ACTIVE ParcelCourier (the Esoqo-operated fleet and gig side,
//     including conductors who carry parcels on their own trips), or
//   - active staff of the company actually carrying this parcel, which
//     is what makes a front desk's walk-in intake scan work, or
//   - the collector an admin specifically assigned (AssignParcelCollector
//     may name a party who isn't otherwise a registered courier), or
//   - staffOverride — Esoqo ops, decided by capability at the handler
//     (see handleScanParcelHandoff), never asserted by a client. Same
//     shape DeliverParcel's allowCodeless takes, and for the same
//     reason: dbx has no business re-deriving an authorization decision
//     the auth layer already made.
//
// Note what this does NOT restrict: which leg, or which company. An
// interline handoff from one carrier's rider to another's is still a
// legitimate scan — the rule is "a known carrier", not "the carrier we
// predicted".
func canTakeParcelCustody(ctx context.Context, tx pgx.Tx, partyID string, parcelOrgID, assignedCollector *string, staffOverride bool) (bool, error) {
	if staffOverride {
		return true, nil
	}
	if assignedCollector != nil && *assignedCollector == partyID {
		return true, nil
	}
	var entitled bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM parcel_courier
			WHERE "partyId" = $1 AND status = 'ACTIVE'
		) OR EXISTS(
			SELECT 1 FROM parcel_org_staff
			WHERE "partyId" = $1 AND active
			  AND $2::uuid IS NOT NULL AND "orgId" = $2::uuid
		)`, partyID, parcelOrgID).Scan(&entitled)
	return entitled, err
}

// ScanHandoff is a driver/handler scanning a parcel into their own
// custody.
//
// Who may scan is canTakeParcelCustody's decision — see that function
// on why possession of the code alone was never enough. On top of that,
// the very first pickup (BOOKED→PICKED_UP) is additionally gated by
// AssignParcelCollector's assignment, when one exists: an admin who
// scheduled a specific collector meant that scheduling to be enforced,
// not just a courtesy SMS. With nobody assigned yet, the first entitled
// scanner takes it, matching the physical reality of an unscheduled
// walk-in collection.
//
// Idempotent: scanning a code you already hold is a no-op, not an
// error, so a nervous double-scan on a slow network never fails.
// wasFirstIntake tells the caller whether this was the first physical
// receipt (still BOOKED) — that's the one moment handlers_parcels.go
// sends the intake SMS; every later leg (PICKED_UP/IN_TRANSIT) and every
// replayed scan stays silent.
//
// The whole read-check-write runs in one transaction with the parcel row
// locked FOR UPDATE. Custody is the one thing in this file that two
// people genuinely race for — two couriers scanning the same label at
// the same moment — and the previous shape read the row, decided, then
// issued two independent writes, so both scanners could pass the
// "assigned to another collector" check against the same stale row and
// both take it. Locking also makes the parcel_handoff insert atomic with
// the status change: that table is the append-only custody chain a
// dispute is settled from, and a leg missing from it because the second
// statement failed on its own is worse than a failed scan.
func ScanHandoff(ctx context.Context, pool *pgxpool.Pool, code, scannedByPartyID, staffActorID string, staffOverride bool) (status string, wasFirstIntake bool, resolvedCode string, err error) {
	// An Esoqo staff session has no linked Party (StaffUser carries no
	// partyId), so a counter confirmation arrives with an empty
	// scannedByPartyID. That is a legitimate counter receipt, not a
	// missing actor: the capability-resolved staffOverride is what
	// authorizes it, and staffActorID records which person confirmed it.
	// Only a caller with neither a Party nor the override is refused —
	// the pre-existing hole was rejecting this case before ever looking
	// at staffOverride, which left every admin-counter booking stuck at
	// AWAITING_INTAKE forever.
	if scannedByPartyID == "" && !staffOverride {
		return "", false, "", &ParcelError{"FORBIDDEN", "Sign in to accept a parcel"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", false, "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var parcelID, currentStatus, originMethod string
	var currentHolder, assignedCollector, parcelOrgID *string
	// resolvedCode is the parcel's REAL code, whichever reference was
	// used to find it. Everything downstream — the notify lookup, the
	// SMS pair, the label the clerk prints — has to key off this and not
	// off the caller's input, or a ticket-number intake silently finds
	// no row and nobody is texted anything.
	// Matched by the real code or by serviceTicketNumber, same as
	// GetParcelStatus and for the sharper version of its reason: before
	// this very scan, the ticket number is the ONLY reference the sender
	// was ever given (see Parcel.serviceTicketNumber), so it is the only
	// thing they can hand a clerk at the counter. A code-only lookup here
	// made the front desk's manual entry unusable for exactly the walk-in
	// case it exists to serve — and since this scan is what fires the
	// sender/receiver SMS pair, failing to find the row meant nobody
	// heard anything at all.
	//
	// Accepting it costs no authority: possession of either reference
	// stopped being sufficient when canTakeParcelCustody landed below.
	// The scanner still has to be a recognised carrier.
	err = tx.QueryRow(ctx, `
		SELECT id, code, status::text, "currentHolderPartyId", "assignedCollectorPartyId", "parcelOrgId"::text, "originMethod"::text
		FROM parcel WHERE code = $1 OR "serviceTicketNumber" = $1
		FOR UPDATE`, code).
		Scan(&parcelID, &resolvedCode, &currentStatus, &currentHolder, &assignedCollector, &parcelOrgID, &originMethod)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", false, "", err
	}
	if currentStatus == "DELIVERED" {
		return "", false, "", &ParcelError{"ALREADY_DELIVERED", "This parcel has already been delivered"}
	}
	if currentStatus == "DRAFT_PENDING_PAYMENT" {
		return "", false, "", &ParcelError{"BAD_INPUT", "This parcel hasn't been paid for yet"}
	}
	// Both closed states, and neither was rejected before these statuses
	// existed — a cancelled parcel was simply unreachable, so the guard
	// above never needed to name it. A returned parcel is reachable
	// (it was physically in someone's hands moments ago), so scanning
	// one has to fail loudly rather than quietly restart its journey.
	if currentStatus == "CANCELLED" || currentStatus == "RETURNED_TO_SENDER" {
		return "", false, "", &ParcelError{"BAD_INPUT", "This parcel's journey is already closed"}
	}
	// Checked before entitlement: a replayed scan by whoever already
	// holds it is a no-op whatever their current standing, so a courier
	// suspended mid-journey doesn't start getting errors on a parcel
	// that's already in their hands. A no-Party staff receipt has no
	// holder to replay against.
	if scannedByPartyID != "" && currentHolder != nil && *currentHolder == scannedByPartyID {
		return currentStatus, false, resolvedCode, nil // already holding it — replayed scan
	}

	entitled, err := canTakeParcelCustody(ctx, tx, scannedByPartyID, parcelOrgID, assignedCollector, staffOverride)
	if err != nil {
		return "", false, "", err
	}
	if !entitled {
		return "", false, "", &ParcelError{"FORBIDDEN", "Only a registered courier or this company's own staff can take a parcel"}
	}
	// The assignment gate only binds a real carrier taking custody. A
	// staff counter receipt with no Party is not that carrier competing
	// for the parcel — it is the desk that already has the box.
	if scannedByPartyID != "" && currentStatus == "BOOKED" && assignedCollector != nil && *assignedCollector != scannedByPartyID {
		return "", false, "", &ParcelError{"FORBIDDEN", "This parcel is assigned to another collector"}
	}

	wasFirstIntake = currentStatus == "BOOKED"
	// A first receipt is a counter drop-off when it is a self-drop-off
	// (the sender walked it into a station) or a staff confirmation with
	// no Party (an Esoqo desk). A scheduled-pickup first scan is a
	// courier collecting at the sender's door and stays PICKED_UP.
	atCounter := currentStatus == "BOOKED" &&
		(originMethod == "SELF_DROPOFF" || (staffOverride && scannedByPartyID == ""))
	nextStatus := nextHandoffStatus(currentStatus, atCounter)

	if scannedByPartyID == "" {
		// No Party to attribute custody to, so currentHolderPartyId is
		// deliberately left alone: the box is at the counter, not with
		// any carrier yet, and the next real carrier scan takes it from
		// here. intakeConfirmedByStaffId is the person to hold to it.
		// The receipt is still written to parcel_handoff with a NULL
		// holder so the custody chain and the public timeline both show
		// it as the first real event.
		if _, err := tx.Exec(ctx, `
			UPDATE parcel SET status = $1::"ParcelStatus",
				"intakeConfirmedAt" = CASE WHEN $2 THEN now() ELSE "intakeConfirmedAt" END,
				"intakeConfirmedByStaffId" = COALESCE(NULLIF($3, '')::uuid, "intakeConfirmedByStaffId")
			WHERE id = $4`,
			nextStatus, wasFirstIntake, staffActorID, parcelID); err != nil {
			return "", false, "", err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO parcel_handoff (id, "parcelId", "fromPartyId", "toPartyId", "createdAt", status)
			VALUES (gen_random_uuid(), $1, $2, NULL, now(), $3::"ParcelStatus")`,
			parcelID, currentHolder, nextStatus); err != nil {
			return "", false, "", err
		}
	} else {
		if _, err := tx.Exec(ctx, `
			UPDATE parcel SET status = $1::"ParcelStatus", "currentHolderPartyId" = $2,
				"intakeConfirmedAt" = CASE WHEN $4 THEN now() ELSE "intakeConfirmedAt" END
			WHERE id = $3`,
			nextStatus, scannedByPartyID, parcelID, wasFirstIntake); err != nil {
			return "", false, "", err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO parcel_handoff (id, "parcelId", "fromPartyId", "toPartyId", "createdAt", status)
			VALUES (gen_random_uuid(), $1, $2, $3, now(), $4::"ParcelStatus")`,
			parcelID, currentHolder, scannedByPartyID, nextStatus); err != nil {
			return "", false, "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", false, "", err
	}
	return nextStatus, wasFirstIntake, resolvedCode, nil
}

// nextHandoffStatus — a first scan (still BOOKED) is either a counter
// receipt or a courier pickup, and every scan after that is another leg
// of the journey. Pure so it's directly testable without a DB fixture,
// same pattern validDineInStatus/crewOwnsTrip already use elsewhere.
//
// atCounter is true for a self-drop-off first scan or an Esoqo staff
// counter confirmation (see ScanHandoff); it produces
// RECEIVED_AT_COUNTER so a box on a station desk reads honestly instead
// of claiming a courier has collected it. A courier scanning a parcel
// already at a counter moves it to PICKED_UP.
//
// FAILED_DELIVERY and HELD_AT_AGENT both fall through to IN_TRANSIT on
// purpose: a parcel that failed at the door or was left on a shop shelf
// and is now being scanned by someone new is, by definition, moving
// again. Re-deriving IN_TRANSIT is what puts a re-attempt back on the
// normal timeline instead of stranding it in a failure state forever.
func nextHandoffStatus(current string, atCounter bool) string {
	switch current {
	case "BOOKED":
		if atCounter {
			return "RECEIVED_AT_COUNTER"
		}
		return "PICKED_UP"
	case "RECEIVED_AT_COUNTER":
		return "PICKED_UP"
	default:
		return "IN_TRANSIT"
	}
}

// DeliverProof is the evidence a courier captures at the door. Every
// field is optional so an older client still delivers successfully —
// it just leaves a weaker record, the same graceful-degradation rule
// Parcel.originZoneId follows.
//
// ReceivedByName is the single most valuable field here and the one the
// code-only flow threw away entirely: whoever actually took the parcel
// is frequently not the receiver (a watchman, a shop attendant, a
// neighbour), and "who has it" is the whole substance of a lost-parcel
// dispute. A delivery code proves the receiver *knew a code*; it never
// proved the parcel physically changed hands, or where.
type DeliverProof struct {
	PhotoURL       *string
	Lat            *float64
	Lng            *float64
	ReceivedByName *string
	// Method — DELIVERY_CODE | AGENT_COLLECTION | STAFF_OVERRIDE |
	// RECEIVER_OTP. Set by DeliverParcel itself, not the caller: it's a
	// statement about which check actually passed, and a client that
	// could assert it would be asserting its own authorization.
	Method string
}

// DeliverParcel is the terminal handoff — proof of receipt via the
// deliveryCode only the sender was shown, checked case-insensitively
// (see ConfirmOrderCollected's own comment on why: a human reading a
// code aloud won't reliably preserve case). Only the parcel's current
// holder can deliver it — a courier who never scanned custody can't
// short-circuit the chain.
//
// allowCodeless is the deliberate escape hatch for the case that used
// to dead-end the whole flow: the receiver is standing right there and
// has genuinely lost their code. It is never client-assertable — the
// handler only sets it for a caller with the parcels.override
// capability — and it demands the two things that make a code-less
// handover auditable instead of merely convenient: a photo and the name
// of whoever signed for it. See handleDeliverParcel.
//
// otpVerified is the same shape of pre-decided fact: the handler has
// already run authsvc.OtpService.VerifyOtp against the parcel's own
// receiverMsisdn (never a number the request supplies) before calling
// this, so by the time it arrives here it is simply "yes, whoever is
// standing here proved control of the number on file" — an alternative
// route to the same confidence a matching deliveryCode gives, offered
// alongside it rather than instead of it. A bare boolean, not a raw
// OTP code, for the same reason allowCodeless is a boolean: this
// function has no business re-deriving an authorization decision
// another layer already made.
// receiverSelfConfirm is the third of the same shape, and the only one
// that changes who may call at all. The handler sets it after
// VerifyReceiverCode passed and a receiver token was spent, which means
// the caller is not staff and is holding nothing — so this branch, and
// only this branch, skips the current-holder check below.
//
// That is a real weakening, and it is fenced accordingly: refused for
// any status but HELD_AT_AGENT, and for any parcel with COD still
// outstanding. A parcel on an agent's shelf is collected in person at a
// shop with somebody behind the counter, which is the same fact the
// AGENT_COLLECTION branch already leans on. A parcel in transit has no
// such witness, and letting whoever holds the label and the code close
// it from anywhere would make the weakest proof in the system also the
// easiest one to reach. Courier pay is held rather than accrued for the
// same reason — see the tail of this function.
func DeliverParcel(ctx context.Context, pool *pgxpool.Pool, code, deliveryCode, deliveredByPartyID string, proof DeliverProof, allowCodeless, otpVerified, receiverSelfConfirm bool) error {
	var parcelID, status, storedDeliveryCode, codStatus string
	var currentHolder, codAmount *string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "deliveryCode", "currentHolderPartyId",
		       "codAmountKes"::text, "codStatus"
		FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &status, &storedDeliveryCode, &currentHolder, &codAmount, &codStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if status == "DELIVERED" {
		return &ParcelError{"ALREADY_DELIVERED", "This parcel has already been delivered"}
	}
	if status == "DRAFT_PENDING_PAYMENT" || status == "BOOKED" || status == "RECEIVED_AT_COUNTER" {
		return &ParcelError{"BAD_INPUT", "This parcel hasn't been picked up yet"}
	}
	if status == "CANCELLED" || status == "RETURNED_TO_SENDER" {
		return &ParcelError{"BAD_INPUT", "This parcel's journey is already closed"}
	}
	// The receiver closing their own collection is the one caller who is
	// not holding the parcel by definition — they are standing at the
	// counter it is sitting on. Every other path still has to prove
	// custody: a courier who never scanned the parcel cannot
	// short-circuit the chain.
	if !receiverSelfConfirm && (currentHolder == nil || *currentHolder != deliveredByPartyID) {
		return &ParcelError{"FORBIDDEN", "You aren't holding this parcel"}
	}
	if receiverSelfConfirm {
		// Both checks here rather than in the method switch below, so
		// they are stated before any authentication branch can be taken
		// and cannot be reached around by a caller who also happens to
		// know the code.
		if status != "HELD_AT_AGENT" {
			return &ParcelError{"BAD_INPUT", "You can only confirm collection once the parcel is waiting at a pickup point"}
		}
		// COD is the buyer's money changing hands in person. A parcel
		// closed from a phone collects nothing, and marking it delivered
		// would strand the seller's goods money in PENDING behind a
		// parcel the system believes is finished. Shares codIsOutstanding
		// with CanReceiverSelfConfirm so the button and the write cannot
		// disagree about what "COD due" means.
		if codIsOutstanding(codAmount, codStatus) {
			return &ParcelError{"COD_DUE", "There's cash to pay on this parcel — the agent has to complete the handover"}
		}
	}

	// A parcel sitting on an agent's shelf is collected by the receiver
	// in person at the shop, where the agent has already identified
	// them — that's what the shop leg is for. The delivery code still
	// works and is still preferred; this just stops a receiver who
	// walked to the shop from being turned away because the SMS with
	// their code never arrived.
	codeMatches := strings.EqualFold(strings.TrimSpace(deliveryCode), storedDeliveryCode)
	switch {
	// Checked before the plain code match, because a self-confirming
	// receiver has necessarily just produced a matching code too — and
	// recording that as DELIVERY_CODE would claim a courier stood there
	// and took it, which is exactly the fact this method exists to say
	// did not happen.
	case receiverSelfConfirm:
		proof.Method = "RECEIVER_SELF_AGENT"
	case codeMatches:
		proof.Method = "DELIVERY_CODE"
	case status == "HELD_AT_AGENT" && strings.TrimSpace(deliveryCode) == "":
		proof.Method = "AGENT_COLLECTION"
		if proof.ReceivedByName == nil || strings.TrimSpace(*proof.ReceivedByName) == "" {
			return &ParcelError{"BAD_INPUT", "Write down who collected it"}
		}
	case otpVerified:
		// The OTP alone is the identity proof — it already went to the
		// one number on the parcel, which is a stronger claim than "this
		// person is holding a printed code" ever was. No further field is
		// required, unlike the two codeless branches below, which have
		// no such external confirmation to lean on.
		proof.Method = "RECEIVER_OTP"
	case allowCodeless && strings.TrimSpace(deliveryCode) == "":
		proof.Method = "STAFF_OVERRIDE"
		if proof.ReceivedByName == nil || strings.TrimSpace(*proof.ReceivedByName) == "" {
			return &ParcelError{"BAD_INPUT", "A hand-over without a code needs the name of whoever received it"}
		}
		if proof.PhotoURL == nil || strings.TrimSpace(*proof.PhotoURL) == "" {
			return &ParcelError{"BAD_INPUT", "A hand-over without a code needs a photo"}
		}
	default:
		return &ParcelError{"WRONG_CODE", "That delivery code doesn't match"}
	}

	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET
			status = 'DELIVERED', "deliveredAt" = now(),
			"podPhotoUrl" = $1, "podLat" = $2, "podLng" = $3,
			"podReceivedByName" = $4, "podMethod" = $5
		WHERE id = $6`,
		proof.PhotoURL, proof.Lat, proof.Lng, proof.ReceivedByName, proof.Method, parcelID); err != nil {
		return err
	}
	// The job is done, so the courier has earned. Deliberately after the
	// delivery is committed and deliberately non-fatal (see
	// AccrueCourierEarnings): the parcel has physically changed hands by
	// now, and failing the whole call over a pay calculation would leave
	// a delivered parcel recorded as undelivered — far worse than an
	// accrual an admin can replay.
	//
	// Swallowed rather than returned, which is what makes that comment
	// true. Returning it sent a ledger hiccup straight to the courier's
	// screen as a failed delivery on a parcel already marked DELIVERED,
	// so the retry came back ALREADY_DELIVERED and neither the sender's
	// nor the receiver's confirmation SMS ever fired. Logged, because an
	// unpaid accrual still needs someone to notice and replay it.
	//
	// Except on a self-confirmed collection, where the accrual waits.
	// Everywhere else a member of staff was physically present to assert
	// the parcel changed hands, which is what makes an irreversible
	// accrual safe. Here nobody was, so the pay sits behind a hold that
	// staff (or a later sweep) release deliberately — the window in
	// which a fraudulent close can still be caught before money moves.
	if receiverSelfConfirm {
		if _, err := pool.Exec(ctx, `
			UPDATE parcel SET "courierEarningsHeldUntil" = now() + interval '24 hours'
			WHERE id = $1`, parcelID); err != nil {
			log.Printf("parcel %s self-confirmed but the earnings hold failed to set: %v", parcelID, err)
		}
		// Non-fatal for the same reason the accrual is: the parcel has
		// physically changed hands, and failing the call over a history
		// row would report a delivered parcel as undelivered.
		if err := AppendParcelEvent(ctx, pool, parcelEventInput{
			ParcelID: parcelID, Kind: "RECEIVER_SELF_CONFIRMED", Severity: "INFO",
			PublicLabel: strPtr("Receiver confirmed collection"),
			StaffDetail: "Collected at the pickup point and confirmed by the receiver — no staff witness",
			ActorType:   "GUEST",
		}); err != nil {
			log.Printf("parcel %s self-confirmed but the event row failed: %v", parcelID, err)
		}
		if err := AppendParcelEvent(ctx, pool, parcelEventInput{
			ParcelID: parcelID, Kind: "COURIER_EARNINGS_HELD", Severity: "INFO",
			StaffDetail: "Courier earnings held 24h pending review of a self-confirmed delivery",
			ActorType:   "SYSTEM",
		}); err != nil {
			log.Printf("parcel %s earnings-hold event failed: %v", parcelID, err)
		}
		return nil
	}
	if err := AccrueCourierEarnings(ctx, pool, parcelID); err != nil {
		log.Printf("parcel %s delivered but courier earnings accrual failed (replayable): %v", parcelID, err)
	}
	return nil
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
	// DeliveryAttempts/LastAttemptReason only populate on the holder's
	// own list (see ListParcelsHeld) — a sender's list shows the same
	// information through the status timeline instead, and a courier is
	// the only person who can act on "this one has already failed twice".
	DeliveryAttempts  int
	LastAttemptReason *string
	// COD terms, on the holder's list only — a courier standing at a
	// door needs to know what to ask for before they knock, and the
	// delivery screen refuses to close a COD parcel without recording
	// what was actually paid.
	CodAmountKes          *string
	CodStatus             string
	CodCollectDeliveryFee bool
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
//
// FAILED_DELIVERY and HELD_AT_AGENT are in the filter because custody
// genuinely hasn't moved in either case — a courier who failed at the
// door still has the parcel in their bag, and an agent's shelf is that
// agent's custody. Leaving them out (the obvious reading of "not yet
// delivered") would have made a parcel vanish from the one screen its
// holder uses to act on it, which is the worst possible outcome for the
// exact parcels that most need action.
//
// Ordered by attempt count first so the parcels that have already
// failed float to the top of the courier's list rather than aging
// quietly at the bottom of a FIFO queue.
func ListParcelsHeld(ctx context.Context, pool *pgxpool.Pool, holderPartyID string) ([]ParcelRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, code, "senderName", "receiverName", "originLabel", "destinationLabel", status::text,
		       "createdAt", "deliveredAt", "deliveryAttempts", "lastAttemptReason",
		       "codAmountKes"::text, "codStatus", "codCollectDeliveryFee", "priceKes"::text
		FROM parcel
		WHERE "currentHolderPartyId" = $1
		  AND status IN ('PICKED_UP', 'IN_TRANSIT', 'FAILED_DELIVERY', 'HELD_AT_AGENT')
		ORDER BY "deliveryAttempts" DESC, "createdAt" ASC`, holderPartyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelRow
	for rows.Next() {
		var r ParcelRow
		if err := rows.Scan(&r.ID, &r.Code, &r.SenderName, &r.ReceiverName, &r.OriginLabel, &r.DestinationLabel, &r.Status,
			&r.CreatedAt, &r.DeliveredAt, &r.DeliveryAttempts, &r.LastAttemptReason,
			&r.CodAmountKes, &r.CodStatus, &r.CodCollectDeliveryFee, &r.PriceKes); err != nil {
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

	// The unhappy-path and evidence columns, so an operator fielding a
	// "where is my parcel" call can answer it from the detail panel
	// instead of asking the courier. DeliveryAttempts in particular is
	// what separates "stuck, chase the rider" from "we've been three
	// times, somebody needs to phone the receiver".
	DeliveryAttempts  int
	LastAttemptAt     *time.Time
	LastAttemptReason *string
	PodPhotoURL       *string
	PodReceivedByName *string
	PodMethod         *string
	// Where it's sitting, when it's on a pickup point's shelf.
	AgentName         *string
	AgentLocationHint *string
	AgentHeldSince    *time.Time
	// What the sender declared and what cover they bought — both nil on
	// a booking with no cover, which is the default.
	DeclaredValueKes *string
	CoverageTierName *string

	// Which company is carrying it, and what the split came to. Nil on
	// an Esoqo-operated parcel, where the whole price is already Esoqo's.
	ParcelOrgID    *string
	ParcelOrgName  *string
	PlatformFeeKes *string
	OrgEarningsKes *string

	// IntakeConfirmedAt — nil until staff explicitly confirms physical
	// custody (see dbx.ConfirmParcelIntake). Gates the admin console's
	// own "Confirm received" button, same as it gates the sender/
	// receiver SMS: shown only while there's still something to confirm.
	IntakeConfirmedAt *time.Time

	// Receiver self-authentication — the receiver proving from their own
	// phone that they are the receiver, by typing the delivery code (see
	// dbx/parcel_receiver_auth.go). Three wrong tries locks the parcel;
	// admin can allow two more or mint a replacement code, for any
	// carrier including Esoqo-operated ones that have no company console
	// of their own to act from.
	//
	// No delivery code on this row, current or otherwise. Admin needs to
	// know a parcel is stuck and to be able to unstick it; reading the
	// secret is not part of either, and the replacement goes out by SMS.
	ReceiverAuthAttempts     int
	ReceiverAuthLockedAt     *time.Time
	ReceiverAuthHardLockedAt *time.Time
	DeliveryCodeVersion      int
	// CourierEarningsHeldUntil — set when a receiver closed their own
	// collection at a pickup point, with no staff witness. See
	// DeliverParcel's tail.
	CourierEarningsHeldUntil *time.Time
}

// AdminParcelStats is the parcels operations dashboard's whole
// "what needs my attention today" surface — every number here answers
// a real operational question (how much is stuck unpriced, how much
// is booked but nobody's been sent to collect it, how much is already
// late) rather than being a vanity count.
type AdminParcelStats struct {
	StatusCounts       map[string]int `json:"statusCounts"`
	RevenueTodayKes    money.Amount   `json:"revenueTodayKes"`
	RevenueKes         money.Amount   `json:"revenueKes"`
	NeedingAssignment  int            `json:"needingAssignment"`
	OverdueCollections int            `json:"overdueCollections"`
	StaleDrafts        int            `json:"staleDrafts"`
	CancelledToday     int            `json:"cancelledToday"`
	RefundsOwed        int            `json:"refundsOwed"`
	OverdueDeliveries  int            `json:"overdueDeliveries"`

	// FailedDeliveries — parcels a courier tried and couldn't hand over,
	// still in their bag. Split out from OverdueDeliveries on purpose:
	// before FAILED_DELIVERY existed these were silently counted as
	// courier SLA failures, which is both wrong (it's usually a
	// receiver-side problem) and actionable in a completely different
	// way — somebody has to call the receiver, not chase the rider.
	FailedDeliveries int `json:"failedDeliveries"`
	// StaleAtAgent — sitting on a shop shelf more than 5 days. The
	// agent network's own failure mode: shelf space is finite, and a
	// parcel nobody collects blocks a slot for one somebody will.
	StaleAtAgent int `json:"staleAtAgent"`
	// AwaitingReturn — failed or abandoned at an agent and not yet
	// returned to the sender. The end of the unhappy path, which
	// previously had no counter because it had no status.
	AwaitingReturn int `json:"awaitingReturn"`
	// ReceiverLocked — the receiver cannot get past the delivery code
	// and the parcel has stopped until somebody grants more tries or
	// issues a new one. Its own counter rather than part of
	// FailedDeliveries, which counts a different failure: there the
	// courier reached the door and nobody took the box; here the box is
	// exactly where it should be and the person collecting it cannot
	// prove they are that person.
	ReceiverLocked int `json:"receiverLocked"`
	// EarningsHeld — self-confirmed collections whose courier pay is
	// waiting on somebody to look at it.
	EarningsHeld int `json:"earningsHeld"`
}

// ParcelQueues are the named worklists the operations dashboard's KPI
// tiles count and its table filters by — one SQL predicate per tile,
// defined once here and used by both.
//
// The sharing is the whole point, not a tidiness exercise. A tile
// reading "Refunds owed: 7" that opens a list of 5 destroys trust in
// every other number on the page, and two hand-written copies of
// `"refundStatus" = 'PENDING'` is exactly how that happens — one gets
// an extra condition six months later and the other doesn't. Counting
// and listing are now the same predicate by construction.
//
// These fragments are concatenated into SQL, so they must stay
// compile-time constants. Caller input never reaches them: a request
// supplies a *key*, and an unknown key is rejected (see
// ParcelQueueWhere) rather than passed through.
var ParcelQueues = map[string]string{
	"needs-collector":    `p.status IN ('BOOKED', 'RECEIVED_AT_COUNTER') AND p."assignedCollectorPartyId" IS NULL`,
	"overdue-collection": `p.status IN ('BOOKED', 'RECEIVED_AT_COUNTER') AND p."collectionScheduledAt" IS NOT NULL AND p."collectionScheduledAt" < now()`,
	"stale-drafts":       `p.status = 'DRAFT_PENDING_PAYMENT' AND p."createdAt" < now() - interval '24 hours'`,
	"refunds-owed":       `p."refundStatus" = 'PENDING'`,
	// Deliberately still only PICKED_UP/IN_TRANSIT: a parcel in
	// FAILED_DELIVERY or HELD_AT_AGENT has a known, explained reason for
	// sitting still, and folding it in here would put it back into the
	// "chase the courier" bucket this split exists to get it out of.
	"overdue-delivery": `p.status IN ('PICKED_UP', 'IN_TRANSIT') AND p."slaDeadlineAt" IS NOT NULL AND p."slaDeadlineAt" < now()`,
	"failed-delivery":  `p.status = 'FAILED_DELIVERY'`,
	"stale-at-agent":   `p.status = 'HELD_AT_AGENT' AND p."agentHeldSince" < now() - interval '5 days'`,
	"awaiting-return":  `p.status = 'FAILED_DELIVERY' AND p."deliveryAttempts" >= 3`,
	"in-flight":        `p.status IN ('BOOKED', 'RECEIVED_AT_COUNTER', 'PICKED_UP', 'IN_TRANSIT')`,
	// A receiver who cannot get past the delivery code. Its own queue
	// rather than folded into failed-delivery, which means something
	// different — there the courier reached the door and nobody took
	// the box; here the box is sitting exactly where it should be and
	// the person collecting it cannot prove they are the person
	// collecting it. Different cause, different fix, different queue.
	"receiver-locked": `p."receiverAuthLockedAt" IS NOT NULL OR p."receiverAuthHardLockedAt" IS NOT NULL`,
	// Deliveries a receiver closed themselves at a pickup point, with
	// the courier's pay still held pending somebody looking at it.
	"earnings-held": `p."courierEarningsHeldUntil" IS NOT NULL`,
}

// ParcelQueueWhere resolves a queue key to its predicate. An unknown
// key is an error rather than a silently-ignored filter: quietly
// listing every parcel because a slug was misspelt is how an operator
// ends up acting on rows they never meant to see.
func ParcelQueueWhere(queue string) (string, error) {
	where, ok := ParcelQueues[queue]
	if !ok {
		return "", &ParcelError{"BAD_INPUT", "Unknown queue"}
	}
	return where, nil
}

// countQueue runs one queue's predicate as a count. The `p` alias is
// what the fragments are written against (they're shared with
// AdminListParcels, which really does need the alias for its joins).
func countQueue(ctx context.Context, pool *pgxpool.Pool, queue string, into *int) error {
	return pool.QueryRow(ctx, `SELECT count(*) FROM parcel p WHERE `+ParcelQueues[queue]).Scan(into)
}

// GetAdminParcelStats powers the Parcels overview panel. Every count
// is a plain aggregate over the same `parcel` table AdminListParcels
// already reads — no new tracking, just read for the first time as an
// operational signal, same reasoning the cross-domain report page's
// feature-adoption panel already uses for the audit log.
//
// Each attention-count is the same predicate its tile's queue filters
// by (see ParcelQueues), so clicking a number always lands on exactly
// that many rows.
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
	// Cancelled-today is a reporting figure rather than a worklist —
	// nobody works a queue of things already cancelled — so it keeps its
	// own query instead of earning a ParcelQueues entry.
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM parcel WHERE status = 'CANCELLED' AND "cancelledAt" >= date_trunc('day', now())`).Scan(&stats.CancelledToday); err != nil {
		return nil, err
	}
	for queue, into := range map[string]*int{
		"needs-collector":    &stats.NeedingAssignment,
		"overdue-collection": &stats.OverdueCollections,
		"stale-drafts":       &stats.StaleDrafts,
		"refunds-owed":       &stats.RefundsOwed,
		"overdue-delivery":   &stats.OverdueDeliveries,
		"failed-delivery":    &stats.FailedDeliveries,
		"stale-at-agent":     &stats.StaleAtAgent,
		"awaiting-return":    &stats.AwaitingReturn,
		"receiver-locked":    &stats.ReceiverLocked,
		"earnings-held":      &stats.EarningsHeld,
	} {
		if err := countQueue(ctx, pool, queue, into); err != nil {
			return nil, err
		}
	}
	return stats, nil
}

// AdminParcelListParams is what the operations table filters, sorts
// and pages by.
//
// Queue and Status are independent: a queue is an operational worklist
// ("nobody assigned yet"), a status is a lifecycle stage, and narrowing
// a queue by status is a reasonable thing to want.
type AdminParcelListParams struct {
	// Status is an exact filter, or all statuses when nil.
	Status *string
	// Q matches sender/receiver name or the tracking code, same "search
	// box over a couple of text columns" shape other admin lists in this
	// package already use.
	Q *string
	// Queue is a key into ParcelQueues, or nil for no queue filter.
	Queue *string
	// ParcelOrgID scopes to one courier company's parcels, or nil for
	// every company plus Esoqo-direct.
	ParcelOrgID *string
	// Oldest sorts by dwell — longest-waiting first.
	//
	// This is the right default for a *queue* and the wrong one for the
	// ledger, which is why it's a parameter rather than a constant. Work
	// is worked oldest-first; browsing is done newest-first. Getting this
	// backwards is how a page can show 200 rows and still hide every row
	// that needed attention, since the parcels stuck longest are exactly
	// the ones a newest-first cut drops off the bottom.
	Oldest bool
	Limit  int
	Offset int
}

// AdminListParcels returns one page of the operations table plus the
// total number of rows matching the filter — the total being the
// difference between a footer that says "200 shown" (which is not
// information) and one that says "200 of 4,318" (which tells an
// operator there is a backlog they cannot see).
//
// Counted with a window function rather than a second round trip, so
// the count can never disagree with the page it describes.
func AdminListParcels(ctx context.Context, pool *pgxpool.Pool, p AdminParcelListParams) ([]AdminParcelRow, int, error) {
	// Defensive rather than trusting the handler: a zero Limit here
	// would silently return an empty page, and an unbounded one would
	// hand the browser the whole table.
	if p.Limit <= 0 || p.Limit > 200 {
		p.Limit = 50
	}
	if p.Offset < 0 {
		p.Offset = 0
	}
	queueWhere := "TRUE"
	if p.Queue != nil && *p.Queue != "" {
		w, err := ParcelQueueWhere(*p.Queue)
		if err != nil {
			return nil, 0, err
		}
		queueWhere = w
	}
	order := `p."createdAt" DESC`
	if p.Oldest {
		order = `p."createdAt" ASC`
	}
	query := `
		SELECT p.id, p.code, p."senderName", p."senderMsisdn", p."receiverName", p."receiverMsisdn",
		       p."originLabel", p."destinationLabel", p."parcelType"::text, p.status::text, p."priceKes"::text,
		       COALESCE(pr."knownAs", pr."officialName"), pr.msisdn, p."collectionScheduledAt", p."collectionNote", p."createdAt",
		       p."paymentMethod", p."mpesaReceiptCode", p."refundStatus", p."refundedAt",
		       p."receiptConfirmedAt", p."receiptConditionRating", p."receiptFeedback",
		       p."slaDeadlineAt", p."exceptionNote", p."exceptionFlaggedAt",
		       p.notes, p."cancellationReason", p."cancelledAt", p."deliveredAt",
		       p."deliveryAttempts", p."lastAttemptAt", p."lastAttemptReason",
		       p."podPhotoUrl", p."podReceivedByName", p."podMethod",
		       a.name, a."locationHint", p."agentHeldSince",
		       p."declaredValueKes"::text, ct.name,
		       p."parcelOrgId"::text, po.name, p."platformFeeKes"::text, p."orgEarningsKes"::text,
		       p."intakeConfirmedAt",
		       p."receiverAuthAttempts", p."receiverAuthLockedAt", p."receiverAuthHardLockedAt",
		       p."deliveryCodeVersion", p."courierEarningsHeldUntil",
		       count(*) OVER ()
		FROM parcel p
		LEFT JOIN person pr ON pr."partyId" = p."assignedCollectorPartyId"
		LEFT JOIN parcel_agent a ON a.id = p."destinationAgentId"
		LEFT JOIN parcel_coverage_tier ct ON ct.id = p."coverageTierId"
		LEFT JOIN parcel_org po ON po.id = p."parcelOrgId"
		WHERE ($1::text IS NULL OR p.status::text = $1)
		  AND ($2::text IS NULL OR p."senderName" ILIKE '%'||$2||'%' OR p."receiverName" ILIKE '%'||$2||'%' OR p.code ILIKE '%'||$2||'%')
		  AND ($3::uuid IS NULL OR p."parcelOrgId" = $3::uuid)
		  AND (` + queueWhere + `)
		ORDER BY ` + order + `
		LIMIT $4 OFFSET $5`
	rows, err := pool.Query(ctx, query, p.Status, p.Q, p.ParcelOrgID, p.Limit, p.Offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []AdminParcelRow
	// Stays 0 for an empty page, which is correct: no rows matched, so
	// there is no total to report beyond zero.
	total := 0
	for rows.Next() {
		var r AdminParcelRow
		if err := rows.Scan(&r.ID, &r.Code, &r.SenderName, &r.SenderMsisdn, &r.ReceiverName, &r.ReceiverMsisdn,
			&r.OriginLabel, &r.DestinationLabel, &r.ParcelType, &r.Status, &r.PriceKes,
			&r.AssignedCollectorName, &r.AssignedCollectorMsisdn, &r.CollectionScheduledAt, &r.CollectionNote, &r.CreatedAt,
			&r.PaymentMethod, &r.MpesaReceiptCode, &r.RefundStatus, &r.RefundedAt,
			&r.ReceiptConfirmedAt, &r.ReceiptConditionRating, &r.ReceiptFeedback,
			&r.SlaDeadlineAt, &r.ExceptionNote, &r.ExceptionFlaggedAt,
			&r.Notes, &r.CancellationReason, &r.CancelledAt, &r.DeliveredAt,
			&r.DeliveryAttempts, &r.LastAttemptAt, &r.LastAttemptReason,
			&r.PodPhotoURL, &r.PodReceivedByName, &r.PodMethod,
			&r.AgentName, &r.AgentLocationHint, &r.AgentHeldSince,
			&r.DeclaredValueKes, &r.CoverageTierName,
			&r.ParcelOrgID, &r.ParcelOrgName, &r.PlatformFeeKes, &r.OrgEarningsKes,
			&r.IntakeConfirmedAt,
			&r.ReceiverAuthAttempts, &r.ReceiverAuthLockedAt, &r.ReceiverAuthHardLockedAt,
			&r.DeliveryCodeVersion, &r.CourierEarningsHeldUntil,
			&total); err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
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
	if status != "BOOKED" && status != "RECEIVED_AT_COUNTER" {
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

// ParcelIntakeConfirmResult — everything the confirming handler needs
// to compose both the sender's and receiver's SMS without a second
// round trip.
type ParcelIntakeConfirmResult struct {
	SenderMsisdn   string
	SenderName     string
	ReceiverName   string
	ReceiverMsisdn string
	OriginLabel    string
	// CarrierOrgName — nil for Esoqo-operated dispatch, same convention
	// ParcelNotifyInfo's own field follows.
	CarrierOrgName *string
}

// ConfirmParcelIntake — a clerk/handler's explicit "the box is
// physically here" moment, separate from BookParcel itself.
//
// A self-service sender submitting the form online, or a clerk typing
// a walk-in's details in, both only ever describe a parcel — neither
// act proves anyone at Esoqo (or a partner courier) actually has it in
// hand. Texting either party off the back of that submission told them
// a parcel was in the system before a single person had touched it.
// This is the gate: only once staff at a real counter confirms custody
// does either party hear anything (see handlers_parcels.go's caller
// for the two SMS this unlocks).
func ConfirmParcelIntake(ctx context.Context, pool *pgxpool.Pool, code, staffID string) (*ParcelIntakeConfirmResult, error) {
	var v ParcelIntakeConfirmResult
	var status string
	var alreadyConfirmed bool
	err := pool.QueryRow(ctx, `
		SELECT p.status::text, p."senderMsisdn", p."senderName", p."receiverName", p."receiverMsisdn",
		       p."originLabel", po.name, p."intakeConfirmedAt" IS NOT NULL
		FROM parcel p
		LEFT JOIN parcel_org po ON po.id = p."parcelOrgId"
		WHERE p.code = $1`, code).
		Scan(&status, &v.SenderMsisdn, &v.SenderName, &v.ReceiverName, &v.ReceiverMsisdn,
			&v.OriginLabel, &v.CarrierOrgName, &alreadyConfirmed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return nil, err
	}
	if status != "BOOKED" {
		return nil, &ParcelError{"BAD_INPUT", "Only a booked parcel can be confirmed received"}
	}
	if alreadyConfirmed {
		return nil, &ParcelError{"BAD_INPUT", "This parcel's intake was already confirmed"}
	}
	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET "intakeConfirmedAt" = now(), "intakeConfirmedByStaffId" = $1 WHERE code = $2`,
		staffID, code); err != nil {
		return nil, err
	}
	return &v, nil
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
	if status != "DRAFT_PENDING_PAYMENT" && status != "BOOKED" && status != "RECEIVED_AT_COUNTER" {
		return nil, &ParcelError{"BAD_INPUT", "Only a draft or a paid, not-yet-picked-up parcel can be cancelled"}
	}

	result := &CancelParcelResult{Code: code, SenderMsisdn: senderMsisdn, SenderName: senderName, PriceKes: priceKesText, PaymentMethod: paymentMethod}

	// refundStatus mirrors the two branches below: an auto-reversed
	// points payment is REFUNDED immediately, an M-Pesa payment sits
	// PENDING until an admin closes it out via MarkParcelRefunded — see
	// that function's own comment on why there's no automatic reversal.
	refundStatus := "NOT_APPLICABLE"
	var refundedAt *time.Time
	if (status == "BOOKED" || status == "RECEIVED_AT_COUNTER") && paymentMethod != nil {
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

// FlagParcelException — a staff member marking a live (RECEIVED_AT_COUNTER,
// PICKED_UP or IN_TRANSIT) parcel as needing attention. Distinct from CancelParcel:
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
		WHERE id = $3 AND status IN ('PICKED_UP', 'IN_TRANSIT', 'RECEIVED_AT_COUNTER')`, note, staffID, parcelID)
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
		WHERE id = $5 AND status IN ('DRAFT_PENDING_PAYMENT', 'BOOKED', 'RECEIVED_AT_COUNTER')`,
		receiverName, receiverMsisdn, destinationLabel, notes, parcelID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"BAD_INPUT", "Only a draft or paid, not-yet-picked-up parcel can be edited"}
	}
	return nil
}

// UpdateOwnParcelDetails is UpdateParcelDetails' sender-facing twin: the
// same correction (receiver name/phone, destination, notes) before a
// courier has taken custody, but scoped by code + senderPartyId instead
// of an admin's parcelID, so a sender can fix a wrong receiver number
// themselves instead of waiting on staff. A guest booking has no
// senderPartyId to match, so guests still have to go through staff —
// consistent with PayParcelWithPoints drawing the same line.
func UpdateOwnParcelDetails(ctx context.Context, pool *pgxpool.Pool, code, partyID, receiverName, receiverMsisdn, destinationLabel string, notes *string) error {
	if strings.TrimSpace(receiverName) == "" || strings.TrimSpace(receiverMsisdn) == "" || strings.TrimSpace(destinationLabel) == "" {
		return &ParcelError{"BAD_INPUT", "Receiver name, phone and destination are required"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET "receiverName" = $1, "receiverMsisdn" = $2, "destinationLabel" = $3, notes = $4
		WHERE code = $5 AND "senderPartyId" = $6
		  AND status IN ('DRAFT_PENDING_PAYMENT', 'BOOKED', 'RECEIVED_AT_COUNTER')`,
		receiverName, receiverMsisdn, destinationLabel, notes, code, partyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"BAD_INPUT", "Only a draft or paid, not-yet-picked-up parcel you booked can be edited"}
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

// RequestParcelDeliveryOtp sends a code to the parcel's own registered
// receiverMsisdn (never a client-supplied number — same rule
// RequestParcelReceiptOtp already follows) as the alternative to the
// printed delivery code at the point of hand-over. Gated on the parcel
// actually being in a deliverable state — offering this before a
// courier has even picked it up, or after it's already DELIVERED,
// would either leak that a code exists too early or spend an SMS on a
// closed parcel. Returns the masked number so the counter screen can
// show "we've texted 07•• •••78" without ever learning the real one.
func RequestParcelDeliveryOtp(ctx context.Context, pool *pgxpool.Pool, otp *authsvc.OtpService, code, ip string) (maskedMsisdn string, err error) {
	var status, receiverMsisdn string
	err = pool.QueryRow(ctx, `
		SELECT status::text, "receiverMsisdn" FROM parcel WHERE code = $1`, code).
		Scan(&status, &receiverMsisdn)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", err
	}
	switch status {
	case "DELIVERED":
		return "", &ParcelError{"ALREADY_DELIVERED", "This parcel has already been delivered"}
	case "DRAFT_PENDING_PAYMENT", "BOOKED", "RECEIVED_AT_COUNTER", "CANCELLED", "RETURNED_TO_SENDER":
		return "", &ParcelError{"BAD_INPUT", "This parcel isn't ready to be delivered yet"}
	}
	if _, err := otp.IssueOtp(ctx, receiverMsisdn, authsvc.OtpParcelDeliveryConfirm, ip); err != nil {
		return "", err
	}
	return maskMsisdn(receiverMsisdn), nil
}

// VerifyParcelDeliveryOtp checks a code against the parcel's own
// receiverMsisdn — the one number DeliverParcel's own otpVerified
// parameter is allowed to trust, resolved here rather than accepted
// from the caller for the same reason every other OTP check in this
// file resolves its own number.
func VerifyParcelDeliveryOtp(ctx context.Context, pool *pgxpool.Pool, otp *authsvc.OtpService, code, otpCode string) (bool, error) {
	var receiverMsisdn string
	err := pool.QueryRow(ctx, `SELECT "receiverMsisdn" FROM parcel WHERE code = $1`, code).Scan(&receiverMsisdn)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return false, err
	}
	return otp.VerifyOtp(ctx, receiverMsisdn, authsvc.OtpParcelDeliveryConfirm, otpCode)
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
		       COALESCE(toP."knownAs", toP."officialName", 'Esoqo counter'),
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
