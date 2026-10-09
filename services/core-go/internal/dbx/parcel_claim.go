package dbx

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
)

// Proving you are a party to a parcel, so you can be shown more than a
// stranger.
//
// The problem this solves: a tracking code is a bearer credential
// printed on the outside of a box and handled by everyone between the
// sender and the door. GetParcelStatus is therefore correctly
// PII-minimal — but that leaves the actual receiver, the one person who
// most needs the delivery address and the agent's opening hours, seeing
// exactly what a stranger on a matatu sees.
//
// The rule, inherited from RequestParcelReceiptOtp and not negotiable:
// the code goes to the number already stored on the parcel, never to a
// number the caller supplies. Possession of the tracking code is not
// possession of the phone, and that gap is the whole control.

// ParcelClaimTier is which side of a parcel a verified caller is on.
// Sender and receiver see genuinely different things — a sender wants
// proof of delivery and what they paid, a receiver wants an address and
// what they owe — so the tier is carried through rather than collapsed
// into a single "verified" boolean.
type ParcelClaimTier string

const (
	ClaimTierSender   ParcelClaimTier = "SENDER"
	ClaimTierReceiver ParcelClaimTier = "RECEIVER"
)

// RequestParcelClaimOtp sends a verification code to whichever party's
// stored number matches [msisdn].
//
// Returns the same masked-number response whether or not anything
// matched. That uniformity is deliberate and load-bearing: a response
// that differed would turn this endpoint into an oracle answering "is
// 0722xxx a party to parcel PKG-ABC12X?" for anyone holding a code they
// found on a box — which is precisely the linkage the tiering exists to
// prevent. A caller who typed the wrong number simply never receives a
// code.
//
// Comparison is constant-time. The timing signal is tiny but it is the
// same signal the uniform response is spent hiding, and paying for it
// twice is cheaper than reasoning about whether it leaks.
func RequestParcelClaimOtp(
	ctx context.Context, pool *pgxpool.Pool, otp *authsvc.OtpService, code, msisdn, ip string,
) error {
	var senderMsisdn, receiverMsisdn string
	err := pool.QueryRow(ctx, `
		SELECT "senderMsisdn", "receiverMsisdn" FROM parcel WHERE code = $1`, code).
		Scan(&senderMsisdn, &receiverMsisdn)
	if errors.Is(err, pgx.ErrNoRows) {
		// Not even "no such parcel" — a code that does not exist and a
		// code whose parties do not include this number must be
		// indistinguishable, or the endpoint enumerates valid codes.
		return nil
	}
	if err != nil {
		return err
	}
	match := ""
	if constantTimeEqual(msisdn, senderMsisdn) {
		match = senderMsisdn
	} else if constantTimeEqual(msisdn, receiverMsisdn) {
		match = receiverMsisdn
	}
	if match == "" {
		return nil
	}
	// Sent to the stored number, which at this point is known equal to
	// the submitted one — written this way so it stays true if the
	// matching ever loosens (normalised formats, say).
	if _, err := otp.IssueOtp(ctx, match, authsvc.OtpParcelClaim, ip); err != nil {
		return err
	}
	return nil
}

// VerifyParcelClaim checks the code and returns which party the caller
// proved themselves to be.
//
// A wrong or expired OTP is reported as a plain failure with no detail
// about the parcel, for the same reason the request half is uniform.
func VerifyParcelClaim(
	ctx context.Context, pool *pgxpool.Pool, otp *authsvc.OtpService, code, msisdn, otpCode string,
) (ParcelClaimTier, error) {
	var senderMsisdn, receiverMsisdn string
	err := pool.QueryRow(ctx, `
		SELECT "senderMsisdn", "receiverMsisdn" FROM parcel WHERE code = $1`, code).
		Scan(&senderMsisdn, &receiverMsisdn)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &ParcelError{"FORBIDDEN", "That code didn't match"}
	}
	if err != nil {
		return "", err
	}
	var tier ParcelClaimTier
	switch {
	case constantTimeEqual(msisdn, senderMsisdn):
		tier = ClaimTierSender
	case constantTimeEqual(msisdn, receiverMsisdn):
		tier = ClaimTierReceiver
	default:
		return "", &ParcelError{"FORBIDDEN", "That code didn't match"}
	}
	// Verified against the number the caller claims, which the switch
	// above has already established is a party to this parcel — so a
	// valid OTP for some *other* parcel's number cannot be replayed here.
	ok, err := otp.VerifyOtp(ctx, msisdn, authsvc.OtpParcelClaim, otpCode)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", &ParcelError{"FORBIDDEN", "That code didn't match"}
	}
	return tier, nil
}

