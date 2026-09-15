// Package dbx (parcel_fleet.go) — parcels riding the passenger fleet.
//
// A parcel can be loaded onto an actual matatu or intercity bus on a
// scheduled run, handed to the conductor, and taken off at a named
// stage. Esoqo already runs the vehicles, already knows where they are
// (VehiclePing, reported for the passengers' benefit), and already has
// a conductor on board who scans things for a living.
//
// The commercial point: a passenger trip travels with spare capacity
// whether or not anything is in the boot. Filling it costs nothing
// marginal, and no competitor can answer "track your parcel on the bus
// you ride" without first owning a vehicle network.
//
// The custody model does not change. A conductor takes a parcel the
// same way any courier does — ScanHandoff, one Party accountable — and
// boarding is an additional fact about where that Party currently is,
// not a replacement for the chain.
package dbx

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DepartingTrip is one bus a sender can put a parcel on.
//
// Deliberately thin and non-identifying: a route, a plate, when it
// left, and how many stages it serves. No crew names — a sender
// choosing a bus has no business being handed the conductor's identity,
// and the plate is what they'd read off the side anyway.
type DepartingTrip struct {
	TripID       string `json:"tripId"`
	RouteName    string `json:"routeName"`
	VehiclePlate string `json:"vehiclePlate"`
	OrgName      string `json:"orgName"`
	StartedAt    string `json:"startedAt"`
	StageCount   int    `json:"stageCount"`
	ParcelsOn    int    `json:"parcelsOnBoard"`
}

