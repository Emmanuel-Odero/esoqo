package dbx

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ParcelIntakeInput is the small set of facts a clerk adds when the box is
// physically present. Booking data is deliberately not duplicated here.
type ParcelIntakeInput struct {
	ItemCategory       string
	ItemDescription    string
	Perishable         bool
	PerishableHandling *string
	ExpiryAt           *time.Time
	Condition          string
	DeclaredValueKes   *float64
}

// CaptureParcelIntake accepts a booked parcel at a counter and records the
// operational facts needed for risk, pricing, and later disputes.
func CaptureParcelIntake(ctx context.Context, pool *pgxpool.Pool, code, staffID string, in ParcelIntakeInput) error {
	if strings.TrimSpace(staffID) == "" {
		return &ParcelError{"FORBIDDEN", "A signed-in clerk is required"}
	}
	if strings.TrimSpace(in.ItemCategory) == "" || strings.TrimSpace(in.ItemDescription) == "" {
		return &ParcelError{"BAD_INPUT", "Item category and description are required"}
	}
	if in.Perishable && in.ExpiryAt == nil {
		return &ParcelError{"BAD_INPUT", "Perishable parcels need an expiry date"}
	}
	if in.DeclaredValueKes != nil && *in.DeclaredValueKes < 0 {
		return &ParcelError{"BAD_INPUT", "Declared value cannot be negative"}
	}
	var parcelID, status string
	err := pool.QueryRow(ctx, `SELECT id, status::text FROM parcel WHERE code = $1`, code).Scan(&parcelID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if status != "BOOKED" {
		return &ParcelError{"BAD_INPUT", "Only a booked parcel can be received at this counter"}
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET "itemCategory" = $1, "itemDescription" = $2,
			"perishable" = $3, "perishableHandling" = $4, "expiryAt" = $5,
			"intakeCondition" = $6, "declaredValueKes" = COALESCE($7, "declaredValueKes"),
			status = 'RECEIVED_AT_COUNTER', "intakeConfirmedAt" = now(),
			"intakeConfirmedByStaffId" = $8, "intakeAcceptedByStaffId" = $8
		WHERE id = $9`, in.ItemCategory, in.ItemDescription, in.Perishable,
		in.PerishableHandling, in.ExpiryAt, in.Condition, in.DeclaredValueKes, staffID, parcelID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_handoff (id, "parcelId", "fromPartyId", "toPartyId", "createdAt", status)
		VALUES (gen_random_uuid(), $1, NULL, NULL, now(), 'RECEIVED_AT_COUNTER')`, parcelID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type ParcelIntakeRejection struct {
	Code         string `json:"code"`
	SenderMsisdn string `json:"-"`
	Reason       string `json:"reason"`
}

// RejectParcelAtDropoff closes a parcel before custody begins. It is not a
// return: the carrier never accepted responsibility for the physical item.
func RejectParcelAtDropoff(ctx context.Context, pool *pgxpool.Pool, code, staffID, reason string) (*ParcelIntakeRejection, error) {
	if strings.TrimSpace(staffID) == "" {
		return nil, &ParcelError{"FORBIDDEN", "A signed-in clerk is required"}
	}
	if strings.TrimSpace(reason) == "" {
		return nil, &ParcelError{"BAD_INPUT", "A rejection reason is required"}
	}
	var r ParcelIntakeRejection
	err := pool.QueryRow(ctx, `UPDATE parcel SET status = 'REJECTED_AT_DROPOFF', "intakeRejectedAt" = now(), "intakeRejectionReason" = $1 WHERE code = $2 AND status = 'BOOKED' RETURNING code, "senderMsisdn"`, reason, code).Scan(&r.Code, &r.SenderMsisdn)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"BAD_INPUT", "Only a booked parcel can be rejected at drop-off"}
	}
	r.Reason = reason
	return &r, err
}

type ParcelShipment struct {
	ID               string `json:"id"`
	OriginLabel      string `json:"originLabel"`
	DestinationLabel string `json:"destinationLabel"`
	RouteLabel       string `json:"routeLabel"`
	VehiclePlate     string `json:"vehiclePlate"`
	Status           string `json:"status"`
	Expected         int    `json:"expected"`
	Loaded           int    `json:"loaded"`
	Offloaded        int    `json:"offloaded"`
}

type ParcelOpsQueueRow struct {
	Code             string  `json:"code"`
	Status           string  `json:"status"`
	ReceiverName     string  `json:"receiverName"`
	DestinationLabel string  `json:"destinationLabel"`
	Perishable       bool    `json:"perishable"`
	ExpiryAt         *string `json:"expiryAt"`
	DeclaredValueKes *string `json:"declaredValueKes"`
	ReminderCount    int     `json:"reminderCount"`
	CreatedAt        string  `json:"createdAt"`
}

// ListParcelOpsQueue is the dashboard's action queue, not a general parcel
// search. It intentionally returns only the minimum operational fields.
func ListParcelOpsQueue(ctx context.Context, pool *pgxpool.Pool, queue string, limit int) ([]ParcelOpsQueueRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := `p.status IN ('RECEIVED_AT_COUNTER', 'HELD_AT_AGENT')`
	switch queue {
	case "ready_to_load":
		where = `p.status = 'RECEIVED_AT_COUNTER'`
	case "collection":
		where = `p.status = 'HELD_AT_AGENT'`
	case "perishable":
		where = `p.perishable = true AND p.status NOT IN ('DELIVERED', 'RETURNED_TO_SENDER', 'CANCELLED', 'REJECTED_AT_DROPOFF')`
	case "rejected":
		where = `p.status = 'REJECTED_AT_DROPOFF'`
	case "left_behind":
		where = `i."loadedAt" IS NULL AND i."exceptionCode" = 'LEFT_BEHIND'`
	case "arrival_exception":
		where = `i."offloadedAt" IS NULL AND i."exceptionCode" IS NOT NULL`
	case "all":
		where = `p.status NOT IN ('DELIVERED', 'RETURNED_TO_SENDER', 'CANCELLED')`
	}
	query := `SELECT p.code, p.status::text, p."receiverName", p."destinationLabel", p.perishable,
		p."expiryAt"::text, p."declaredValueKes"::text, p."reminderCount",
		to_char(p."createdAt", 'YYYY-MM-DD"T"HH24:MI:SSZ')
		FROM parcel p LEFT JOIN parcel_shipment_item i ON i."parcelId" = p.id
		WHERE ` + where + ` ORDER BY p.perishable DESC, p."expiryAt" ASC NULLS LAST, p."createdAt" ASC LIMIT $1`
	rows, err := pool.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelOpsQueueRow
	for rows.Next() {
		var row ParcelOpsQueueRow
		if err := rows.Scan(&row.Code, &row.Status, &row.ReceiverName, &row.DestinationLabel, &row.Perishable, &row.ExpiryAt, &row.DeclaredValueKes, &row.ReminderCount, &row.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func CreateParcelShipment(ctx context.Context, pool *pgxpool.Pool, origin, destination, route, vehicle, driver, conductor, staffID string) (*ParcelShipment, error) {
	if strings.TrimSpace(origin) == "" || strings.TrimSpace(destination) == "" {
		return nil, &ParcelError{"BAD_INPUT", "Origin and destination are required"}
	}
	var s ParcelShipment
	err := pool.QueryRow(ctx, `
		INSERT INTO parcel_shipment (id, "originLabel", "destinationLabel", "routeLabel", "vehiclePlate", "driverPartyId", "conductorPartyId", "createdByStaffId")
		VALUES (gen_random_uuid(), $1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, '')::uuid, NULLIF($6, '')::uuid, NULLIF($7, '')::uuid)
		RETURNING id, "originLabel", "destinationLabel", COALESCE("routeLabel", ''), COALESCE("vehiclePlate", ''), status`,
		origin, destination, route, vehicle, driver, conductor, staffID).
		Scan(&s.ID, &s.OriginLabel, &s.DestinationLabel, &s.RouteLabel, &s.VehiclePlate, &s.Status)
	return &s, err
}

func updateParcelShipmentCounts(ctx context.Context, pool *pgxpool.Pool, s *ParcelShipment) error {
	return pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE "loadedAt" IS NOT NULL), count(*) FILTER (WHERE "offloadedAt" IS NOT NULL)
		FROM parcel_shipment_item WHERE "shipmentId" = $1`, s.ID).
		Scan(&s.Expected, &s.Loaded, &s.Offloaded)
}

func LoadParcelToShipment(ctx context.Context, pool *pgxpool.Pool, shipmentID, code, partyID, staffID string) (*ParcelShipment, error) {
	if strings.TrimSpace(code) == "" {
		return nil, &ParcelError{"BAD_INPUT", "Scan a parcel code"}
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var parcelID, parcelStatus string
	if err := tx.QueryRow(ctx, `SELECT id, status::text FROM parcel WHERE code = $1 FOR UPDATE`, code).
		Scan(&parcelID, &parcelStatus); errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	} else if err != nil {
		return nil, err
	}
	if parcelStatus != "RECEIVED_AT_COUNTER" && parcelStatus != "PICKED_UP" && parcelStatus != "IN_TRANSIT" {
		return nil, &ParcelError{"BAD_INPUT", "This parcel is not ready to load"}
	}
	var shipmentStatus string
	if err := tx.QueryRow(ctx, `SELECT status FROM parcel_shipment WHERE id = $1 FOR UPDATE`, shipmentID).Scan(&shipmentStatus); errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That shipment was not found"}
	} else if err != nil {
		return nil, err
	}
	if shipmentStatus != "OPEN" {
		return nil, &ParcelError{"BAD_INPUT", "This shipment is no longer loading"}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_shipment_item (id, "shipmentId", "parcelId", "loadedAt", "loadedByPartyId", "loadedByStaffId")
		VALUES (gen_random_uuid(), $1, $2, now(), NULLIF($3, '')::uuid, NULLIF($4, '')::uuid)
		ON CONFLICT ("shipmentId", "parcelId") DO UPDATE SET "loadedAt" = COALESCE(parcel_shipment_item."loadedAt", now()),
			"loadedByPartyId" = COALESCE(parcel_shipment_item."loadedByPartyId", EXCLUDED."loadedByPartyId"),
			"loadedByStaffId" = COALESCE(parcel_shipment_item."loadedByStaffId", EXCLUDED."loadedByStaffId")`, shipmentID, parcelID, partyID, staffID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE parcel SET status = 'IN_TRANSIT' WHERE id = $1 AND status = 'RECEIVED_AT_COUNTER'`, parcelID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return GetParcelShipment(ctx, pool, shipmentID)
}

func StartParcelShipment(ctx context.Context, pool *pgxpool.Pool, shipmentID, staffID string) (*ParcelShipment, error) {
	var s ParcelShipment
	err := pool.QueryRow(ctx, `UPDATE parcel_shipment SET status = 'DEPARTED', "startedAt" = COALESCE("startedAt", now()) WHERE id = $1 AND status = 'OPEN' RETURNING id, "originLabel", "destinationLabel", COALESCE("routeLabel", ''), COALESCE("vehiclePlate", ''), status`, shipmentID).
		Scan(&s.ID, &s.OriginLabel, &s.DestinationLabel, &s.RouteLabel, &s.VehiclePlate, &s.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"BAD_INPUT", "Shipment is not open"}
	}
	if err != nil {
		return nil, err
	}
	if err := updateParcelShipmentCounts(ctx, pool, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func OffloadParcelFromShipment(ctx context.Context, pool *pgxpool.Pool, shipmentID, code, partyID, staffID string) (*ParcelShipment, error) {
	var itemID string
	err := pool.QueryRow(ctx, `
		SELECT i.id FROM parcel_shipment_item i JOIN parcel p ON p.id = i."parcelId"
		WHERE i."shipmentId" = $1 AND p.code = $2 AND i."loadedAt" IS NOT NULL`, shipmentID, code).Scan(&itemID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That parcel is not loaded on this shipment"}
	}
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, `UPDATE parcel_shipment_item SET "offloadedAt" = COALESCE("offloadedAt", now()), "offloadedByPartyId" = COALESCE("offloadedByPartyId", NULLIF($1, '')::uuid), "offloadedByStaffId" = COALESCE("offloadedByStaffId", NULLIF($2, '')::uuid) WHERE id = $3`, partyID, staffID, itemID); err != nil {
		return nil, err
	}
	return GetParcelShipment(ctx, pool, shipmentID)
}

func FinishParcelShipment(ctx context.Context, pool *pgxpool.Pool, shipmentID string) (*ParcelShipment, error) {
	var s ParcelShipment
	err := pool.QueryRow(ctx, `UPDATE parcel_shipment SET status = 'ARRIVED', "arrivedAt" = COALESCE("arrivedAt", now()), "endedAt" = COALESCE("endedAt", now()) WHERE id = $1 AND status = 'DEPARTED' RETURNING id, "originLabel", "destinationLabel", COALESCE("routeLabel", ''), COALESCE("vehiclePlate", ''), status`, shipmentID).
		Scan(&s.ID, &s.OriginLabel, &s.DestinationLabel, &s.RouteLabel, &s.VehiclePlate, &s.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"BAD_INPUT", "Shipment is not departed"}
	}
	if err != nil {
		return nil, err
	}
	if err := updateParcelShipmentCounts(ctx, pool, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func GetParcelShipment(ctx context.Context, pool *pgxpool.Pool, shipmentID string) (*ParcelShipment, error) {
	var s ParcelShipment
	err := pool.QueryRow(ctx, `SELECT id, "originLabel", "destinationLabel", COALESCE("routeLabel", ''), COALESCE("vehiclePlate", ''), status FROM parcel_shipment WHERE id = $1`, shipmentID).
		Scan(&s.ID, &s.OriginLabel, &s.DestinationLabel, &s.RouteLabel, &s.VehiclePlate, &s.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That shipment was not found"}
	}
	if err != nil {
		return nil, err
	}
	if err := updateParcelShipmentCounts(ctx, pool, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

type PickupReminderResult struct {
	Code, ReceiverMsisdn string
	Count                int
}

func RecordPickupReminder(ctx context.Context, pool *pgxpool.Pool, code string) (*PickupReminderResult, error) {
	var r PickupReminderResult
	err := pool.QueryRow(ctx, `UPDATE parcel SET "reminderCount" = "reminderCount" + 1, "lastReminderAt" = now() WHERE code = $1 AND status = 'HELD_AT_AGENT' RETURNING code, "receiverMsisdn", "reminderCount"`, code).
		Scan(&r.Code, &r.ReceiverMsisdn, &r.Count)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"BAD_INPUT", "That parcel is not waiting for collection"}
	}
	return &r, err
}
