// Package dbx (parcel_org_runs.go) — a courier company's own vehicle runs.
//
// A run is one vehicle on one origin → destination leg with its crew
// aboard, a receiving team waiting at the far end, AND the parcels
// loaded onto it. That last part is new: until ADR-0006 this was
// parcel_dispatch, a table with stations, crew and a GPS trail but no
// cargo at all, while parcel_shipment held the cargo and knew places
// only as free text. One lorry, two rows, no key between them. Both
// now live in parcel_shipment, and everything here reads that table.
//
// Tenant-level, like everything else in this file:
// every read and write is filtered by the session's ParcelOrgID, and
// stations/staff referenced by a run are re-checked against the same
// org so a run can never point at a competitor's station or roster.
//
// Crew roles are plain strings (DRIVER, TOUT, LOADER, OTHER with an
// optional free-text customRole), the same convention
// ParcelOrgStaff.role follows — a fixed enum would need a migration
// every time a company invents a job title. Sanitised, not validated
// against a closed list, for the same reason; unknown roles are
// display text, never capabilities.
package dbx

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Dispatch crew roles the console offers. OTHER carries a free-text
// customRole; the rest ignore it.
const (
	RunRoleDriver = "DRIVER"
	RunRoleTout   = "TOUT"
	RunRoleLoader = "LOADER"
	RunRoleOther  = "OTHER"
)

// RunCrewRoleLabel renders a crew row for the board and the map
// popup — "Tout" rather than "TOUT", the custom title for OTHER.
func RunCrewRoleLabel(role, customRole string) string {
	if strings.ToUpper(strings.TrimSpace(role)) == RunRoleOther && strings.TrimSpace(customRole) != "" {
		return strings.TrimSpace(customRole)
	}
	switch strings.ToUpper(strings.TrimSpace(role)) {
	case RunRoleDriver:
		return "Driver"
	case RunRoleTout:
		return "Tout"
	case RunRoleLoader:
		return "Loader"
	default:
		return "Crew"
	}
}

// sanitizeRunRole keeps the stored role to the known set so the
// board can group and label reliably; anything unrecognised becomes
// OTHER with the original text kept as the custom title, so inventing
// a title never fails the save — it just renders as what was typed.
func sanitizeRunRole(role, customRole string) (string, *string) {
	r := strings.ToUpper(strings.TrimSpace(role))
	switch r {
	case RunRoleDriver, RunRoleTout, RunRoleLoader:
		return r, nil
	default:
		custom := strings.TrimSpace(customRole)
		if custom == "" {
			custom = strings.TrimSpace(role)
		}
		if custom == "" {
			return RunRoleOther, nil
		}
		return RunRoleOther, &custom
	}
}

type RunCrew struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Msisdn     *string `json:"msisdn"`
	Role       string  `json:"role"`
	CustomRole *string `json:"customRole"`
	StaffID    *string `json:"staffId"`
	// RoleLabel is derived (see RunCrewRoleLabel) so clients never
	// reimplement the OTHER-falls-back-to-custom title rule.
	RoleLabel string `json:"roleLabel"`
}

type RunReceiver struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	StaffID *string `json:"staffId"`
}