// ListDepartingTrips — active trips a parcel could ride, newest first.
//
// Only ACTIVE trips with a named route: a trip with no shortRoute has
// no stages to drop at, so a sender choosing one would be picking a
// vehicle with nowhere to get off.
func ListDepartingTrips(ctx context.Context, pool *pgxpool.Pool, q string, limit int) ([]DepartingTrip, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := pool.Query(ctx, `
		SELECT t.id, r.name, v."plateNo", o.name,
		       to_char(t."startedAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       (SELECT count(*) FROM fare_stage fs WHERE fs."shortRouteId" = r.id),
		       (SELECT count(*) FROM parcel p
		          WHERE p."tripId" = t.id AND p."tripDroppedAt" IS NULL)
		FROM trip t
		JOIN fleet_vehicle v ON v.id = t."vehicleId"
		JOIN short_route r ON r.id = t."shortRouteId"
		JOIN ticket_org o ON o.id = t."orgId"
		WHERE t.status = 'ACTIVE'
		  AND ($1::text = '' OR r.name ILIKE '%'||$1||'%' OR o.name ILIKE '%'||$1||'%')
		ORDER BY t."startedAt" DESC
		LIMIT $2`, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DepartingTrip
	for rows.Next() {
		var t DepartingTrip
		if err := rows.Scan(&t.TripID, &t.RouteName, &t.VehiclePlate, &t.OrgName,
			&t.StartedAt, &t.StageCount, &t.ParcelsOn); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TripStage is one stop on a route, for the sender's "where should it
// come off" picker.
type TripStage struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Order int    `json:"order"`
}

func ListTripStages(ctx context.Context, pool *pgxpool.Pool, tripID string) ([]TripStage, error) {
	rows, err := pool.Query(ctx, `
		SELECT fs.id, fs.name, fs."order"
		FROM fare_stage fs
		JOIN trip t ON t."shortRouteId" = fs."shortRouteId"
		WHERE t.id = $1
		ORDER BY fs."order" ASC`, tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TripStage
	for rows.Next() {
		var s TripStage
		if err := rows.Scan(&s.ID, &s.Name, &s.Order); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// IsCrewOnTrip — is [partyID] the driver or conductor of [tripID], on a
// trip that is still running?
//
// Its own check rather than reusing MyActiveTrip because that function
// answers "what am I crewing" from a session's org context, and this
// answers "may this person touch this specific parcel's bus" — the
// second question has to hold even when the first is ambiguous (a
// person crewing two orgs, a stale org context).
func IsCrewOnTrip(ctx context.Context, pool *pgxpool.Pool, tripID, partyID string) (bool, error) {
	if partyID == "" {
		return false, nil
	}
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM trip t
			JOIN crew_member cm
			  ON cm.id = t."driverId" OR cm.id = t."conductorId"
			JOIN org_staff_grant g
			  ON g."crewMemberId" = cm.id AND g."partyId" = $2 AND g.status = 'ACTIVE'
			WHERE t.id = $1 AND t.status = 'ACTIVE'
		)`, tripID, partyID).Scan(&ok)
	return ok, err
}

// BoardParcelOnTrip puts a parcel the conductor is already holding onto
// their bus.
//
// Two separate facts, deliberately kept separate: the conductor must
// already hold the parcel (custody, established by a normal scan
// handoff), and they must be crew on this trip. Boarding is not a
// custody transfer — it records which vehicle the holder is currently
// on, which is what lets the tracking page show a bus instead of a dot.
//
// dropStageID is optional but strongly encouraged; without one the
// conductor gets no prompt at any stage, and a parcel with nobody
// telling it to get off rides to the terminus and back.
func BoardParcelOnTrip(ctx context.Context, pool *pgxpool.Pool, code, tripID, conductorPartyID string, dropStageID *string) error {
	var parcelID, status string
	var currentHolder *string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "currentHolderPartyId"::text FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &status, &currentHolder)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if currentHolder == nil || *currentHolder != conductorPartyID {
		return &ParcelError{"FORBIDDEN", "Accept the parcel first, then load it"}
	}
	if status != "PICKED_UP" && status != "IN_TRANSIT" && status != "FAILED_DELIVERY" {
		return &ParcelError{"BAD_INPUT", "This parcel isn't ready to travel"}
	}
	onCrew, err := IsCrewOnTrip(ctx, pool, tripID, conductorPartyID)
	if err != nil {
		return err
	}
	if !onCrew {
		return &ParcelError{"FORBIDDEN", "You aren't crewing that trip"}
	}
	// The stage has to belong to this trip's own route. Without this a
	// conductor could book a drop at a stage their bus never passes,
	// and the parcel would ride to the terminus with a prompt that
	// never fires.
	if dropStageID != nil && *dropStageID != "" {
		var belongs bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM fare_stage fs
				JOIN trip t ON t."shortRouteId" = fs."shortRouteId"
				WHERE fs.id = $1 AND t.id = $2
			)`, *dropStageID, tripID).Scan(&belongs); err != nil {
			return err
		}
		if !belongs {
			return &ParcelError{"BAD_INPUT", "That stop isn't on this bus's route"}
		}
	}
	_, err = pool.Exec(ctx, `
		UPDATE parcel SET
			"tripId" = $1, "tripBoardedAt" = now(), "tripDroppedAt" = NULL,
			"dropStageId" = COALESCE($2, "dropStageId"),
			status = 'IN_TRANSIT'
		WHERE id = $3`, tripID, dropStageID, parcelID)
	return err
}

// DropParcelFromTrip takes a parcel off at a stage.
//
// Custody stays with the conductor: the parcel is off the bus but still
// in somebody's hands until it reaches a receiver or a pickup point.
// Clearing custody here would create the one state the whole chain
// exists to prevent — a parcel nobody is accountable for, sitting on a
// pavement.
func DropParcelFromTrip(ctx context.Context, pool *pgxpool.Pool, code, conductorPartyID string) error {
	var parcelID string
	var tripID, currentHolder *string
	err := pool.QueryRow(ctx, `
		SELECT id, "tripId"::text, "currentHolderPartyId"::text FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &tripID, &currentHolder)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if tripID == nil || *tripID == "" {
		return &ParcelError{"BAD_INPUT", "That parcel isn't on a bus"}
	}
	if currentHolder == nil || *currentHolder != conductorPartyID {
		return &ParcelError{"FORBIDDEN", "You aren't holding this parcel"}
	}
	_, err = pool.Exec(ctx, `
		UPDATE parcel SET "tripDroppedAt" = now() WHERE id = $1`, parcelID)
	return err
}

// TripManifestRow is one line of the conductor's "what's in my boot".
type TripManifestRow struct {
	Code             string  `json:"code"`
	ReceiverName     string  `json:"receiverName"`
	ReceiverMsisdn   string  `json:"receiverMsisdn"`
	DestinationLabel string  `json:"destinationLabel"`
	DropStageName    *string `json:"dropStageName"`
	DropStageOrder   *int    `json:"dropStageOrder"`
	CodAmountKes     *string `json:"codAmountKes"`
	CodStatus        string  `json:"codStatus"`
}

// GetTripManifest — everything still on board [tripID], in the order
// it comes off.
//
// Ordered by stage so a conductor reads it the way the journey
// actually happens: the next stop's parcels are at the top. Sorting by
// booking time — the obvious default — would put them in an order that
// means nothing to anyone standing in a moving vehicle.
func GetTripManifest(ctx context.Context, pool *pgxpool.Pool, tripID string) ([]TripManifestRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT p.code, p."receiverName", p."receiverMsisdn", p."destinationLabel",
		       fs.name, fs."order", p."codAmountKes"::text, p."codStatus"
		FROM parcel p
		LEFT JOIN fare_stage fs ON fs.id = p."dropStageId"
		WHERE p."tripId" = $1 AND p."tripDroppedAt" IS NULL
		ORDER BY fs."order" ASC NULLS LAST, p."createdAt" ASC`, tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TripManifestRow
	for rows.Next() {
		var r TripManifestRow
		if err := rows.Scan(&r.Code, &r.ReceiverName, &r.ReceiverMsisdn, &r.DestinationLabel,
			&r.DropStageName, &r.DropStageOrder, &r.CodAmountKes, &r.CodStatus); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetParcelTripPosition — where the bus carrying [code] is.
//
// This is the reuse the whole feature rests on. VehiclePing already
// exists and is already written for the passengers riding this trip; a
// parcel in the boot inherits it at no extra cost, no extra device and
// no extra battery drain on anyone's phone.
//
// Same anonymity and staleness rules as the courier-ping equivalent:
// a position and its age, never an identity, and nothing older than
// the cap (a stale dot reads as "parked outside for an hour" when the
// truth is a phone stopped reporting).
func GetParcelTripPosition(ctx context.Context, pool *pgxpool.Pool, code string) (*CourierPosition, error) {
	var pos CourierPosition
	var latText, lngText string
	err := pool.QueryRow(ctx, `
		SELECT ping.lat::text, ping.lng::text, ping.at
		FROM parcel p
		JOIN LATERAL (
			SELECT lat, lng, at FROM vehicle_ping
			WHERE "tripId" = p."tripId"
			ORDER BY at DESC LIMIT 1
		) ping ON true
		WHERE p.code = $1
		  AND p."tripId" IS NOT NULL
		  AND p."tripDroppedAt" IS NULL
		  AND p.status IN ('PICKED_UP', 'IN_TRANSIT')
		  AND ping.at > now() - make_interval(mins => $2)`, code, courierPositionMaxAgeMins).
		Scan(&latText, &lngText, &pos.At)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if pos.Lat, err = parseFloatOrZero(latText); err != nil {
		return nil, err
	}
	if pos.Lng, err = parseFloatOrZero(lngText); err != nil {
		return nil, err
	}
	pos.StaleMins = int(time.Since(pos.At).Minutes())
	return &pos, nil
}

// ParcelTripInfo — the "it's on a bus" facts a tracking page shows
// alongside the map. Nil for a parcel travelling any other way.
type ParcelTripInfo struct {
	RouteName     string  `json:"routeName"`
	VehiclePlate  string  `json:"vehiclePlate"`
	OrgName       string  `json:"orgName"`
	DropStageName *string `json:"dropStageName"`
}

func GetParcelTripInfo(ctx context.Context, pool *pgxpool.Pool, code string) (*ParcelTripInfo, error) {
	var t ParcelTripInfo
	err := pool.QueryRow(ctx, `
		SELECT r.name, v."plateNo", o.name, fs.name
		FROM parcel p
		JOIN trip tr ON tr.id = p."tripId"
		JOIN fleet_vehicle v ON v.id = tr."vehicleId"
		JOIN ticket_org o ON o.id = tr."orgId"
		LEFT JOIN short_route r ON r.id = tr."shortRouteId"
		LEFT JOIN fare_stage fs ON fs.id = p."dropStageId"
		WHERE p.code = $1 AND p."tripDroppedAt" IS NULL`, code).
		Scan(&t.RouteName, &t.VehiclePlate, &t.OrgName, &t.DropStageName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}
