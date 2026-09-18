// Package dbx (parcel_org_dispatch.go) — a courier company's own dispatch runs.
//
// A dispatch is one vehicle on one origin → destination leg with its
// crew aboard and a receiving team waiting at the far end to check the
// run in on arrival. Tenant-level, like everything else in this file:
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
	DispatchRoleDriver = "DRIVER"
	DispatchRoleTout   = "TOUT"
	DispatchRoleLoader = "LOADER"
	DispatchRoleOther  = "OTHER"
)

// DispatchCrewRoleLabel renders a crew row for the board and the map
// popup — "Tout" rather than "TOUT", the custom title for OTHER.
func DispatchCrewRoleLabel(role, customRole string) string {
	if strings.ToUpper(strings.TrimSpace(role)) == DispatchRoleOther && strings.TrimSpace(customRole) != "" {
		return strings.TrimSpace(customRole)
	}
	switch strings.ToUpper(strings.TrimSpace(role)) {
	case DispatchRoleDriver:
		return "Driver"
	case DispatchRoleTout:
		return "Tout"
	case DispatchRoleLoader:
		return "Loader"
	default:
		return "Crew"
	}
}

// sanitizeDispatchRole keeps the stored role to the known set so the
// board can group and label reliably; anything unrecognised becomes
// OTHER with the original text kept as the custom title, so inventing
// a title never fails the save — it just renders as what was typed.
func sanitizeDispatchRole(role, customRole string) (string, *string) {
	r := strings.ToUpper(strings.TrimSpace(role))
	switch r {
	case DispatchRoleDriver, DispatchRoleTout, DispatchRoleLoader:
		return r, nil
	default:
		custom := strings.TrimSpace(customRole)
		if custom == "" {
			custom = strings.TrimSpace(role)
		}
		if custom == "" {
			return DispatchRoleOther, nil
		}
		return DispatchRoleOther, &custom
	}
}

type DispatchCrew struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Msisdn     *string `json:"msisdn"`
	Role       string  `json:"role"`
	CustomRole *string `json:"customRole"`
	StaffID    *string `json:"staffId"`
	// RoleLabel is derived (see DispatchCrewRoleLabel) so clients never
	// reimplement the OTHER-falls-back-to-custom title rule.
	RoleLabel string `json:"roleLabel"`
}

type DispatchReceiver struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	StaffID *string `json:"staffId"`
}

