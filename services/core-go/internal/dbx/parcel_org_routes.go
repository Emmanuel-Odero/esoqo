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

// RouteStop is one stop on a route. Sequence is dense and 0-based.
// Exactly one of StationID or PlaceName is set: a stop at one of the
// company's own stations carries the richer station fields, a stop
// with no physical station there yet (a town a bus passes through
// with no shop) carries only a name.
type RouteStop struct {
	ID           string   `json:"id"`
	Sequence     int      `json:"sequence"`
	StationID    *string  `json:"stationId"`
	StationName  *string  `json:"stationName"`
	LocationHint *string  `json:"locationHint"`
	Lat          *float64 `json:"lat"`
	Lng          *float64 `json:"lng"`
	PlaceName    *string  `json:"placeName"`
}

// Name is what a route card or a from/to picker shows for this stop —
// the station's own name, or the free-text place if it has no station.
func (s RouteStop) Name() string {
	if s.StationName != nil {
		return *s.StationName
	}
	if s.PlaceName != nil {
		return *s.PlaceName
	}
	return ""
}

type Route struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Code   *string `json:"code"`
	Active bool    `json:"active"`
	// Optional, informational (bus fare context mostly) — never read
	// for parcel pricing.
	DistanceKm *int        `json:"distanceKm"`
	Stops      []RouteStop `json:"stops"`
	// How many runs currently cite this route and are not yet closed —
	// what makes deactivating one a decision rather than a click.
	OpenRuns int `json:"openRuns"`
}

// RouteStopInput is one stop as the client sends it: either an
// existing station id, or a free-text place with none.
type RouteStopInput struct {
	StationID *string
	PlaceName *string
}

type RouteInput struct {
	Name       string
	Code       *string
	DistanceKm *int
	// Stops in travel order. The sequence is positional: the caller's
	// array order IS the route, so reordering on the client is a
	// resend rather than a separate move-stop endpoint.
	Stops  []RouteStopInput
	Active bool
}