type RunStation struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	LocationHint string  `json:"locationHint"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
}

type RunPing struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
	At  string  `json:"at"`
}

type Dispatch struct {
	ID                 string            `json:"id"`
	VehiclePlate       string            `json:"vehiclePlate"`
	VehicleType        string            `json:"vehicleType"`
	Origin             *RunStation  `json:"origin"`
	Destination        *RunStation  `json:"destination"`
	Status             string            `json:"status"`
	Notes              *string           `json:"notes"`
	CurrentLat         *float64          `json:"currentLat"`
	CurrentLng         *float64          `json:"currentLng"`
	CurrentAt          *string           `json:"currentAt"`
	ArrivedAt          *string           `json:"arrivedAt"`
	ReceivedBy         *string           `json:"receivedBy"`
	CreatedAt          string            `json:"createdAt"`
	// The route followed, when one was chosen. Nil for an ad-hoc run.
	RouteID            *string           `json:"routeId"`
	RouteName          *string           `json:"routeName"`
	// How many parcels are aboard — the number the merge exists to make
	// answerable from the board. A dispatch could never report it.
	Loaded             int               `json:"loaded"`
	Crew               []RunCrew    `json:"crew"`
	Receivers          []RunReceiver `json:"receivers"`
	Trail              []RunPing    `json:"trail"`
}

type RunCrewInput struct {
	Name       string
	Msisdn     *string
	Role       string
	CustomRole *string
	StaffID    *string
}

type RunReceiverInput struct {
	Name    string
	StaffID *string
}

type CreateRunInput struct {
	VehiclePlate         string
	VehicleType          string
	OriginStationID      *string
	DestinationStationID *string
	// The route this run follows, when it follows a planned one. Nil is
	// an ad-hoc run — a vehicle at the door that nobody scheduled — and
	// must stay possible, or the counter stops during exactly the rush
	// the ad-hoc run exists to absorb (ADR-0006).
	RouteID *string
	Notes                *string
	Crew                 []RunCrewInput
	Receivers            []RunReceiverInput
	CreatedByStaffID     *string
}

// runVehicleTypes — the console's vehicle picker. Free text would let
// a typo ("Vna") fork the board's grouping; OTHER keeps the escape
// hatch without forking anything.
var runVehicleTypes = map[string]bool{
	"VAN": true, "TRUCK": true, "BUS": true, "PICKUP": true, "MOTORBIKE": true, "OTHER": true,
}

func stationBelongsToOrg(ctx context.Context, pool *pgxpool.Pool, orgID, stationID string) (bool, error) {
	var n int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM parcel_agent WHERE id = $1 AND "parcelOrgId" = $2`, stationID, orgID).Scan(&n)
	return n > 0, err
}

func staffBelongsToOrg(ctx context.Context, pool *pgxpool.Pool, orgID, staffID string) (bool, error) {
	var n int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM parcel_org_staff WHERE id = $1 AND "orgId" = $2 AND active`, staffID, orgID).Scan(&n)
	return n > 0, err
}

// routeBelongsToOrg — same tenancy check as the station and crew ones
// above, for the one foreign id CreateRun was still taking on trust.
// A routeId is a client-supplied string like every other id here, so
// without this a manager could attach ANY courier company's route to
// their own run — and, because the route name comes back in ListRuns
// through the same join, read that competitor's route names and station
// endpoints off their own dispatch board.
func routeBelongsToOrg(ctx context.Context, pool *pgxpool.Pool, orgID, routeID string) (bool, error) {
	var n int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM parcel_route WHERE id = $1 AND "parcelOrgId" = $2`, routeID, orgID).Scan(&n)
	return n > 0, err
}

