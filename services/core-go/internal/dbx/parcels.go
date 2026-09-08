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
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/fleetqr"
)

type ParcelError struct {
	Code    string // BAD_INPUT | NOT_FOUND | FORBIDDEN | WRONG_CODE | ALREADY_DELIVERED
	Message string
}

func (e *ParcelError) Error() string { return e.Message }

type BookParcelInput struct {
	SenderPartyID    *string
	SenderName       string
	SenderMsisdn     string
	ReceiverName     string
	ReceiverMsisdn   string
	OriginLabel      string
	DestinationLabel string
	Notes            *string
}

// BookParcel mints the parcel's own tracking code (PKG-…, via
// fleetqr's minting contract — see the security posture's rule on
// never hand-rolling a short code) plus a second, separate
// deliveryCode only the sender ever sees, only the receiver ever types
// in (see DeliverParcel).
func BookParcel(ctx context.Context, pool *pgxpool.Pool, in BookParcelInput) (parcelID, code string, err error) {
	if in.SenderName == "" || in.SenderMsisdn == "" {
		return "", "", &ParcelError{"BAD_INPUT", "Sender name and phone are required"}
	}
	if in.ReceiverName == "" || in.ReceiverMsisdn == "" {
		return "", "", &ParcelError{"BAD_INPUT", "Receiver name and phone are required"}
	}
	if in.OriginLabel == "" || in.DestinationLabel == "" {
		return "", "", &ParcelError{"BAD_INPUT", "Origin and destination are required"}
	}
	deliveryCode, err := generateDeliveryCode()
	if err != nil {
		return "", "", err
	}
	err = retryUnique(func() error {
		code = fleetqr.ShortCodeChecked(fleetqr.PrefixParcel, 6)
		return pool.QueryRow(ctx, `
			INSERT INTO parcel (
				id, code, "deliveryCode", "senderPartyId", "senderName", "senderMsisdn",
				"receiverName", "receiverMsisdn", "originLabel", "destinationLabel", notes,
				status, "createdAt"
			) VALUES (
				gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'BOOKED', now()
			) RETURNING id`,
			code, deliveryCode, in.SenderPartyID, in.SenderName, in.SenderMsisdn,
			in.ReceiverName, in.ReceiverMsisdn, in.OriginLabel, in.DestinationLabel, in.Notes).
			Scan(&parcelID)
	})
	return parcelID, code, err
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
	Code             string     `json:"code"`
	Status           string     `json:"status"`
	OriginLabel      string     `json:"originLabel"`
	DestinationLabel string     `json:"destinationLabel"`
	CreatedAt        time.Time  `json:"createdAt"`
	DeliveredAt      *time.Time `json:"deliveredAt"`
}

func GetParcelStatus(ctx context.Context, pool *pgxpool.Pool, code string) (*ParcelStatusView, error) {
	var v ParcelStatusView
	err := pool.QueryRow(ctx, `
		SELECT code, status::text, "originLabel", "destinationLabel", "createdAt", "deliveredAt"
		FROM parcel WHERE code = $1`, code).
		Scan(&v.Code, &v.Status, &v.OriginLabel, &v.DestinationLabel, &v.CreatedAt, &v.DeliveredAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// ScanHandoff is a driver/handler scanning a parcel into their own
// custody — possession of the code, plus being signed in, is the whole
// authorization model here (matches the physical reality: whoever has
// the parcel in hand can scan it). Idempotent: scanning a code you
// already hold is a no-op, not an error, so a nervous double-scan on a
// slow network never fails.
func ScanHandoff(ctx context.Context, pool *pgxpool.Pool, code, scannedByPartyID string) (status string, err error) {
	if scannedByPartyID == "" {
		return "", &ParcelError{"FORBIDDEN", "Sign in to accept a parcel"}
	}
	var parcelID, currentStatus string
	var currentHolder *string
	err = pool.QueryRow(ctx, `
		SELECT id, status::text, "currentHolderPartyId" FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &currentStatus, &currentHolder)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", err
	}
	if currentStatus == "DELIVERED" {
		return "", &ParcelError{"ALREADY_DELIVERED", "This parcel has already been delivered"}
	}
	if currentHolder != nil && *currentHolder == scannedByPartyID {
		return currentStatus, nil // already holding it — replayed scan
	}

	nextStatus := nextHandoffStatus(currentStatus)
	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET status = $1::"ParcelStatus", "currentHolderPartyId" = $2 WHERE id = $3`,
		nextStatus, scannedByPartyID, parcelID); err != nil {
		return "", err
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO parcel_handoff (id, "parcelId", "toPartyId", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, now())`, parcelID, scannedByPartyID); err != nil {
		return "", err
	}
	return nextStatus, nil
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
	CreatedAt        time.Time
	DeliveredAt      *time.Time
}

// ListMyParcels — every parcel this party has sent, newest first,
// including the deliveryCode so the sender can pass it on to the
// receiver.
func ListMyParcels(ctx context.Context, pool *pgxpool.Pool, senderPartyID string) ([]ParcelRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, code, "deliveryCode", "senderName", "receiverName", "originLabel", "destinationLabel", status::text, "createdAt", "deliveredAt"
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
		if err := rows.Scan(&r.ID, &r.Code, &deliveryCode, &r.SenderName, &r.ReceiverName, &r.OriginLabel, &r.DestinationLabel, &r.Status, &r.CreatedAt, &r.DeliveredAt); err != nil {
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
