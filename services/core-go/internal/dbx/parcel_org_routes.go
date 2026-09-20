// Package dbx (parcel_org_routes.go) — a courier company's own routes.
//
// A route is an ordered list of stations the company serves: Nairobi →
// Nakuru → Kisumu. Until ADR-0006 a run's places were three free-text
// columns, which meant "Nairobi", "nairobi" and "NBO" were three
// different destinations, nothing could be grouped or priced by route,
// and there was no vocabulary for saying where a parcel changes vehicle.
//
// A LEG is a consecutive pair of stops. There is deliberately no leg
// table: a parcel riding two vehicles is already two parcel_shipment_item
// rows with load/offload times, and it always was — what was missing was
// names for the places in between, not a way to record the transfer.
//
// Tenant-scoped in SQL like every other file here: a route and each of
// its stations are proved to belong to the session's org inside the
// query, so a guessed id is indistinguishable from one that does not
// exist.
package dbx

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RouteStop is one station on a route. Sequence is dense and 0-based.
type RouteStop struct {
	ID           string  `json:"id"`
	Sequence     int     `json:"sequence"`
	StationID    string  `json:"stationId"`
	StationName  string  `json:"stationName"`
	LocationHint string  `json:"locationHint"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
}

type Route struct {
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Code   *string     `json:"code"`
	Active bool        `json:"active"`
	Stops  []RouteStop `json:"stops"`
	// How many runs currently cite this route and are not yet closed —
	// what makes deactivating one a decision rather than a click.
	OpenRuns int `json:"openRuns"`
}

type RouteInput struct {
	Name string
	Code *string
	// Station ids in travel order. The sequence is positional: the
	// caller's array order IS the route, so reordering on the client is
	// a resend rather than a separate move-stop endpoint.
	StationIDs []string
	Active     bool
}

// ListRoutes — every route this company has, with stops in order.
//
// Two queries rather than a join with array_agg: the stop list is small
// and bounded, and assembling it in Go keeps the ordering explicit
// instead of depending on an aggregate's ordering clause being right.
func ListRoutes(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]Route, error) {
	rows, err := pool.Query(ctx, `
		SELECT r.id, r.name, r.code, r.active,
		       (SELECT count(*) FROM parcel_shipment s
		         WHERE s."routeId" = r.id AND s.status IN ('LOADING', 'DEPARTED'))
		FROM parcel_route r
		WHERE r."parcelOrgId" = $1
		ORDER BY r.active DESC, r.name`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	routes := []Route{}
	byID := map[string]int{}
	for rows.Next() {
		var r Route
		if err := rows.Scan(&r.ID, &r.Name, &r.Code, &r.Active, &r.OpenRuns); err != nil {
			return nil, err
		}
		r.Stops = []RouteStop{}
		byID[r.ID] = len(routes)
		routes = append(routes, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(routes) == 0 {
		return routes, nil
	}

	stopRows, err := pool.Query(ctx, `
		SELECT st."routeId", st.id, st.sequence, st."stationId",
		       a.name, COALESCE(a."locationHint", ''), a.lat::float8, a.lng::float8
		FROM parcel_route_stop st
		JOIN parcel_route r ON r.id = st."routeId"
		JOIN parcel_agent a ON a.id = st."stationId"
		WHERE r."parcelOrgId" = $1
		ORDER BY st."routeId", st.sequence`, orgID)
	if err != nil {
		return nil, err
	}
	defer stopRows.Close()
	for stopRows.Next() {
		var routeID string
		var s RouteStop
		if err := stopRows.Scan(&routeID, &s.ID, &s.Sequence, &s.StationID,
			&s.StationName, &s.LocationHint, &s.Lat, &s.Lng); err != nil {
			return nil, err
		}
		if i, ok := byID[routeID]; ok {
			routes[i].Stops = append(routes[i].Stops, s)
		}
	}
	return routes, stopRows.Err()
}

// SaveRoute creates or replaces a route and its stops in one
// transaction, so the board never reads a route that is halfway through
// being reordered.
//
// Stops are deleted and rewritten rather than diffed. They carry no
// state of their own — a stop is a position and a station, nothing
// else — so a rewrite loses nothing, and diffing would be more code
// defending against a reorder that a rewrite handles for free.
func SaveRoute(ctx context.Context, pool *pgxpool.Pool, orgID, routeID string, in RouteInput) (string, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return "", &ParcelError{"BAD_INPUT", "Give the route a name"}
	}
	// Two stops is the minimum that means anything: one place is not a
	// journey, and the leg vocabulary needs a pair to describe.
	if len(in.StationIDs) < 2 {
		return "", &ParcelError{"BAD_INPUT", "A route needs at least two stops"}
	}
	var code *string
	if in.Code != nil {
		if c := strings.ToUpper(strings.TrimSpace(*in.Code)); c != "" {
			code = &c
		}
	}

	// Every station proved to be this company's before anything is
	// written — ids arrive from a browser and are not trusted alone.
	// Checked in one round trip rather than per stop.
	var owned int
	if err := pool.QueryRow(ctx, `
		SELECT count(DISTINCT id) FROM parcel_agent
		WHERE id = ANY($1::uuid[]) AND "parcelOrgId" = $2`,
		in.StationIDs, orgID).Scan(&owned); err != nil {
		return "", err
	}
	if owned != countDistinct(in.StationIDs) {
		return "", &ParcelError{"NOT_FOUND", "One of those stops isn't one of your stations"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	id := routeID
	if strings.TrimSpace(id) == "" {
		err = tx.QueryRow(ctx, `
			INSERT INTO parcel_route ("parcelOrgId", name, code, active)
			VALUES ($1, $2, $3, $4) RETURNING id`,
			orgID, name, code, in.Active).Scan(&id)
		if err != nil {
			return "", routeWriteError(err)
		}
	} else {
		ct, err := tx.Exec(ctx, `
			UPDATE parcel_route SET name = $3, code = $4, active = $5
			WHERE id = $1 AND "parcelOrgId" = $2`, id, orgID, name, code, in.Active)
		if err != nil {
			return "", routeWriteError(err)
		}
		if ct.RowsAffected() == 0 {
			return "", &ParcelError{"NOT_FOUND", "That route isn't one of yours"}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM parcel_route_stop WHERE "routeId" = $1`, id); err != nil {
			return "", err
		}
	}

	for i, stationID := range in.StationIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO parcel_route_stop ("routeId", sequence, "stationId")
			VALUES ($1, $2, $3)`, id, i, stationID); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

// DeleteRoute removes a route a company no longer runs.
//
// Refused while runs are still out against it: a dispatcher watching a
// lorry should not have the route it is following vanish underneath
// them. Closed runs keep their routeId until the FK nulls it, and their
// originLabel/destinationLabel snapshot survives regardless — see the
// snapshot note in ADR-0006.
func DeleteRoute(ctx context.Context, pool *pgxpool.Pool, orgID, routeID string) error {
	var open int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM parcel_shipment
		WHERE "routeId" = $1 AND status IN ('LOADING', 'DEPARTED')`, routeID).Scan(&open); err != nil {
		return err
	}
	if open > 0 {
		return &ParcelError{"BAD_INPUT", "There are runs still out on this route — close them first"}
	}
	ct, err := pool.Exec(ctx, `
		DELETE FROM parcel_route WHERE id = $1 AND "parcelOrgId" = $2`, routeID, orgID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That route isn't one of yours"}
	}
	return nil
}

// routeWriteError turns the one constraint a user can actually trip —
// reusing a short code — into prose, and leaves everything else alone.
func routeWriteError(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), "parcel_route_org_code_key") {
		return &ParcelError{"BAD_INPUT", "You already have a route with that short code"}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That route isn't one of yours"}
	}
	return err
}

func countDistinct(ids []string) int {
	seen := map[string]bool{}
	for _, id := range ids {
		seen[id] = true
	}
	return len(seen)
}
