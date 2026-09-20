package dbx

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A courier company's own vehicle runs.
//
// The shipment machinery in parcel_operations.go was written for
// Esoqo's ops console and had no notion of an owner, which is why the
// courier portal's own shipment actions had been pointing at routes
// that were never registered: there was no safe way to answer "which
// runs are MINE". parcel_shipment."parcelOrgId" (migration
// 20260920100000) closes that, and everything here is the org-scoped
// half — same tables, same transitions, one predicate.
//
// Every function takes orgID from the session and proves ownership in
// SQL rather than checking in Go and then acting: a company must not be
// able to load its parcel onto a competitor's lorry by guessing a
// shipment id, and the only way to be sure of that is for the id to
// simply not match.

// OrgShipment is the loading picker's row — what a clerk needs to
// choose between two lorries at the door. Deliberately not the full
// ParcelShipment: the picker does not need offload counts.
type OrgShipment struct {
	ID               string `json:"id"`
	OriginLabel      string `json:"originLabel"`
	DestinationLabel string `json:"destinationLabel"`
	RouteLabel       string `json:"routeLabel"`
	VehiclePlate     string `json:"vehiclePlate"`
	Status           string `json:"status"`
	Loaded           int    `json:"loaded"`
	CreatedAt        string `json:"createdAt"`
}