// constantTimeEqual compares two phone numbers without leaking, through
// timing, how much of a prefix they share.
func constantTimeEqual(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	// Length differs → not equal, and comparing anyway would panic.
	// Leaking "these are different lengths" is not the linkage we care
	// about; leaking "these share the first eight digits" is.
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// ParcelPartyView is what a verified sender or receiver sees — the
// guest-safe projection plus exactly what their own side of the
// transaction needs, and nothing belonging to the other.
type ParcelPartyView struct {
	*ParcelStatusView
	Tier ParcelClaimTier `json:"tier"`

	// The counterparty, named but not dialable. Last four digits is
	// enough to recognise a number you already know and useless as a
	// contact card if the page is left open or forwarded — the same
	// judgement ParcelLabel.ReceiverPhoneLast4 already makes about what
	// rides in the open.
	CounterpartyName       string `json:"counterpartyName"`
	CounterpartyPhoneLast4 string `json:"counterpartyPhoneLast4"`

	// Sender-only: what this cost and whether it has been paid back.
	PriceKesOwn   *string `json:"priceKesOwn,omitempty"`
	PaymentMethod *string `json:"paymentMethod,omitempty"`
	// Paid and the M-Pesa receipt let the sender tell "booked to pay at
	// the counter" from "paid at the counter", and cash from M-Pesa.
	Paid             *bool   `json:"paid,omitempty"`
	MpesaReceiptCode *string `json:"mpesaReceiptCode,omitempty"`
	RefundStatus     *string `json:"refundStatus,omitempty"`

	// Receiver-only: where to go and what to bring. The exact pin is
	// here and never on the public view — it is more precise than the
	// town-level label and has no business being readable by whoever
	// picked the box up.
	DestinationLat *float64 `json:"destinationLat,omitempty"`
	DestinationLng *float64 `json:"destinationLng,omitempty"`
	CodDueKes      *string  `json:"codDueKes,omitempty"`
	DeliveryCode   *string  `json:"deliveryCode,omitempty"`
}

// GetParcelPartyView builds the tier-appropriate projection. Authorisation
// is the caller's job — VerifyParcelClaim is what establishes the tier,
// and this trusts it, the same split GetParcelStatus/GetParcelLabel
// already keep between "can they see it" and "what is in it".
func GetParcelPartyView(
	ctx context.Context, pool *pgxpool.Pool, code string, tier ParcelClaimTier,
) (*ParcelPartyView, error) {
	base, err := GetParcelStatus(ctx, pool, code)
	if err != nil {
		return nil, err
	}
	if base == nil {
		return nil, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	v := &ParcelPartyView{ParcelStatusView: base, Tier: tier}

	var senderName, receiverName, senderMsisdn, receiverMsisdn string
	var priceKes, paymentMethod, refundStatus, deliveryCode, mpesaReceipt *string
	var paid bool
	var destLat, destLng *float64
	var codAmount *string
	if err := pool.QueryRow(ctx, `
		SELECT "senderName", "receiverName", "senderMsisdn", "receiverMsisdn",
		       "priceKes"::text, "paymentMethod", "refundStatus", "deliveryCode",
		       "destinationLat"::float8, "destinationLng"::float8, "codAmountKes"::text,
		       "paidAt" IS NOT NULL, "mpesaReceiptCode"
		FROM parcel WHERE code = $1`, code).
		Scan(&senderName, &receiverName, &senderMsisdn, &receiverMsisdn,
			&priceKes, &paymentMethod, &refundStatus, &deliveryCode,
			&destLat, &destLng, &codAmount, &paid, &mpesaReceipt); err != nil {
		return nil, err
	}

	if tier == ClaimTierSender {
		v.CounterpartyName = receiverName
		v.CounterpartyPhoneLast4 = last4(receiverMsisdn)
		v.PriceKesOwn = priceKes
		v.PaymentMethod = paymentMethod
		v.Paid = &paid
		v.MpesaReceiptCode = mpesaReceipt
		v.RefundStatus = refundStatus
		return v, nil
	}

	v.CounterpartyName = senderName
	v.CounterpartyPhoneLast4 = last4(senderMsisdn)
	v.DestinationLat = destLat
	v.DestinationLng = destLng
	v.CodDueKes = codAmount
	// The handover code, which is the receiver's half of proving the
	// parcel reached the right person. Never on the sender's view: the
	// sender knowing it would let them authorise their own delivery.
	v.DeliveryCode = deliveryCode
	return v, nil
}

func last4(msisdn string) string {
	if len(msisdn) < 4 {
		return ""
	}
	return msisdn[len(msisdn)-4:]
}

// CounterParty is somebody this network has shipped to or from before
// — what the counter's name field offers after three keystrokes.
type CounterParty struct {
	Name   string `json:"name"`
	Msisdn string `json:"msisdn"`
	// LastLabel is the origin or destination they were last associated
	// with, which is usually the thing that tells two people with the
	// same name apart at a busy counter.
	LastLabel string    `json:"lastLabel"`
	LastSeen  time.Time `json:"lastSeen"`
	// Shipments — how often they appear. A trader who ships weekly
	// should outrank a one-off with a similar name.
	Shipments int `json:"shipments"`
}

// SearchCounterParties finds repeat senders and receivers by name or
// number.
//
// Derived from past parcels rather than a saved-addresses table, which
// was the open question and turns out to answer itself: every parcel
// already records both parties' names and numbers, so an address book
// would be a second copy of facts we hold — needing a dual write at
// booking, drifting the moment one path forgot, and starting empty for
// every customer already in the system. This starts full and cannot
// disagree with the record, because it *is* the record.
//
// The cost is that it's a scan rather than an indexed lookup on a small
// table. Acceptable at counter volumes and bounded by the limit; the
// day it isn't, the fix is a materialised view over exactly this query,
// not a hand-maintained table.
func SearchCounterParties(
	ctx context.Context, pool *pgxpool.Pool, q string, limit int,
) ([]CounterParty, error) {
	if len([]rune(q)) < 3 {
		// Two letters matches half the country. Making the caller commit
		// to three keeps this a lookup rather than a table scan dressed
		// as one.
		return nil, nil
	}
	if limit <= 0 || limit > 25 {
		limit = 8
	}
	rows, err := pool.Query(ctx, `
		WITH parties AS (
			SELECT "senderName" AS name, "senderMsisdn" AS msisdn,
			       "originLabel" AS label, "createdAt"
			FROM parcel WHERE "senderMsisdn" <> ''
			UNION ALL
			SELECT "receiverName", "receiverMsisdn", "destinationLabel", "createdAt"
			FROM parcel WHERE "receiverMsisdn" <> ''
		)
		SELECT name, msisdn, label, "createdAt", shipments FROM (
			SELECT DISTINCT ON (msisdn)
			       name, msisdn, label, "createdAt",
			       count(*) OVER (PARTITION BY msisdn) AS shipments
			FROM parties
			WHERE name ILIKE '%'||$1||'%' OR msisdn ILIKE '%'||$1||'%'
			-- Newest row per number wins, so a name correction or a
			-- change of shop supersedes what was recorded a year ago.
			ORDER BY msisdn, "createdAt" DESC
		) latest
		ORDER BY shipments DESC, "createdAt" DESC
		LIMIT $2`, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CounterParty
	for rows.Next() {
		var p CounterParty
		if err := rows.Scan(&p.Name, &p.Msisdn, &p.LastLabel, &p.LastSeen, &p.Shipments); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ClaimTokenTTL — how long a verified claim lasts.
//
// A day, so a receiver checking on a parcel through the afternoon is
// not re-OTP'd every time, and no longer, because this is a bearer
// token to somebody's name, address and phone that may well be left
// open on a shared phone.
const ClaimTokenTTL = 24 * time.Hour