// ListRoutes — every route this company has, with stops in order.
//
// Two queries rather than a join with array_agg: the stop list is small
// and bounded, and assembling it in Go keeps the ordering explicit
// instead of depending on an aggregate's ordering clause being right.
func ListRoutes(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]Route, error) {
	rows, err := pool.Query(ctx, `
		SELECT r.id, r.name, r.code, r.active, r."distanceKm",
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
		if err := rows.Scan(&r.ID, &r.Name, &r.Code, &r.Active, &r.DistanceKm, &r.OpenRuns); err != nil {
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
		       a.name, a."locationHint", a.lat::float8, a.lng::float8, st."placeName"
		FROM parcel_route_stop st
		JOIN parcel_route r ON r.id = st."routeId"
		LEFT JOIN parcel_agent a ON a.id = st."stationId"
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
			&s.StationName, &s.LocationHint, &s.Lat, &s.Lng, &s.PlaceName); err != nil {
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
	if len(in.Stops) < 2 {
		return "", &ParcelError{"BAD_INPUT", "A route needs at least two stops"}
	}
	var code *string
	if in.Code != nil {
		if c := strings.ToUpper(strings.TrimSpace(*in.Code)); c != "" {
			code = &c
		}
	}

	stationIDs := make([]string, 0, len(in.Stops))
	for _, st := range in.Stops {
		hasStation := st.StationID != nil && strings.TrimSpace(*st.StationID) != ""
		hasPlace := st.PlaceName != nil && strings.TrimSpace(*st.PlaceName) != ""
		if hasStation == hasPlace {
			return "", &ParcelError{"BAD_INPUT", "Every stop needs either a station or a place name, not both or neither"}
		}
		if hasStation {
			stationIDs = append(stationIDs, strings.TrimSpace(*st.StationID))
		}
	}

	// Every station proved to be this company's before anything is
	// written — ids arrive from a browser and are not trusted alone.
	// Checked in one round trip rather than per stop. Stops with no
	// station (a free-text place) have nothing to verify here.
	if len(stationIDs) > 0 {
		var owned int
		if err := pool.QueryRow(ctx, `
			SELECT count(DISTINCT id) FROM parcel_agent
			WHERE id = ANY($1::uuid[]) AND "parcelOrgId" = $2`,
			stationIDs, orgID).Scan(&owned); err != nil {
			return "", err
		}
		if owned != countDistinct(stationIDs) {
			return "", &ParcelError{"NOT_FOUND", "One of those stops isn't one of your stations"}
		}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	id := routeID
	if strings.TrimSpace(id) == "" {
		err = tx.QueryRow(ctx, `
			INSERT INTO parcel_route ("parcelOrgId", name, code, active, "distanceKm")
			VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			orgID, name, code, in.Active, in.DistanceKm).Scan(&id)
		if err != nil {
			return "", routeWriteError(err)
		}
	} else {
		ct, err := tx.Exec(ctx, `
			UPDATE parcel_route SET name = $3, code = $4, active = $5, "distanceKm" = $6
			WHERE id = $1 AND "parcelOrgId" = $2`, id, orgID, name, code, in.Active, in.DistanceKm)
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

	for i, st := range in.Stops {
		var stationID, placeName *string
		if st.StationID != nil && strings.TrimSpace(*st.StationID) != "" {
			v := strings.TrimSpace(*st.StationID)
			stationID = &v
		} else {
			v := strings.TrimSpace(*st.PlaceName)
			placeName = &v
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO parcel_route_stop ("routeId", sequence, "stationId", "placeName")
			VALUES ($1, $2, $3, $4)`, id, i, stationID, placeName); err != nil {
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
	// Scoped to the caller's org. Unscoped, a manager passing another
	// company's route id got "there are runs still out on this route"
	// back where their own route gives "that route isn't one of yours" —
	// a two-word oracle confirming that id exists and is running. With
	// the predicate a foreign id simply counts zero and falls through to
	// the NOT_FOUND the DELETE already returns.
	var open int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM parcel_shipment
		WHERE "routeId" = $1 AND "parcelOrgId" = $2 AND status IN ('LOADING', 'DEPARTED')`,
		routeID, orgID).Scan(&open); err != nil {
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

// RouteEndpoints is a route's display shape for a rider picking a
// journey rather than a dispatcher editing stops: its overall first
// and last stop (what a "from → to" card shows) plus the optional
// distance. Used by the bus side (see dbx.ListBusRoutesForOrg) —
// buses have no vocabulary of their own for this, they just read it
// off the shared ParcelRoute/ParcelRouteStop station list.
type RouteEndpoints struct {
	ID              string `json:"id"`
	OriginName      string `json:"originName"`
	DestinationName string `json:"destinationName"`
	DistanceKm      *int   `json:"distanceKm"`
	Active          bool   `json:"active"`
}

// ListRouteEndpoints — every route of one company, projected down to
// its first/last stop. firstLast is a window function rather than
// min/max(sequence) joined twice: one pass over parcel_route_stop,
// one row per route out.
func ListRouteEndpoints(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]RouteEndpoints, error) {
	rows, err := pool.Query(ctx, `
		WITH ends AS (
			SELECT st."routeId",
			       first_value(COALESCE(a.name, st."placeName")) OVER (PARTITION BY st."routeId" ORDER BY st.sequence ASC) AS origin,
			       first_value(COALESCE(a.name, st."placeName")) OVER (PARTITION BY st."routeId" ORDER BY st.sequence DESC) AS destination
			FROM parcel_route_stop st
			LEFT JOIN parcel_agent a ON a.id = st."stationId"
		)
		SELECT r.id, e.origin, e.destination, r."distanceKm", r.active
		FROM parcel_route r
		JOIN ends e ON e."routeId" = r.id
		WHERE r."parcelOrgId" = $1
		GROUP BY r.id, e.origin, e.destination, r."distanceKm", r.active
		ORDER BY r.active DESC, e.origin ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RouteEndpoints{}
	for rows.Next() {
		var r RouteEndpoints
		if err := rows.Scan(&r.ID, &r.OriginName, &r.DestinationName, &r.DistanceKm, &r.Active); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// FindRoutesBetweenStations — every active route of one company that
// visits both stations in that order (fromStationID's stop sequence
// strictly before toStationID's), for the "from / to" rider search: a
// bus from Nairobi to Homabay via Kisii is one route a Kisii→Homabay
// rider should find too, not only a Nairobi→Homabay one.
func FindRoutesBetweenStations(ctx context.Context, pool *pgxpool.Pool, orgID, fromStationID, toStationID string) ([]RouteEndpoints, error) {
	rows, err := pool.Query(ctx, `
		SELECT re.id, re.origin, re.destination, r."distanceKm", r.active
		FROM (
			SELECT st."routeId" AS id,
			       first_value(COALESCE(a.name, st."placeName")) OVER (PARTITION BY st."routeId" ORDER BY st.sequence ASC) AS origin,
			       first_value(COALESCE(a.name, st."placeName")) OVER (PARTITION BY st."routeId" ORDER BY st.sequence DESC) AS destination
			FROM parcel_route_stop st
			LEFT JOIN parcel_agent a ON a.id = st."stationId"
		) re
		JOIN parcel_route r ON r.id = re.id
		WHERE r."parcelOrgId" = $1 AND r.active
		  AND EXISTS (
		    SELECT 1 FROM parcel_route_stop f
		    JOIN parcel_route_stop t ON t."routeId" = f."routeId" AND t.sequence > f.sequence
		    WHERE f."routeId" = re.id AND f."stationId" = $2 AND t."stationId" = $3
		  )
		GROUP BY re.id, re.origin, re.destination, r."distanceKm", r.active
		ORDER BY re.origin ASC`, orgID, fromStationID, toStationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RouteEndpoints{}
	for rows.Next() {
		var r RouteEndpoints
		if err := rows.Scan(&r.ID, &r.OriginName, &r.DestinationName, &r.DistanceKm, &r.Active); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
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