// CreateRun opens a run: vehicle, leg, crew and receiving team in
// one transaction, so the board never shows a half-written dispatch.
// Stations and roster links are re-checked against the org — ids arrive
// from the browser and are not trusted on their own.
func CreateRun(ctx context.Context, pool *pgxpool.Pool, orgID string, in CreateRunInput) (string, error) {
	plate := strings.ToUpper(strings.TrimSpace(in.VehiclePlate))
	if plate == "" {
		return "", &ParcelError{"BAD_INPUT", "The vehicle's number plate is required"}
	}
	vehicleType := strings.ToUpper(strings.TrimSpace(in.VehicleType))
	if !runVehicleTypes[vehicleType] {
		vehicleType = "OTHER"
	}
	if in.OriginStationID != nil && *in.OriginStationID != "" {
		ok, err := stationBelongsToOrg(ctx, pool, orgID, *in.OriginStationID)
		if err != nil {
			return "", err
		}
		if !ok {
			return "", &ParcelError{"NOT_FOUND", "That origin station isn't one of yours"}
		}
	} else {
		in.OriginStationID = nil
	}
	if in.DestinationStationID != nil && *in.DestinationStationID != "" {
		ok, err := stationBelongsToOrg(ctx, pool, orgID, *in.DestinationStationID)
		if err != nil {
			return "", err
		}
		if !ok {
			return "", &ParcelError{"NOT_FOUND", "That destination station isn't one of yours"}
		}
	} else {
		in.DestinationStationID = nil
	}
	// The route is a foreign id like the stations, and gets the same
	// treatment — see routeBelongsToOrg on why leaving it unchecked let a
	// manager read another company's route names off their own board.
	if in.RouteID != nil && *in.RouteID != "" {
		ok, err := routeBelongsToOrg(ctx, pool, orgID, *in.RouteID)
		if err != nil {
			return "", err
		}
		if !ok {
			return "", &ParcelError{"NOT_FOUND", "That route isn't one of yours"}
		}
	} else {
		in.RouteID = nil
	}
	if len(in.Crew) == 0 {
		return "", &ParcelError{"BAD_INPUT", "Add at least one crew member — a run with nobody aboard isn't a run"}
	}
	for i := range in.Crew {
		in.Crew[i].Name = strings.TrimSpace(in.Crew[i].Name)
		if in.Crew[i].Name == "" {
			return "", &ParcelError{"BAD_INPUT", "Every crew member needs a name"}
		}
		in.Crew[i].Role, in.Crew[i].CustomRole = sanitizeRunRole(in.Crew[i].Role, stringOrEmpty(in.Crew[i].CustomRole))
		if in.Crew[i].CustomRole != nil && strings.TrimSpace(*in.Crew[i].CustomRole) == "" {
			in.Crew[i].CustomRole = nil
		}
		if in.Crew[i].StaffID != nil && *in.Crew[i].StaffID != "" {
			ok, err := staffBelongsToOrg(ctx, pool, orgID, *in.Crew[i].StaffID)
			if err != nil {
				return "", err
			}
			if !ok {
				return "", &ParcelError{"NOT_FOUND", in.Crew[i].Name + " isn't on your team"}
			}
		} else {
			in.Crew[i].StaffID = nil
		}
		if in.Crew[i].Msisdn != nil && strings.TrimSpace(*in.Crew[i].Msisdn) == "" {
			in.Crew[i].Msisdn = nil
		}
	}
	for i := range in.Receivers {
		in.Receivers[i].Name = strings.TrimSpace(in.Receivers[i].Name)
		if in.Receivers[i].Name == "" {
			return "", &ParcelError{"BAD_INPUT", "Every receiving team member needs a name"}
		}
		if in.Receivers[i].StaffID != nil && *in.Receivers[i].StaffID != "" {
			ok, err := staffBelongsToOrg(ctx, pool, orgID, *in.Receivers[i].StaffID)
			if err != nil {
				return "", err
			}
			if !ok {
				return "", &ParcelError{"NOT_FOUND", in.Receivers[i].Name + " isn't on your team"}
			}
		} else {
			in.Receivers[i].StaffID = nil
		}
	}
	if in.CreatedByStaffID != nil && *in.CreatedByStaffID != "" {
		ok, err := staffBelongsToOrg(ctx, pool, orgID, *in.CreatedByStaffID)
		if err != nil {
			return "", err
		}
		if !ok {
			in.CreatedByStaffID = nil
		}
	} else {
		in.CreatedByStaffID = nil
	}
	var notes *string
	if in.Notes != nil && strings.TrimSpace(*in.Notes) != "" {
		n := strings.TrimSpace(*in.Notes)
		notes = &n
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var id string
	// LOADING, not DEPARTED: a run now has a cargo phase, which is the
	// whole point of the merge (ADR-0006). A dispatch used to be created
	// at the moment a vehicle set off because it had no parcels to wait
	// for; this one can be opened at the shed and loaded against.
	//
	// The labels are written from the chosen stations and are a SNAPSHOT
	// from here on — renaming a station later must not rewrite what a
	// manifest printed today said. They are also NOT NULL on this table,
	// so there is no option to leave them out.
	err = tx.QueryRow(ctx, `
		INSERT INTO parcel_shipment (id, "parcelOrgId", "vehiclePlate", "vehicleType",
			"originStationId", "destinationStationId", "routeId", notes, "createdByStaffId",
			"originLabel", "destinationLabel", status)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
			COALESCE((SELECT name FROM parcel_agent WHERE id = $4), 'Origin'),
			COALESCE((SELECT name FROM parcel_agent WHERE id = $5), 'Destination'),
			'LOADING')
		RETURNING id`,
		orgID, plate, vehicleType, in.OriginStationID, in.DestinationStationID,
		in.RouteID, notes, in.CreatedByStaffID).Scan(&id)
	if err != nil {
		return "", err
	}
	for _, c := range in.Crew {
		if _, err := tx.Exec(ctx, `
			INSERT INTO parcel_run_crew ("runId", name, msisdn, role, "customRole", "staffId")
			VALUES ($1, $2, $3, $4, $5, $6)`,
			id, c.Name, c.Msisdn, c.Role, c.CustomRole, c.StaffID); err != nil {
			return "", err
		}
	}
	for _, r := range in.Receivers {
		if _, err := tx.Exec(ctx, `
			INSERT INTO parcel_run_receiver ("runId", name, "staffId")
			VALUES ($1, $2, $3)`, id, r.Name, r.StaffID); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

func stringOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func scanRunStation(id, name, hint, latText, lngText *string) (*RunStation, error) {
	if id == nil || *id == "" {
		return nil, nil
	}
	lat, err := parseFloatOrZero(stringOrEmpty(latText))
	if err != nil {
		return nil, err
	}
	lng, err := parseFloatOrZero(stringOrEmpty(lngText))
	if err != nil {
		return nil, err
	}
	nameVal, hintVal := "", ""
	if name != nil {
		nameVal = *name
	}
	if hint != nil {
		hintVal = *hint
	}
	return &RunStation{ID: *id, Name: nameVal, LocationHint: hintVal, Lat: lat, Lng: lng}, nil
}

// ListRuns — the board: active runs first, then recently closed
// ones. Crew and receivers ride along so the board renders without a
// per-row fetch; the trail stays behind the detail endpoint (bounded
// there), because a board that drags every ping of every run is how a
// dispatch screen gets slow exactly when it matters.
func ListRuns(ctx context.Context, pool *pgxpool.Pool, orgID string, includeClosed bool) ([]Dispatch, error) {
	// A run is "open" in two states now, where a dispatch had one:
	// still at the shed taking boxes, or out on the road. Both are runs
	// a dispatcher is responsible for today.
	statusFilter := `AND d.status IN ('LOADING', 'DEPARTED')`
	if includeClosed {
		statusFilter = ``
	}
	rows, err := pool.Query(ctx, `
		SELECT d.id, d."vehiclePlate", d."vehicleType",
		       o.id::text, o.name, o."locationHint", o.lat::text, o.lng::text,
		       t.id::text, t.name, t."locationHint", t.lat::text, t.lng::text,
		       d.status, d.notes,
		       d."currentLat"::text, d."currentLng"::text, d."currentAt"::text,
		       d."arrivedAt"::text, d."receivedBy", d."createdAt"::text,
		       d."routeId"::text, r.name,
		       (SELECT count(*) FROM parcel_shipment_item i
		         WHERE i."shipmentId" = d.id AND i."loadedAt" IS NOT NULL
		           AND i."offloadedAt" IS NULL)
		FROM parcel_shipment d
		LEFT JOIN parcel_agent o ON o.id = d."originStationId"
		LEFT JOIN parcel_agent t ON t.id = d."destinationStationId"
		-- Scoped to the caller's own org, not just on d."routeId". A row
		-- created before route ownership was checked can point at another
		-- company's route, and an unqualified join would hand its name
		-- back on this org's own board. The predicate makes that a NULL
		-- route rather than a competitor's name; routeBelongsToOrg stops
		-- any new one being created.
		LEFT JOIN parcel_route r ON r.id = d."routeId" AND r."parcelOrgId" = d."parcelOrgId"
		WHERE d."parcelOrgId" = $1 `+statusFilter+`
		ORDER BY (d.status IN ('LOADING', 'DEPARTED')) DESC, d."createdAt" DESC LIMIT 50`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Dispatch{}
	for rows.Next() {
		var d Dispatch
		var oID, oName, oHint, oLat, oLng *string
		var tID, tName, tHint, tLat, tLng *string
		var curLat, curLng, curAt *string
		if err := rows.Scan(&d.ID, &d.VehiclePlate, &d.VehicleType,
			&oID, &oName, &oHint, &oLat, &oLng,
			&tID, &tName, &tHint, &tLat, &tLng,
			&d.Status, &d.Notes, &curLat, &curLng, &curAt,
			&d.ArrivedAt, &d.ReceivedBy, &d.CreatedAt,
			&d.RouteID, &d.RouteName, &d.Loaded); err != nil {
			return nil, err
		}
		if d.Origin, err = scanRunStation(oID, oName, oHint, oLat, oLng); err != nil {
			return nil, err
		}
		if d.Destination, err = scanRunStation(tID, tName, tHint, tLat, tLng); err != nil {
			return nil, err
		}
		if curLat != nil && *curLat != "" {
			v, err := parseFloatOrZero(*curLat)
			if err != nil {
				return nil, err
			}
			d.CurrentLat = &v
		}
		if curLng != nil && *curLng != "" {
			v, err := parseFloatOrZero(*curLng)
			if err != nil {
				return nil, err
			}
			d.CurrentLng = &v
		}
		if curAt != nil && *curAt != "" {
			d.CurrentAt = curAt
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		crew, err := listRunCrew(ctx, pool, orgID, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Crew = crew
		receivers, err := listRunReceivers(ctx, pool, orgID, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Receivers = receivers
		if out[i].Trail == nil {
			out[i].Trail = []RunPing{}
		}
	}
	return out, nil
}

func listRunCrew(ctx context.Context, pool *pgxpool.Pool, orgID, runID string) ([]RunCrew, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.id, c.name, c.msisdn, c.role, c."customRole", c."staffId"::text
		FROM parcel_run_crew c
		JOIN parcel_shipment d ON d.id = c."runId"
		WHERE c."runId" = $1 AND d."parcelOrgId" = $2
		ORDER BY CASE c.role WHEN 'DRIVER' THEN 0 WHEN 'TOUT' THEN 1 WHEN 'LOADER' THEN 2 ELSE 3 END, c.name`, runID, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RunCrew{}
	for rows.Next() {
		var c RunCrew
		if err := rows.Scan(&c.ID, &c.Name, &c.Msisdn, &c.Role, &c.CustomRole, &c.StaffID); err != nil {
			return nil, err
		}
		custom := stringOrEmpty(c.CustomRole)
		c.RoleLabel = RunCrewRoleLabel(c.Role, custom)
		out = append(out, c)
	}
	return out, rows.Err()
}

func listRunReceivers(ctx context.Context, pool *pgxpool.Pool, orgID, runID string) ([]RunReceiver, error) {
	rows, err := pool.Query(ctx, `
		SELECT r.id, r.name, r."staffId"::text
		FROM parcel_run_receiver r
		JOIN parcel_shipment d ON d.id = r."runId"
		WHERE r."runId" = $1 AND d."parcelOrgId" = $2
		ORDER BY r.name`, runID, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RunReceiver{}
	for rows.Next() {
		var r RunReceiver
		if err := rows.Scan(&r.ID, &r.Name, &r.StaffID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRun — one run with its recent trail (last 200 points): the
// map's blue journey line plus where the vehicle actually went. Scoped
// by org so a run id from another company reads as not-found.
func GetRun(ctx context.Context, pool *pgxpool.Pool, orgID, runID string) (*Dispatch, error) {
	lists, err := ListRuns(ctx, pool, orgID, true)
	if err != nil {
		return nil, err
	}
	for i := range lists {
		if lists[i].ID != runID {
			continue
		}
		d := &lists[i]
		rows, err := pool.Query(ctx, `
			SELECT p.lat::text, p.lng::text, p.at::text
			FROM parcel_run_ping p
			JOIN parcel_shipment d ON d.id = p."runId"
			WHERE p."runId" = $1 AND d."parcelOrgId" = $2
			ORDER BY p.at DESC LIMIT 200`, runID, orgID)
		if err != nil {
			return nil, err
		}
		trail := []RunPing{}
		for rows.Next() {
			var latText, lngText, at string
			if err := rows.Scan(&latText, &lngText, &at); err != nil {
				rows.Close()
				return nil, err
			}
			lat, err := parseFloatOrZero(latText)
			if err != nil {
				rows.Close()
				return nil, err
			}
			lng, err := parseFloatOrZero(lngText)
			if err != nil {
				rows.Close()
				return nil, err
			}
			trail = append(trail, RunPing{Lat: lat, Lng: lng, At: at})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		// Oldest first — the map draws the line in travel order.
		for a, b := 0, len(trail)-1; a < b; a, b = a+1, b-1 {
			trail[a], trail[b] = trail[b], trail[a]
		}
		d.Trail = trail
		return d, nil
	}
	return nil, nil
}

// ReportRunPosition records where the run is: the board marker
// moves to it and the point joins the trail. Only ACTIVE runs accept
// positions — a checked-in run's trail is history, not something a
// stale phone should keep rewriting.
func ReportRunPosition(ctx context.Context, pool *pgxpool.Pool, orgID, runID string, lat, lng float64) error {
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return &ParcelError{"BAD_INPUT", "That position doesn't look like real coordinates"}
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id string
	err = tx.QueryRow(ctx, `
		UPDATE parcel_shipment SET "currentLat" = $3, "currentLng" = $4, "currentAt" = now()
		WHERE id = $1 AND "parcelOrgId" = $2 AND status = 'DEPARTED' RETURNING id`,
		runID, orgID, lat, lng).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That run isn't active — or isn't one of yours"}
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_run_ping ("runId", lat, lng) VALUES ($1, $2, $3)`, id, lat, lng); err != nil {
		return err
	}
	// Keep the trail bounded: a run that pings for weeks must not grow
	// its history — or the detail payload — without limit.
	if _, err := tx.Exec(ctx, `
		DELETE FROM parcel_run_ping WHERE "runId" = $1 AND id NOT IN (
			SELECT id FROM parcel_run_ping WHERE "runId" = $1 ORDER BY at DESC LIMIT 200
		)`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ArriveRun checks a run in: the receiving team's moment. Who
// signed is recorded free-text (the person at the counter may not hold
// a login), defaulting to the named receiving team when the field is
// left blank. Only ACTIVE runs can arrive.
func ArriveRun(ctx context.Context, pool *pgxpool.Pool, orgID, runID, receivedBy string) error {
	receivedBy = strings.TrimSpace(receivedBy)
	if receivedBy == "" {
		var fallback *string
		err := pool.QueryRow(ctx, `
			SELECT string_agg(r.name, ', ') FROM parcel_run_receiver r
			JOIN parcel_shipment d ON d.id = r."runId"
			WHERE r."runId" = $1 AND d."parcelOrgId" = $2`, runID, orgID).Scan(&fallback)
		if err != nil {
			return err
		}
		if fallback != nil {
			receivedBy = *fallback
		}
	}
	if receivedBy == "" {
		return &ParcelError{"BAD_INPUT", "Say who received the run — a name at the counter is enough"}
	}
	res, err := pool.Exec(ctx, `
		UPDATE parcel_shipment SET status = 'ARRIVED', "arrivedAt" = now(), "receivedBy" = $3
		WHERE id = $1 AND "parcelOrgId" = $2 AND status = 'DEPARTED'`, runID, orgID, receivedBy)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That run isn't active — or isn't one of yours"}
	}
	return nil
}

// CancelRun calls a run off before it arrives. History stays
// readable; only the board stops showing it as live.
//
// Cancelling the run also puts its cargo back, in the same transaction.
// The boxes on a called-off run were left loaded: their manifest items
// still carried loadedAt with no offloadedAt, and their parcels were
// flipped to IN_TRANSIT at load time. Nothing else moves them — the only
// other writer of offloadedAt is the offload scan, and a run that is
// CANCELLED has no arrival to scan against. So every parcel on it sat
// IN_TRANSIT, on a run that does not exist, until a platform admin with
// parcels.assign intervened. A load that never became a journey should
// not leave the parcel claiming it is one.
func CancelRun(ctx context.Context, pool *pgxpool.Pool, orgID, runID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	res, err := tx.Exec(ctx, `
		UPDATE parcel_shipment SET status = 'CANCELLED'
		WHERE id = $1 AND "parcelOrgId" = $2 AND status IN ('LOADING', 'DEPARTED')`, runID, orgID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That run isn't active — or isn't one of yours"}
	}

	// Cargo is released in one of two ways, and which one is correct
	// depends on whether the run had actually left. Both used to be the
	// second one, unconditionally.
	//
	// A LOADING run never departed: its boxes are sitting at the origin
	// station and "received at counter" is the truth. They go back to
	// RECEIVED_AT_COUNTER, which is also the state the ops queue's
	// ready_to_load is built to pick up again.
	//
	// A DEPARTED run was on the road. Its boxes are somewhere between the
	// two stations — not at the origin, and not necessarily at the
	// destination either. Rewinding them to RECEIVED_AT_COUNTER asserted a
	// location nobody had observed, and did it silently: the parcel's
	// public tracker would go from "in transit, courier en route" back to
	// "received at Kilimani Hub", so a sender would be told their box was
	// waiting at the depot when the vehicle was halfway to Westlands. The
	// parcel is also no longer claimable by this run, so nobody would
	// touch it again without a platform admin intervening.
	//
	// So departed cargo is left where it is and made someone's problem
	// explicitly: the parcel keeps its status (it really is still moving,
	// or still sitting in a vehicle nobody has accounted for), and the
	// manifest item is stamped as an exception rather than quietly
	// offloaded. That routes it to the ops queue's arrival_exception,
	// which is built to find exactly "an item with an exception and no
	// offload" — so the boxes surface to a human instead of to nobody.
	//
	// This is the one place in the vertical where a status change is a
	// product decision rather than a mechanical consequence, and it is
	// deliberately the conservative one: claiming less about where a box
	// is beats asserting a location the system does not know.
	if _, err := tx.Exec(ctx, `
		UPDATE parcel p SET status = 'RECEIVED_AT_COUNTER'
		FROM parcel_shipment_item i
		WHERE i."shipmentId" = $1 AND i."parcelId" = p.id
		  AND i."loadedAt" IS NOT NULL AND i."offloadedAt" IS NULL
		  AND p.status = 'IN_TRANSIT'
		  AND EXISTS (
			SELECT 1 FROM parcel_shipment s
			WHERE s.id = $1 AND s."startedAt" IS NULL
		  )`, runID); err != nil {
		return err
	}

	// The manifest items are closed out rather than left open: an item
	// with loadedAt and no offloadedAt is exactly what the per-run
	// outstanding counts are built to find, so a called-off run would
	// otherwise report forever as a run with boxes still on board.
	// Marked offloaded (not deleted) so the load it records survives for
	// the audit trail.
	//
	// Departed cargo is the exception to the exception: it is stamped
	// exceptionCode = 'RUN_CANCELLED' and deliberately left un-offloaded,
	// which is what puts it in the arrival_exception queue. Offloading it
	// here would hide the very thing an operator needs to see.
	if _, err := tx.Exec(ctx, `
		UPDATE parcel_shipment_item SET
			"offloadedAt"  = CASE WHEN EXISTS (
			                    SELECT 1 FROM parcel_shipment s
			                    WHERE s.id = $1 AND s."startedAt" IS NULL)
			                  THEN COALESCE("offloadedAt", now())
			                  ELSE "offloadedAt" END,
			"exceptionCode" = CASE WHEN EXISTS (
			                    SELECT 1 FROM parcel_shipment s
			                    WHERE s.id = $1 AND s."startedAt" IS NOT NULL)
			                  THEN COALESCE("exceptionCode", 'RUN_CANCELLED')
			                  ELSE "exceptionCode" END,
			"exceptionNote" = CASE WHEN EXISTS (
			                    SELECT 1 FROM parcel_shipment s
			                    WHERE s.id = $1 AND s."startedAt" IS NOT NULL)
			                  THEN COALESCE("exceptionNote",
			                       'Run cancelled after departure — cargo location unconfirmed, needs recount')
			                  ELSE "exceptionNote" END
		WHERE "shipmentId" = $1 AND "loadedAt" IS NOT NULL AND "offloadedAt" IS NULL`, runID); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}