// ListOpenOrgShipments — this company's runs that are still loading.
//
// OPEN only. A departed run is not a choice a clerk at the counter can
// make: the lorry has gone, and offering it would put a parcel on a
// manifest nobody will ever check it off.
func ListOpenOrgShipments(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]OrgShipment, error) {
	rows, err := pool.Query(ctx, `
		SELECT s.id, s."originLabel", s."destinationLabel",
		       COALESCE(s."routeLabel", ''), COALESCE(s."vehiclePlate", ''), s.status,
		       (SELECT count(*) FROM parcel_shipment_item i
		         WHERE i."shipmentId" = s.id AND i."loadedAt" IS NOT NULL),
		       to_char(s."createdAt", 'YYYY-MM-DD"T"HH24:MI:SSZ')
		FROM parcel_shipment s
		WHERE s."parcelOrgId" = $1 AND s.status = 'OPEN'
		ORDER BY s."createdAt" DESC
		LIMIT 50`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OrgShipment{}
	for rows.Next() {
		var s OrgShipment
		if err := rows.Scan(&s.ID, &s.OriginLabel, &s.DestinationLabel, &s.RouteLabel,
			&s.VehiclePlate, &s.Status, &s.Loaded, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// CreateOrgShipment opens a run owned by this company.
func CreateOrgShipment(ctx context.Context, pool *pgxpool.Pool, orgID, origin, destination, route, vehicle, staffID string) (*OrgShipment, error) {
	if strings.TrimSpace(origin) == "" || strings.TrimSpace(destination) == "" {
		return nil, &ParcelError{"BAD_INPUT", "Where it leaves from and where it's going are both needed"}
	}
	var s OrgShipment
	err := pool.QueryRow(ctx, `
		INSERT INTO parcel_shipment (id, "originLabel", "destinationLabel", "routeLabel", "vehiclePlate", "createdByStaffId", "parcelOrgId")
		VALUES (gen_random_uuid(), $1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, '')::uuid, $6)
		RETURNING id, "originLabel", "destinationLabel", COALESCE("routeLabel", ''), COALESCE("vehiclePlate", ''), status,
		          to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SSZ')`,
		strings.TrimSpace(origin), strings.TrimSpace(destination), strings.TrimSpace(route),
		strings.TrimSpace(vehicle), staffID, orgID).
		Scan(&s.ID, &s.OriginLabel, &s.DestinationLabel, &s.RouteLabel, &s.VehiclePlate, &s.Status, &s.CreatedAt)
	return &s, err
}

// LoadParcelOntoOrgShipment puts one of this company's parcels onto one
// of this company's open runs, and moves it to IN_TRANSIT as part of
// the same transaction.
//
// The status move lives HERE rather than in a separate call on purpose:
// "it is on the lorry" and "it is in transit" are the same physical
// fact, and letting a client assert the second without the first is
// exactly how a parcel ends up telling its receiver it is on the way
// while sitting on the floor. Both ids are re-proved against orgID in
// the same statements that use them.
func LoadParcelOntoOrgShipment(ctx context.Context, pool *pgxpool.Pool, orgID, shipmentID, code, partyID, staffID string) (*OrgShipment, error) {
	if strings.TrimSpace(code) == "" {
		return nil, &ParcelError{"BAD_INPUT", "Scan a parcel code"}
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// The parcel must be this company's AND ready to travel. Both
	// conditions in the lookup, so a foreign code and an unreceived one
	// are indistinguishable from the outside — a company cannot use this
	// to discover whether a competitor is carrying a given parcel.
	var parcelID, parcelStatus string
	err = tx.QueryRow(ctx, `
		SELECT id, status::text FROM parcel
		WHERE code = $1 AND "parcelOrgId" = $2 FOR UPDATE`, strings.TrimSpace(code), orgID).
		Scan(&parcelID, &parcelStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That parcel isn't on your books"}
	}
	if err != nil {
		return nil, err
	}
	switch parcelStatus {
	case "RECEIVED_AT_COUNTER", "PICKED_UP", "IN_TRANSIT":
		// Loadable. IN_TRANSIT included so a parcel changing vehicles
		// mid-journey can join the next leg's manifest.
	case "BOOKED", "DRAFT_PENDING_PAYMENT":
		return nil, &ParcelError{"BAD_INPUT", "Receive this parcel into custody before loading it"}
	default:
		return nil, &ParcelError{"BAD_INPUT", "This parcel's journey is already closed"}
	}

	var shipmentStatus string
	err = tx.QueryRow(ctx, `
		SELECT status FROM parcel_shipment
		WHERE id = $1 AND "parcelOrgId" = $2 FOR UPDATE`, shipmentID, orgID).Scan(&shipmentStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That run isn't one of yours"}
	}
	if err != nil {
		return nil, err
	}
	if shipmentStatus != "OPEN" {
		return nil, &ParcelError{"BAD_INPUT", "That run has already left"}
	}

	// Idempotent: a clerk scanning the same box twice at a busy door is
	// a double-tap, not a second parcel.
	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_shipment_item (id, "shipmentId", "parcelId", "loadedAt", "loadedByPartyId", "loadedByStaffId")
		VALUES (gen_random_uuid(), $1, $2, now(), NULLIF($3, '')::uuid, NULLIF($4, '')::uuid)
		ON CONFLICT ("shipmentId", "parcelId") DO UPDATE
		SET "loadedAt" = COALESCE(parcel_shipment_item."loadedAt", now())`,
		shipmentID, parcelID, partyID, staffID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET status = 'IN_TRANSIT'
		WHERE id = $1 AND status IN ('RECEIVED_AT_COUNTER', 'PICKED_UP')`, parcelID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_handoff (id, "parcelId", "fromPartyId", "toPartyId", "createdAt", status)
		VALUES (gen_random_uuid(), $1, NULLIF($2, '')::uuid, NULLIF($2, '')::uuid, now(), 'IN_TRANSIT')`,
		parcelID, partyID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return GetOrgShipment(ctx, pool, orgID, shipmentID)
}

// StartOrgShipment marks one of this company's runs as departed.
func StartOrgShipment(ctx context.Context, pool *pgxpool.Pool, orgID, shipmentID string) (*OrgShipment, error) {
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_shipment SET status = 'DEPARTED', "startedAt" = COALESCE("startedAt", now())
		WHERE id = $1 AND "parcelOrgId" = $2 AND status = 'OPEN'`, shipmentID, orgID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, &ParcelError{"BAD_INPUT", "That run isn't yours, or has already left"}
	}
	return GetOrgShipment(ctx, pool, orgID, shipmentID)
}

func GetOrgShipment(ctx context.Context, pool *pgxpool.Pool, orgID, shipmentID string) (*OrgShipment, error) {
	var s OrgShipment
	err := pool.QueryRow(ctx, `
		SELECT s.id, s."originLabel", s."destinationLabel",
		       COALESCE(s."routeLabel", ''), COALESCE(s."vehiclePlate", ''), s.status,
		       (SELECT count(*) FROM parcel_shipment_item i
		         WHERE i."shipmentId" = s.id AND i."loadedAt" IS NOT NULL),
		       to_char(s."createdAt", 'YYYY-MM-DD"T"HH24:MI:SSZ')
		FROM parcel_shipment s
		WHERE s.id = $1 AND s."parcelOrgId" = $2`, shipmentID, orgID).
		Scan(&s.ID, &s.OriginLabel, &s.DestinationLabel, &s.RouteLabel, &s.VehiclePlate,
			&s.Status, &s.Loaded, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That run isn't one of yours"}
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}