type DispatchStation struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	LocationHint string  `json:"locationHint"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
}

type DispatchPing struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
	At  string  `json:"at"`
}

type Dispatch struct {
	ID                 string            `json:"id"`
	VehiclePlate       string            `json:"vehiclePlate"`
	VehicleType        string            `json:"vehicleType"`
	Origin             *DispatchStation  `json:"origin"`
	Destination        *DispatchStation  `json:"destination"`
	Status             string            `json:"status"`
	Notes              *string           `json:"notes"`
	CurrentLat         *float64          `json:"currentLat"`
	CurrentLng         *float64          `json:"currentLng"`
	CurrentAt          *string           `json:"currentAt"`
	ArrivedAt          *string           `json:"arrivedAt"`
	ReceivedBy         *string           `json:"receivedBy"`
	CreatedAt          string            `json:"createdAt"`
	Crew               []DispatchCrew    `json:"crew"`
	Receivers          []DispatchReceiver `json:"receivers"`
	Trail              []DispatchPing    `json:"trail"`
}

type DispatchCrewInput struct {
	Name       string
	Msisdn     *string
	Role       string
	CustomRole *string
	StaffID    *string
}

type DispatchReceiverInput struct {
	Name    string
	StaffID *string
}

type CreateDispatchInput struct {
	VehiclePlate         string
	VehicleType          string
	OriginStationID      *string
	DestinationStationID *string
	Notes                *string
	Crew                 []DispatchCrewInput
	Receivers            []DispatchReceiverInput
	CreatedByStaffID     *string
}

// dispatchVehicleTypes — the console's vehicle picker. Free text would let
// a typo ("Vna") fork the board's grouping; OTHER keeps the escape
// hatch without forking anything.
var dispatchVehicleTypes = map[string]bool{
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

// CreateDispatch opens a run: vehicle, leg, crew and receiving team in
// one transaction, so the board never shows a half-written dispatch.
// Stations and roster links are re-checked against the org — ids arrive
// from the browser and are not trusted on their own.
func CreateDispatch(ctx context.Context, pool *pgxpool.Pool, orgID string, in CreateDispatchInput) (string, error) {
	plate := strings.ToUpper(strings.TrimSpace(in.VehiclePlate))
	if plate == "" {
		return "", &ParcelError{"BAD_INPUT", "The vehicle's number plate is required"}
	}
	vehicleType := strings.ToUpper(strings.TrimSpace(in.VehicleType))
	if !dispatchVehicleTypes[vehicleType] {
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
	if len(in.Crew) == 0 {
		return "", &ParcelError{"BAD_INPUT", "Add at least one crew member — a run with nobody aboard isn't a run"}
	}
	for i := range in.Crew {
		in.Crew[i].Name = strings.TrimSpace(in.Crew[i].Name)
		if in.Crew[i].Name == "" {
			return "", &ParcelError{"BAD_INPUT", "Every crew member needs a name"}
		}
		in.Crew[i].Role, in.Crew[i].CustomRole = sanitizeDispatchRole(in.Crew[i].Role, stringOrEmpty(in.Crew[i].CustomRole))
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
	err = tx.QueryRow(ctx, `
		INSERT INTO parcel_dispatch ("parcelOrgId", "vehiclePlate", "vehicleType",
			"originStationId", "destinationStationId", notes, "createdByStaffId", status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE') RETURNING id`,
		orgID, plate, vehicleType, in.OriginStationID, in.DestinationStationID, notes, in.CreatedByStaffID).Scan(&id)
	if err != nil {
		return "", err
	}
	for _, c := range in.Crew {
		if _, err := tx.Exec(ctx, `
			INSERT INTO parcel_dispatch_crew ("dispatchId", name, msisdn, role, "customRole", "staffId")
			VALUES ($1, $2, $3, $4, $5, $6)`,
			id, c.Name, c.Msisdn, c.Role, c.CustomRole, c.StaffID); err != nil {
			return "", err
		}
	}
	for _, r := range in.Receivers {
		if _, err := tx.Exec(ctx, `
			INSERT INTO parcel_dispatch_receiver ("dispatchId", name, "staffId")
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

func scanDispatchStation(id, name, hint, latText, lngText *string) (*DispatchStation, error) {
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
	return &DispatchStation{ID: *id, Name: nameVal, LocationHint: hintVal, Lat: lat, Lng: lng}, nil
}

// ListDispatches — the board: active runs first, then recently closed
// ones. Crew and receivers ride along so the board renders without a
// per-row fetch; the trail stays behind the detail endpoint (bounded
// there), because a board that drags every ping of every run is how a
// dispatch screen gets slow exactly when it matters.
func ListDispatches(ctx context.Context, pool *pgxpool.Pool, orgID string, includeClosed bool) ([]Dispatch, error) {
	statusFilter := `AND d.status = 'ACTIVE'`
	if includeClosed {
		statusFilter = ``
	}
	rows, err := pool.Query(ctx, `
		SELECT d.id, d."vehiclePlate", d."vehicleType",
		       o.id::text, o.name, o."locationHint", o.lat::text, o.lng::text,
		       t.id::text, t.name, t."locationHint", t.lat::text, t.lng::text,
		       d.status, d.notes,
		       d."currentLat"::text, d."currentLng"::text, d."currentAt"::text,
		       d."arrivedAt"::text, d."receivedBy", d."createdAt"::text
		FROM parcel_dispatch d
		LEFT JOIN parcel_agent o ON o.id = d."originStationId"
		LEFT JOIN parcel_agent t ON t.id = d."destinationStationId"
		WHERE d."parcelOrgId" = $1 `+statusFilter+`
		ORDER BY (d.status = 'ACTIVE') DESC, d."createdAt" DESC LIMIT 50`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Dispatch
	for rows.Next() {
		var d Dispatch
		var oID, oName, oHint, oLat, oLng *string
		var tID, tName, tHint, tLat, tLng *string
		var curLat, curLng, curAt *string
		if err := rows.Scan(&d.ID, &d.VehiclePlate, &d.VehicleType,
			&oID, &oName, &oHint, &oLat, &oLng,
			&tID, &tName, &tHint, &tLat, &tLng,
			&d.Status, &d.Notes, &curLat, &curLng, &curAt,
			&d.ArrivedAt, &d.ReceivedBy, &d.CreatedAt); err != nil {
			return nil, err
		}
		if d.Origin, err = scanDispatchStation(oID, oName, oHint, oLat, oLng); err != nil {
			return nil, err
		}
		if d.Destination, err = scanDispatchStation(tID, tName, tHint, tLat, tLng); err != nil {
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
		crew, err := listDispatchCrew(ctx, pool, orgID, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Crew = crew
		receivers, err := listDispatchReceivers(ctx, pool, orgID, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Receivers = receivers
		if out[i].Trail == nil {
			out[i].Trail = []DispatchPing{}
		}
	}
	return out, nil
}

func listDispatchCrew(ctx context.Context, pool *pgxpool.Pool, orgID, dispatchID string) ([]DispatchCrew, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.id, c.name, c.msisdn, c.role, c."customRole", c."staffId"::text
		FROM parcel_dispatch_crew c
		JOIN parcel_dispatch d ON d.id = c."dispatchId"
		WHERE c."dispatchId" = $1 AND d."parcelOrgId" = $2
		ORDER BY CASE c.role WHEN 'DRIVER' THEN 0 WHEN 'TOUT' THEN 1 WHEN 'LOADER' THEN 2 ELSE 3 END, c.name`, dispatchID, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DispatchCrew
	for rows.Next() {
		var c DispatchCrew
		if err := rows.Scan(&c.ID, &c.Name, &c.Msisdn, &c.Role, &c.CustomRole, &c.StaffID); err != nil {
			return nil, err
		}
		custom := stringOrEmpty(c.CustomRole)
		c.RoleLabel = DispatchCrewRoleLabel(c.Role, custom)
		out = append(out, c)
	}
	return out, rows.Err()
}

func listDispatchReceivers(ctx context.Context, pool *pgxpool.Pool, orgID, dispatchID string) ([]DispatchReceiver, error) {
	rows, err := pool.Query(ctx, `
		SELECT r.id, r.name, r."staffId"::text
		FROM parcel_dispatch_receiver r
		JOIN parcel_dispatch d ON d.id = r."dispatchId"
		WHERE r."dispatchId" = $1 AND d."parcelOrgId" = $2
		ORDER BY r.name`, dispatchID, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DispatchReceiver
	for rows.Next() {
		var r DispatchReceiver
		if err := rows.Scan(&r.ID, &r.Name, &r.StaffID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetDispatch — one run with its recent trail (last 200 points): the
// map's blue journey line plus where the vehicle actually went. Scoped
// by org so a run id from another company reads as not-found.
func GetDispatch(ctx context.Context, pool *pgxpool.Pool, orgID, dispatchID string) (*Dispatch, error) {
	lists, err := ListDispatches(ctx, pool, orgID, true)
	if err != nil {
		return nil, err
	}
	for i := range lists {
		if lists[i].ID != dispatchID {
			continue
		}
		d := &lists[i]
		rows, err := pool.Query(ctx, `
			SELECT p.lat::text, p.lng::text, p.at::text
			FROM parcel_dispatch_ping p
			JOIN parcel_dispatch d ON d.id = p."dispatchId"
			WHERE p."dispatchId" = $1 AND d."parcelOrgId" = $2
			ORDER BY p.at DESC LIMIT 200`, dispatchID, orgID)
		if err != nil {
			return nil, err
		}
		var trail []DispatchPing
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
			trail = append(trail, DispatchPing{Lat: lat, Lng: lng, At: at})
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

// ReportDispatchPosition records where the run is: the board marker
// moves to it and the point joins the trail. Only ACTIVE runs accept
// positions — a checked-in run's trail is history, not something a
// stale phone should keep rewriting.
func ReportDispatchPosition(ctx context.Context, pool *pgxpool.Pool, orgID, dispatchID string, lat, lng float64) error {
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
		UPDATE parcel_dispatch SET "currentLat" = $3, "currentLng" = $4, "currentAt" = now()
		WHERE id = $1 AND "parcelOrgId" = $2 AND status = 'ACTIVE' RETURNING id`,
		dispatchID, orgID, lat, lng).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That run isn't active — or isn't one of yours"}
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_dispatch_ping ("dispatchId", lat, lng) VALUES ($1, $2, $3)`, id, lat, lng); err != nil {
		return err
	}
	// Keep the trail bounded: a run that pings for weeks must not grow
	// its history — or the detail payload — without limit.
	if _, err := tx.Exec(ctx, `
		DELETE FROM parcel_dispatch_ping WHERE "dispatchId" = $1 AND id NOT IN (
			SELECT id FROM parcel_dispatch_ping WHERE "dispatchId" = $1 ORDER BY at DESC LIMIT 200
		)`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ArriveDispatch checks a run in: the receiving team's moment. Who
// signed is recorded free-text (the person at the counter may not hold
// a login), defaulting to the named receiving team when the field is
// left blank. Only ACTIVE runs can arrive.
func ArriveDispatch(ctx context.Context, pool *pgxpool.Pool, orgID, dispatchID, receivedBy string) error {
	receivedBy = strings.TrimSpace(receivedBy)
	if receivedBy == "" {
		var fallback *string
		err := pool.QueryRow(ctx, `
			SELECT string_agg(r.name, ', ') FROM parcel_dispatch_receiver r
			JOIN parcel_dispatch d ON d.id = r."dispatchId"
			WHERE r."dispatchId" = $1 AND d."parcelOrgId" = $2`, dispatchID, orgID).Scan(&fallback)
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
		UPDATE parcel_dispatch SET status = 'ARRIVED', "arrivedAt" = now(), "receivedBy" = $3
		WHERE id = $1 AND "parcelOrgId" = $2 AND status = 'ACTIVE'`, dispatchID, orgID, receivedBy)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That run isn't active — or isn't one of yours"}
	}
	return nil
}

// CancelDispatch calls a run off before it arrives. History stays
// readable; only the board stops showing it as live.
func CancelDispatch(ctx context.Context, pool *pgxpool.Pool, orgID, dispatchID string) error {
	res, err := pool.Exec(ctx, `
		UPDATE parcel_dispatch SET status = 'CANCELLED'
		WHERE id = $1 AND "parcelOrgId" = $2 AND status = 'ACTIVE'`, dispatchID, orgID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That run isn't active — or isn't one of yours"}
	}
	return nil
}
