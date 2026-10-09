// Package dbx (bus_transport.go) — a courier company that also runs
// passenger buses (ParcelOrg.offersTransport).
//
// Deliberately its own small vocabulary (Bus/BusSchedule/BusTrip/
// BusBooking — routes are the company's own ParcelRoutes, see below)
// rather than riding the TicketOrg/Listing/Seat
// machinery the ticketing vertical already has: this is a second
// product line on the same ParcelOrg tenant, not a second merchant
// identity.
//
// BusSchedule is the recurring template a manager configures once
// ("this bus, this route, departs 06:00 every day, KES 1,200"). Actual
// bookable rows are BusTrip — one per concrete departure — generated
// from the template on demand (see EnsureBusTripsGenerated) rather
// than by a cron, so there is no background job to keep alive for a
// feature that is read far more rarely than it is booked.
//
// Seats are not pre-created rows (unlike the ticketing vertical's
// Seat table): a trip just has seatsTotal, and a seat is "taken" if a
// live BusBooking already claims that seatNumber on that trip. The
// double-booking guard is therefore a row lock inside the booking
// transaction (see CreateBusBooking), not a unique DB constraint —
// a constraint would also have to exempt cancelled bookings, which
// Postgres can only do with a partial index, and the extra migration
// machinery isn't worth it for what a `FOR UPDATE` already guarantees.
package dbx

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/fleetqr"
	"github.com/esoqo/core-go/internal/ledger"
)

// ─────────────────────────────── Bus ─────────────────────────────

type Bus struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	PlateNumber string   `json:"plateNumber"`
	TotalSeats  int      `json:"totalSeats"`
	SeatLayout  *string  `json:"seatLayout"`
	Amenities   []string `json:"amenities"`
	Status      string   `json:"status"`
}

type BusInput struct {
	Name        string
	PlateNumber string
	TotalSeats  int
	SeatLayout  *string
	Amenities   []string
	Status      string // ACTIVE | INACTIVE, defaults to ACTIVE
}

func (in BusInput) validate() error {
	if strings.TrimSpace(in.Name) == "" {
		return &ParcelError{"BAD_INPUT", "Give the bus a name"}
	}
	if strings.TrimSpace(in.PlateNumber) == "" {
		return &ParcelError{"BAD_INPUT", "Give the bus its number plate"}
	}
	if in.TotalSeats < 1 || in.TotalSeats > 120 {
		return &ParcelError{"BAD_INPUT", "Seat count must be between 1 and 120"}
	}
	return nil
}

// ListBuses — a company's own fleet, active first.
func ListBuses(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]Bus, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, name, "plateNumber", "totalSeats", "seatLayout", amenities, status::text
		FROM bus WHERE "parcelOrgId" = $1
		ORDER BY status ASC, name ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	buses := []Bus{}
	for rows.Next() {
		var b Bus
		if err := rows.Scan(&b.ID, &b.Name, &b.PlateNumber, &b.TotalSeats, &b.SeatLayout, &b.Amenities, &b.Status); err != nil {
			return nil, err
		}
		buses = append(buses, b)
	}
	return buses, rows.Err()
}

// SaveBus creates or updates one of a company's buses. Plate numbers
// are unique per company (bus_org_plate_key) — reusing one is almost
// certainly a typo of an existing bus, surfaced as prose rather than a
// raw constraint error.
func SaveBus(ctx context.Context, pool *pgxpool.Pool, orgID, busID string, in BusInput) (string, error) {
	if err := in.validate(); err != nil {
		return "", err
	}
	status := in.Status
	if status == "" {
		status = "ACTIVE"
	}
	amenities := in.Amenities
	if amenities == nil {
		amenities = []string{}
	}
	var id string
	var err error
	if strings.TrimSpace(busID) == "" {
		err = pool.QueryRow(ctx, `
			INSERT INTO bus ("parcelOrgId", name, "plateNumber", "totalSeats", "seatLayout", amenities, status, "updatedAt")
			VALUES ($1, $2, $3, $4, $5, $6, $7::"BusStatus", now())
			RETURNING id`,
			orgID, strings.TrimSpace(in.Name), strings.ToUpper(strings.TrimSpace(in.PlateNumber)),
			in.TotalSeats, in.SeatLayout, amenities, status).Scan(&id)
	} else {
		ct, execErr := pool.Exec(ctx, `
			UPDATE bus SET name = $1, "plateNumber" = $2, "totalSeats" = $3, "seatLayout" = $4,
			               amenities = $5, status = $6::"BusStatus", "updatedAt" = now()
			WHERE id = $7 AND "parcelOrgId" = $8`,
			strings.TrimSpace(in.Name), strings.ToUpper(strings.TrimSpace(in.PlateNumber)),
			in.TotalSeats, in.SeatLayout, amenities, status, busID, orgID)
		err = execErr
		id = busID
		if err == nil && ct.RowsAffected() == 0 {
			return "", &ParcelError{"NOT_FOUND", "That bus isn't one of yours"}
		}
	}
	if isUniqueViolation(err) {
		return "", &ParcelError{"BAD_INPUT", "You already have a bus with that plate number"}
	}
	return id, err
}

// DeleteBus refuses while any trip (past or future) still cites this
// bus — a manager retiring a vehicle should mark it INACTIVE via
// SaveBus instead, which keeps history intact.
func DeleteBus(ctx context.Context, pool *pgxpool.Pool, orgID, busID string) error {
	var trips int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM bus_trip WHERE "busId" = $1`, busID).Scan(&trips); err != nil {
		return err
	}
	if trips > 0 {
		return &ParcelError{"BAD_INPUT", "This bus has trips on record — mark it inactive instead of deleting it"}
	}
	tag, err := pool.Exec(ctx, `DELETE FROM bus WHERE id = $1 AND "parcelOrgId" = $2`, busID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That bus isn't one of yours"}
	}
	return nil
}

// ─────────────────────────────── Route ───────────────────────────
//
// Buses have no route vocabulary of their own — a schedule or trip's
// routeId points straight at a ParcelRoute, the same ordered station
// list the company's parcel runs already use (see ParcelRouteStop's
// own comment on how a stop with no physical station still works).
// ListBusRoutesForOrg/FindBusRoutesBetweenStations are thin,
// bus-flavoured views over dbx.ListRouteEndpoints/FindRoutesBetweenStations.

// ListBusRoutesForOrg — a company's own routes, projected to the
// origin/destination shape the transport console's pickers want.
func ListBusRoutesForOrg(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]RouteEndpoints, error) {
	return ListRouteEndpoints(ctx, pool, orgID)
}

// FindBusRoutesBetweenStations — this company's routes that connect a
// rider's chosen boarding and alighting stations, in that order. A
// route from Nairobi to Homabay via Kisii matches a Kisii→Homabay
// search too, since the whole trip is still bookable end to end.
func FindBusRoutesBetweenStations(ctx context.Context, pool *pgxpool.Pool, orgID, fromStationID, toStationID string) ([]RouteEndpoints, error) {
	return FindRoutesBetweenStations(ctx, pool, orgID, fromStationID, toStationID)
}

// routeOriginDestJoin joins a route's overall first/last stop onto a
// query that already has a "parcel_route r" row available, as
// origin.name/destination.name — LATERAL rather than the window
// functions dbx.ListRouteEndpoints uses, since every caller here
// already filters down to one route via routeFK and only wants that
// one row's endpoints, not a pass over every stop of every route.
func routeOriginDestJoin(routeFK string) string {
	return fmt.Sprintf(`
		JOIN parcel_route r ON r.id = %s
		LEFT JOIN LATERAL (
			SELECT COALESCE(a.name, st."placeName") AS name
			FROM parcel_route_stop st LEFT JOIN parcel_agent a ON a.id = st."stationId"
			WHERE st."routeId" = r.id ORDER BY st.sequence ASC LIMIT 1
		) origin ON true
		LEFT JOIN LATERAL (
			SELECT COALESCE(a.name, st."placeName") AS name
			FROM parcel_route_stop st LEFT JOIN parcel_agent a ON a.id = st."stationId"
			WHERE st."routeId" = r.id ORDER BY st.sequence DESC LIMIT 1
		) destination ON true`, routeFK)
}

// ─────────────────────────────── Schedule ────────────────────────

type BusSchedule struct {
	ID         string  `json:"id"`
	BusID      string  `json:"busId"`
	BusName    string  `json:"busName"`
	RouteID    string  `json:"routeId"`
	OriginName string  `json:"originName"`
	DestName   string  `json:"destinationName"`
	DepartTime string  `json:"departTime"`
	DaysOfWeek []int32 `json:"daysOfWeek"`
	PriceKes   float64 `json:"priceKes"`
	Active     bool    `json:"active"`
}

type BusScheduleInput struct {
	BusID      string
	RouteID    string
	DepartTime string // "HH:MM"
	DaysOfWeek []int32
	PriceKes   float64
	Active     bool
}

var departTimePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func (in BusScheduleInput) validate() error {
	if strings.TrimSpace(in.BusID) == "" || strings.TrimSpace(in.RouteID) == "" {
		return &ParcelError{"BAD_INPUT", "Choose a bus and a route"}
	}
	if !departTimePattern.MatchString(in.DepartTime) {
		return &ParcelError{"BAD_INPUT", "Give the departure time as HH:MM"}
	}
	if in.PriceKes <= 0 {
		return &ParcelError{"BAD_INPUT", "Set a fare for this schedule"}
	}
	for _, d := range in.DaysOfWeek {
		if d < 0 || d > 6 {
			return &ParcelError{"BAD_INPUT", "Days of the week must be 0 (Sunday) to 6 (Saturday)"}
		}
	}
	return nil
}

func ListBusSchedules(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]BusSchedule, error) {
	rows, err := pool.Query(ctx, `
		SELECT s.id, s."busId", b.name, s."routeId", origin.name, destination.name,
		       s."departTime", s."daysOfWeek", s."priceKes"::text, s.active
		FROM bus_schedule s
		JOIN bus b ON b.id = s."busId"
		`+routeOriginDestJoin(`s."routeId"`)+`
		WHERE s."parcelOrgId" = $1
		ORDER BY s.active DESC, s."departTime" ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BusSchedule{}
	for rows.Next() {
		var s BusSchedule
		var priceText string
		if err := rows.Scan(&s.ID, &s.BusID, &s.BusName, &s.RouteID, &s.OriginName, &s.DestName,
			&s.DepartTime, &s.DaysOfWeek, &priceText, &s.Active); err != nil {
			return nil, err
		}
		if s.PriceKes, err = parseFloatOrZero(priceText); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// SaveBusSchedule creates or updates a schedule. Bus and route
// ownership are proved inside the query itself, so a foreign id from
// another company's console is indistinguishable from one that
// doesn't exist.
func SaveBusSchedule(ctx context.Context, pool *pgxpool.Pool, orgID, scheduleID string, in BusScheduleInput) (string, error) {
	if err := in.validate(); err != nil {
		return "", err
	}
	var owned int
	if err := pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM bus WHERE id = $1 AND "parcelOrgId" = $2) +
		       (SELECT count(*) FROM parcel_route WHERE id = $3 AND "parcelOrgId" = $2)`,
		in.BusID, orgID, in.RouteID).Scan(&owned); err != nil {
		return "", err
	}
	if owned != 2 {
		return "", &ParcelError{"NOT_FOUND", "Choose a bus and route that belong to your company"}
	}
	days := in.DaysOfWeek
	if days == nil {
		days = []int32{0, 1, 2, 3, 4, 5, 6}
	}
	var id string
	var err error
	if strings.TrimSpace(scheduleID) == "" {
		err = pool.QueryRow(ctx, `
			INSERT INTO bus_schedule ("parcelOrgId", "busId", "routeId", "departTime", "daysOfWeek", "priceKes", active, "updatedAt")
			VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
			orgID, in.BusID, in.RouteID, in.DepartTime, days, in.PriceKes, in.Active).Scan(&id)
	} else {
		ct, execErr := pool.Exec(ctx, `
			UPDATE bus_schedule SET "busId" = $1, "routeId" = $2, "departTime" = $3, "daysOfWeek" = $4,
			       "priceKes" = $5, active = $6, "updatedAt" = now()
			WHERE id = $7 AND "parcelOrgId" = $8`,
			in.BusID, in.RouteID, in.DepartTime, days, in.PriceKes, in.Active, scheduleID, orgID)
		err = execErr
		id = scheduleID
		if err == nil && ct.RowsAffected() == 0 {
			return "", &ParcelError{"NOT_FOUND", "That schedule isn't one of yours"}
		}
	}
	return id, err
}

func DeleteBusSchedule(ctx context.Context, pool *pgxpool.Pool, orgID, scheduleID string) error {
	tag, err := pool.Exec(ctx, `DELETE FROM bus_schedule WHERE id = $1 AND "parcelOrgId" = $2`, scheduleID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That schedule isn't one of yours"}
	}
	return nil
}

// ─────────────────────────────── Trip ─────────────────────────────

type BusTrip struct {
	ID              string  `json:"id"`
	BusID           string  `json:"busId"`
	BusName         string  `json:"busName"`
	PlateNumber     string  `json:"plateNumber"`
	SeatLayout      *string `json:"seatLayout"`
	RouteID         string  `json:"routeId"`
	OriginName      string  `json:"originName"`
	DestinationName string  `json:"destinationName"`
	DepartAt        string  `json:"departAt"` // RFC3339
	PriceKes        float64 `json:"priceKes"`
	SeatsTotal      int     `json:"seatsTotal"`
	SeatsAvailable  int     `json:"seatsAvailable"`
	Status          string  `json:"status"`
}

const busTripColumns = `
	t.id, t."busId", b.name, b."plateNumber", b."seatLayout", t."routeId", origin.name, destination.name,
	t."departAt", t."priceKes"::text, t."seatsTotal", t.status::text,
	t."seatsTotal" - COALESCE((
		SELECT count(*) FROM bus_booking bb
		WHERE bb."tripId" = t.id AND bb.status IN ('PENDING_PAYMENT', 'PAID')
	), 0)`

func scanBusTrip(row pgx.Row) (*BusTrip, error) {
	var t BusTrip
	var priceText string
	var departAt time.Time
	if err := row.Scan(&t.ID, &t.BusID, &t.BusName, &t.PlateNumber, &t.SeatLayout, &t.RouteID, &t.OriginName, &t.DestinationName,
		&departAt, &priceText, &t.SeatsTotal, &t.Status, &t.SeatsAvailable); err != nil {
		return nil, err
	}
	var err error
	if t.PriceKes, err = parseFloatOrZero(priceText); err != nil {
		return nil, err
	}
	t.DepartAt = departAt.UTC().Format(time.RFC3339)
	return &t, nil
}

// EnsureBusTripsGenerated materialises concrete BusTrip rows for every
// active BusSchedule of this org, for each of the next `days` days
// (including today) that the schedule's daysOfWeek says it runs.
// ON CONFLICT DO NOTHING against bus_trip_bus_depart_key makes this
// idempotent and cheap to call on every search — no cron, no job
// queue, just "make sure the near future exists" before reading it.
func EnsureBusTripsGenerated(ctx context.Context, pool *pgxpool.Pool, orgID string, days int) error {
	if days < 1 {
		days = 1
	}
	if days > 60 {
		days = 60
	}
	type tmpl struct {
		id, busID, routeID, departTime string
		daysOfWeek                     []int32
		priceKes                       float64
		seatsTotal                     int
	}
	rows, err := pool.Query(ctx, `
		SELECT s.id, s."busId", s."routeId", s."departTime", s."daysOfWeek", s."priceKes"::text, b."totalSeats"
		FROM bus_schedule s
		JOIN bus b ON b.id = s."busId"
		WHERE s."parcelOrgId" = $1 AND s.active AND b.status = 'ACTIVE'`, orgID)
	if err != nil {
		return err
	}
	var templates []tmpl
	for rows.Next() {
		var t tmpl
		var priceText string
		if err := rows.Scan(&t.id, &t.busID, &t.routeID, &t.departTime, &t.daysOfWeek, &priceText, &t.seatsTotal); err != nil {
			rows.Close()
			return err
		}
		t.priceKes, err = parseFloatOrZero(priceText)
		if err != nil {
			rows.Close()
			return err
		}
		templates = append(templates, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(templates) == 0 {
		return nil
	}

	loc, err := time.LoadLocation("Africa/Nairobi")
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	for _, t := range templates {
		hh, mm := 0, 0
		fmt.Sscanf(t.departTime, "%02d:%02d", &hh, &mm)
		runsOn := map[int32]bool{}
		for _, d := range t.daysOfWeek {
			runsOn[d] = true
		}
		for i := 0; i < days; i++ {
			day := now.AddDate(0, 0, i)
			if !runsOn[int32(day.Weekday())] {
				continue
			}
			departAt := time.Date(day.Year(), day.Month(), day.Day(), hh, mm, 0, 0, loc)
			if departAt.Before(now) {
				continue
			}
			if _, err := pool.Exec(ctx, `
				INSERT INTO bus_trip ("parcelOrgId", "scheduleId", "busId", "routeId", "departAt", "priceKes", "seatsTotal", status)
				VALUES ($1, $2, $3, $4, $5, $6, $7, 'SCHEDULED')
				ON CONFLICT ("busId", "departAt") DO NOTHING`,
				orgID, t.id, t.busID, t.routeID, departAt, t.priceKes, t.seatsTotal); err != nil {
				return err
			}
		}
	}
	return nil
}

// ListBusTripsForOrg — a company's own upcoming trips (today onward),
// for the console's trip calendar and the counter's "book a seat"
// search.
func ListBusTripsForOrg(ctx context.Context, pool *pgxpool.Pool, orgID, routeID string) ([]BusTrip, error) {
	q := `SELECT ` + busTripColumns + `
		FROM bus_trip t JOIN bus b ON b.id = t."busId" ` + routeOriginDestJoin(`t."routeId"`) + `
		WHERE t."parcelOrgId" = $1 AND t."departAt" >= now() - interval '1 hour' AND t.status = 'SCHEDULED'`
	args := []interface{}{orgID}
	if strings.TrimSpace(routeID) != "" {
		q += ` AND t."routeId" = $2`
		args = append(args, routeID)
	}
	q += ` ORDER BY t."departAt" ASC LIMIT 200`
	rows, err := pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BusTrip{}
	for rows.Next() {
		t, err := scanBusTrip(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// CreateOneOffBusTrip — an extra departure a manager adds by hand,
// outside any recurring schedule (a relief bus, a one-time charter).
type OneOffBusTripInput struct {
	BusID    string
	RouteID  string
	DepartAt time.Time
	PriceKes float64
}

func CreateOneOffBusTrip(ctx context.Context, pool *pgxpool.Pool, orgID string, in OneOffBusTripInput) (string, error) {
	if in.PriceKes <= 0 {
		return "", &ParcelError{"BAD_INPUT", "Set a fare for this trip"}
	}
	if in.DepartAt.Before(time.Now()) {
		return "", &ParcelError{"BAD_INPUT", "Pick a departure time in the future"}
	}
	var seatsTotal int
	if err := pool.QueryRow(ctx, `
		SELECT "totalSeats" FROM bus WHERE id = $1 AND "parcelOrgId" = $2`, in.BusID, orgID).Scan(&seatsTotal); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", &ParcelError{"NOT_FOUND", "Choose a bus that belongs to your company"}
		}
		return "", err
	}
	var routeOwned int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM parcel_route WHERE id = $1 AND "parcelOrgId" = $2`, in.RouteID, orgID).Scan(&routeOwned); err != nil {
		return "", err
	}
	if routeOwned == 0 {
		return "", &ParcelError{"NOT_FOUND", "Choose a route that belongs to your company"}
	}
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO bus_trip ("parcelOrgId", "busId", "routeId", "departAt", "priceKes", "seatsTotal", status)
		VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED') RETURNING id`,
		orgID, in.BusID, in.RouteID, in.DepartAt, in.PriceKes, seatsTotal).Scan(&id)
	if isUniqueViolation(err) {
		return "", &ParcelError{"BAD_INPUT", "That bus already has a trip at that exact time"}
	}
	return id, err
}

// CancelBusTrip stops a trip from being booked further and marks every
// still-live booking on it CANCELLED — same "cancelling the parent
// cancels the children" rule a withdrawn label batch follows.
func CancelBusTrip(ctx context.Context, pool *pgxpool.Pool, orgID, tripID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE bus_trip SET status = 'CANCELLED'
		WHERE id = $1 AND "parcelOrgId" = $2 AND status = 'SCHEDULED'`, tripID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That trip isn't one of yours, or is no longer scheduled"}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE bus_booking SET status = 'CANCELLED', "cancelledAt" = now()
		WHERE "tripId" = $1 AND status IN ('PENDING_PAYMENT', 'PAID')`, tripID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─────────────────────────── Public search ────────────────────────

// TransportCompany is one courier company offering passenger buses —
// the top of the public web booking funnel.
type TransportCompany struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Slug    string  `json:"slug"`
	LogoURL *string `json:"logoUrl"`
}

func ListTransportCompanies(ctx context.Context, pool *pgxpool.Pool) ([]TransportCompany, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, name, slug, "logoUrl" FROM parcel_org
		WHERE "offersTransport" AND status = 'ACTIVE'
		ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TransportCompany{}
	for rows.Next() {
		var c TransportCompany
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.LogoURL); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ListPublicBusRoutes — one transport company's own active routes, for
// the "from / to" picker on its booking page. orgID is a selector over
// an already-public company, same boundary as
// handleListPublicOrgStations.
func ListPublicBusRoutes(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]RouteEndpoints, error) {
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
		JOIN parcel_org o ON o.id = r."parcelOrgId"
		WHERE r."parcelOrgId" = $1 AND r.active AND o."offersTransport" AND o.status = 'ACTIVE'
		GROUP BY re.id, re.origin, re.destination, r."distanceKm", r.active
		ORDER BY re.origin ASC`, orgID)
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

// FindPublicBusRoutesBetweenStations — one transport company's active
// routes that visit both stations in that order, for the public
// "pick where you board and where you alight" search: a Nairobi →
// Homabay route via Kisii should surface for a Kisii → Homabay rider
// too, since the whole trip is still bought end to end.
func FindPublicBusRoutesBetweenStations(ctx context.Context, pool *pgxpool.Pool, orgID, fromStationID, toStationID string) ([]RouteEndpoints, error) {
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
		JOIN parcel_org o ON o.id = r."parcelOrgId"
		WHERE r."parcelOrgId" = $1 AND r.active AND o."offersTransport" AND o.status = 'ACTIVE'
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

// ListPublicBusTrips — upcoming, bookable trips for one route of one
// transport company. Call EnsureBusTripsGenerated first so a route
// nobody has searched yet still has near-future trips to show.
func ListPublicBusTrips(ctx context.Context, pool *pgxpool.Pool, orgID, routeID string) ([]BusTrip, error) {
	rows, err := pool.Query(ctx, `
		SELECT `+busTripColumns+`
		FROM bus_trip t
		JOIN bus b ON b.id = t."busId"
		`+routeOriginDestJoin(`t."routeId"`)+`
		JOIN parcel_org o ON o.id = t."parcelOrgId"
		WHERE t."parcelOrgId" = $1 AND t."routeId" = $2 AND t.status = 'SCHEDULED'
		  AND t."departAt" >= now() AND o."offersTransport" AND o.status = 'ACTIVE'
		ORDER BY t."departAt" ASC LIMIT 100`, orgID, routeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BusTrip{}
	for rows.Next() {
		t, err := scanBusTrip(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// GetPublicBusTrip — one trip's own detail, public (the trip id is the
// secret — same "booking id is the secret" convention GetBooking uses).
func GetPublicBusTrip(ctx context.Context, pool *pgxpool.Pool, tripID string) (*BusTrip, error) {
	t, err := scanBusTrip(pool.QueryRow(ctx, `
		SELECT `+busTripColumns+`
		FROM bus_trip t JOIN bus b ON b.id = t."busId" `+routeOriginDestJoin(`t."routeId"`)+`
		WHERE t.id = $1`, tripID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

// BusTripSeats — total capacity plus which seat numbers are already
// taken, for the seat picker.
func BusTripSeats(ctx context.Context, pool *pgxpool.Pool, tripID string) (seatsTotal int, taken []int, err error) {
	if err = pool.QueryRow(ctx, `SELECT "seatsTotal" FROM bus_trip WHERE id = $1`, tripID).Scan(&seatsTotal); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, &ParcelError{"NOT_FOUND", "That trip was not found"}
		}
		return 0, nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT "seatNumber" FROM bus_booking
		WHERE "tripId" = $1 AND status IN ('PENDING_PAYMENT', 'PAID')`, tripID)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	taken = []int{}
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			return 0, nil, err
		}
		taken = append(taken, n)
	}
	return seatsTotal, taken, rows.Err()
}

// ─────────────────────────────── Booking ──────────────────────────

type BusBooking struct {
	ID              string  `json:"id"`
	TripID          string  `json:"tripId"`
	SeatNumber      int     `json:"seatNumber"`
	PassengerName   string  `json:"passengerName"`
	PassengerMsisdn string  `json:"passengerMsisdn"`
	Code            string  `json:"code"`
	Status          string  `json:"status"`
	PaymentMethod   string  `json:"paymentMethod"`
	Channel         string  `json:"channel"`
	PriceKes        float64 `json:"priceKes"`
	OriginName      string  `json:"originName"`
	DestinationName string  `json:"destinationName"`
	DepartAt        string  `json:"departAt"`
	BusName         string  `json:"busName"`
}

type CreateBusBookingInput struct {
	TripID string
	// One row per seat is created, all sharing one booking code — a
	// passenger booking for their family picks several seats in one
	// checkout, one M-Pesa prompt, one total.
	SeatNumbers       []int
	PassengerName     string
	PassengerMsisdn   string
	PassengerIDNumber *string
	PaymentMethod     string // MPESA_STK | CASH
	Channel           string // WEB | COUNTER
	CreatedByStaffID  *string
}

type BusBookingError struct {
	Code    string // TRIP_NOT_FOUND | SEAT_TAKEN | BAD_INPUT
	Message string
}

func (e *BusBookingError) Error() string { return e.Message }

func generateBusBookingCode() string {
	return "BUS-" + fleetqr.RandomSegment(8)
}

// CreateBusBooking claims one or more seats on a trip, transactionally,
// all under one booking code. The row-lock on bus_trip (FOR UPDATE)
// plus a live-booking recount for the same seats inside that lock is
// the whole double-booking guard — two requests touching seat 12 on
// the same trip serialise on the trip lock, and the loser sees
// SEAT_TAKEN instead of a second row.
//
// CASH bookings (counter, walk-in) are PAID on commit with the ledger
// entry posted inline per seat, same shape ticketing's CreateBooking
// follows for its own CASH path. MPESA_STK bookings are created
// PENDING_PAYMENT; the caller pushes one STK prompt for the combined
// total afterwards and attaches the checkout id to the whole group
// (see AttachBusBookingCheckoutRequestID).
func CreateBusBooking(ctx context.Context, pool *pgxpool.Pool, in CreateBusBookingInput) (bookingIDs []string, code, totalKES string, err error) {
	if strings.TrimSpace(in.PassengerName) == "" {
		return nil, "", "", &BusBookingError{"BAD_INPUT", "Give the passenger's name"}
	}
	seatNumbers := dedupeSeatNumbers(in.SeatNumbers)
	if len(seatNumbers) == 0 {
		return nil, "", "", &BusBookingError{"BAD_INPUT", "Choose at least one seat"}
	}
	for _, n := range seatNumbers {
		if n < 1 {
			return nil, "", "", &BusBookingError{"BAD_INPUT", "Choose a seat"}
		}
	}
	method := in.PaymentMethod
	if method == "" {
		method = "MPESA_STK"
	}
	channel := in.Channel
	if channel == "" {
		channel = "WEB"
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, "", "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var seatsTotal int
	var priceKesText, status string
	err = tx.QueryRow(ctx, `
		SELECT "seatsTotal", "priceKes"::text, status::text FROM bus_trip
		WHERE id = $1 FOR UPDATE`, in.TripID).Scan(&seatsTotal, &priceKesText, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", "", &BusBookingError{"TRIP_NOT_FOUND", "That trip is no longer available"}
	}
	if err != nil {
		return nil, "", "", err
	}
	if status != "SCHEDULED" {
		return nil, "", "", &BusBookingError{"TRIP_NOT_FOUND", "That trip is no longer taking bookings"}
	}
	for _, n := range seatNumbers {
		if n > seatsTotal {
			return nil, "", "", &BusBookingError{"BAD_INPUT", "That seat number doesn't exist on this bus"}
		}
	}
	priceKES, err := strconv.ParseFloat(priceKesText, 64)
	if err != nil {
		return nil, "", "", err
	}

	var taken int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM bus_booking
		WHERE "tripId" = $1 AND "seatNumber" = ANY($2) AND status IN ('PENDING_PAYMENT', 'PAID')`,
		in.TripID, seatNumbers).Scan(&taken); err != nil {
		return nil, "", "", err
	}
	if taken > 0 {
		return nil, "", "", &BusBookingError{"SEAT_TAKEN", "One of those seats has just been taken — pick another"}
	}

	code = generateBusBookingCode()
	status = "PENDING_PAYMENT"
	var paidAt *time.Time
	if method == "CASH" {
		status = "PAID"
		now := time.Now()
		paidAt = &now
	}
	for _, n := range seatNumbers {
		var bookingID string
		err = tx.QueryRow(ctx, `
			INSERT INTO bus_booking (
				"tripId", "seatNumber", "passengerName", "passengerMsisdn", "passengerIdNumber",
				code, status, "paymentMethod", channel, "priceKes", "createdByStaffId", "paidAt"
			) VALUES ($1, $2, $3, $4, $5, $6, $7::"BusBookingStatus", $8::"BusBookingPaymentMethod", $9::"BusBookingChannel", $10, $11, $12)
			RETURNING id`,
			in.TripID, n, strings.TrimSpace(in.PassengerName), in.PassengerMsisdn, in.PassengerIDNumber,
			code, status, method, channel, priceKES, in.CreatedByStaffID, paidAt).Scan(&bookingID)
		if err != nil {
			return nil, "", "", err
		}
		bookingIDs = append(bookingIDs, bookingID)

		if method == "CASH" {
			if err := postBusBookingRevenueTx(ctx, tx, pool, in.TripID, bookingID, priceKES); err != nil {
				return nil, "", "", err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, "", "", err
	}
	total := priceKES * float64(len(seatNumbers))
	return bookingIDs, code, strconv.FormatFloat(total, 'f', 2, 64), nil
}

// dedupeSeatNumbers drops repeats while keeping the caller's order —
// booking the same seat number twice in one request is always a
// mistake, not a request for two tickets on it.
func dedupeSeatNumbers(seats []int) []int {
	seen := make(map[int]bool, len(seats))
	out := make([]int, 0, len(seats))
	for _, n := range seats {
		if seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}

// AttachBusBookingCheckoutRequestID stamps the one STK push's checkout
// id onto every seat row sharing this booking code, so the webhook can
// confirm the whole group when it lands (see
// ConfirmBusBookingByCheckoutID).
func AttachBusBookingCheckoutRequestID(ctx context.Context, pool *pgxpool.Pool, code, checkoutRequestID string) error {
	_, err := pool.Exec(ctx, `UPDATE bus_booking SET "mpesaCheckoutRequestId" = $1 WHERE code = $2`, checkoutRequestID, code)
	return err
}

// ErrBusBookingNotFound — "fall through to the next domain" contract
// for the shared STK webhook dispatcher.
var ErrBusBookingNotFound = errors.New("no bus booking for that checkout request")

// ConfirmBusBookingByCheckoutID is the M-Pesa webhook's confirm for a
// web/STK bus booking: idempotent on checkoutRequestId, posts the
// revenue the same way the inline CASH path does, for every seat that
// one checkout paid for. Returns every booking id under that checkout
// (even on a replayed callback) so the caller can trigger the
// automatic payout dispatch exactly once per genuine confirmation.
func ConfirmBusBookingByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID string) (bookingIDs []string, justConfirmed bool, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT id, "tripId", status::text, "priceKes"::text FROM bus_booking
		WHERE "mpesaCheckoutRequestId" = $1 FOR UPDATE`, checkoutRequestID)
	if err != nil {
		return nil, false, err
	}
	type pendingSeat struct {
		id, tripID, priceKesText string
	}
	var all []pendingSeat
	for rows.Next() {
		var p pendingSeat
		var status string
		if err := rows.Scan(&p.id, &p.tripID, &status, &p.priceKesText); err != nil {
			rows.Close()
			return nil, false, err
		}
		if status == "PENDING_PAYMENT" {
			all = append(all, p)
		}
		bookingIDs = append(bookingIDs, p.id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	if len(bookingIDs) == 0 {
		return nil, false, ErrBusBookingNotFound
	}
	if len(all) == 0 {
		return bookingIDs, false, nil // already confirmed — replayed callback
	}

	for _, p := range all {
		priceKES, err := strconv.ParseFloat(p.priceKesText, 64)
		if err != nil {
			return nil, false, err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE bus_booking SET status = 'PAID', "paidAt" = now() WHERE id = $1`, p.id); err != nil {
			return nil, false, err
		}
		if err := postBusBookingRevenueTx(ctx, tx, pool, p.tripID, p.id, priceKES); err != nil {
			return nil, false, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return bookingIDs, true, nil
}

// postBusBookingRevenueTx posts a paid bus seat straight into the same
// PARCEL_ORG_EARNINGS_PAYABLE liability account parcel revenue
// reclassifies into (see dbx.reclassifyParcelOrgEarnings) — one account
// per courier company's enterprise party — and creates the
// ParcelOrgPayout row that actually clears it automatically over
// Daraja/Co-op, exactly the way a settled parcel's earnings already do
// (see createBusBookingOrgPayoutTx). The httpapi layer dispatches the
// row this creates right after the caller's transaction commits (see
// dispatchParcelOrgPayoutForBusBooking) — dbx itself never calls out to
// a payment provider.
func postBusBookingRevenueTx(ctx context.Context, tx pgx.Tx, pool *pgxpool.Pool, tripID, bookingID string, priceKES float64) error {
	if priceKES <= 0 {
		return nil
	}
	var orgID string
	if err := tx.QueryRow(ctx, `SELECT "parcelOrgId" FROM bus_trip WHERE id = $1`, tripID).Scan(&orgID); err != nil {
		return err
	}
	settlementAcct, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return err
	}
	payableAcct, _, err := parcelOrgPayableAccountTx(ctx, tx, pool, orgID)
	if err != nil {
		return err
	}
	if _, err := ledger.PostEntryTx(ctx, tx,
		"bus-booking:"+bookingID, "Bus ticket payment", "core-go:bus-booking:"+bookingID,
		[]ledger.Posting{
			{AccountID: settlementAcct, AmountCents: ledger.CentsFromKES(priceKES)},
			{AccountID: payableAcct, AmountCents: ledger.CentsFromKES(-priceKES)},
		}); err != nil {
		return err
	}
	return createBusBookingOrgPayoutTx(ctx, tx, bookingID, orgID, priceKES)
}

// PendingBusBookingCheckoutID returns the checkout id a booking code's
// seats are still waiting on payment for, or "" when there is none
// (already paid, never pushed, or not found). Every seat in the group
// shares one checkout id, so any one row answers for the whole
// booking — same shape PendingParcelCheckoutID follows for a parcel.
func PendingBusBookingCheckoutID(ctx context.Context, pool *pgxpool.Pool, code string) (string, error) {
	var id *string
	err := pool.QueryRow(ctx, `
		SELECT "mpesaCheckoutRequestId" FROM bus_booking
		WHERE code = $1 AND status = 'PENDING_PAYMENT' AND "mpesaCheckoutRequestId" IS NOT NULL
		LIMIT 1`, code).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) || id == nil {
		return "", nil
	}
	return *id, err
}

// ReleaseBusBookingByCheckoutID frees every still-pending seat under
// this checkout after the provider reports the push definitively
// failed (cancelled, wrong PIN, insufficient funds) — same guard
// ReleaseParcelPaymentByCheckoutID follows: a seat already PAID in the
// meantime is never touched.
func ReleaseBusBookingByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE bus_booking SET status = 'CANCELLED', "cancelledAt" = now()
		WHERE "mpesaCheckoutRequestId" = $1 AND status = 'PENDING_PAYMENT'`, checkoutID)
	return err
}

// ListCoopBusBookingPushesToReconcile returns every bus booking checkout
// still waiting on Co-op, one row per checkout id (not per seat) — the
// sweep only needs to enquire once per group. Mirrors
// ListCoopPushesToReconcile; bus_booking has no dedicated "requested
// at" column, so createdAt (set once, with the checkout id attached
// moments later) stands in for it.
func ListCoopBusBookingPushesToReconcile(ctx context.Context, pool *pgxpool.Pool, prefix string, limit int) ([]CoopPendingPush, error) {
	rows, err := pool.Query(ctx, `
		SELECT "mpesaCheckoutRequestId", min("createdAt")
		FROM bus_booking
		WHERE "mpesaCheckoutRequestId" LIKE $1 || '%' AND status = 'PENDING_PAYMENT'
		GROUP BY "mpesaCheckoutRequestId"
		ORDER BY min("createdAt")
		LIMIT $2`, prefix, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CoopPendingPush
	for rows.Next() {
		var p CoopPendingPush
		if err := rows.Scan(&p.Ref, &p.RequestedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CancelBusBooking frees a seat back up — before departure only.
func CancelBusBooking(ctx context.Context, pool *pgxpool.Pool, orgID, bookingID string) error {
	tag, err := pool.Exec(ctx, `
		UPDATE bus_booking SET status = 'CANCELLED', "cancelledAt" = now()
		WHERE id = $1 AND status IN ('PENDING_PAYMENT', 'PAID')
		  AND "tripId" IN (SELECT id FROM bus_trip WHERE "parcelOrgId" = $2 AND "departAt" > now())`,
		bookingID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That booking can't be cancelled — it may already be departed or settled"}
	}
	return nil
}

const busBookingColumns = `
	bb.id, bb."tripId", bb."seatNumber", bb."passengerName", bb."passengerMsisdn",
	bb.code, bb.status::text, bb."paymentMethod"::text, bb.channel::text, bb."priceKes"::text,
	origin.name, destination.name, t."departAt", b.name`

func scanBusBooking(row pgx.Row) (*BusBooking, error) {
	var bk BusBooking
	var priceText string
	var departAt time.Time
	if err := row.Scan(&bk.ID, &bk.TripID, &bk.SeatNumber, &bk.PassengerName, &bk.PassengerMsisdn,
		&bk.Code, &bk.Status, &bk.PaymentMethod, &bk.Channel, &priceText,
		&bk.OriginName, &bk.DestinationName, &departAt, &bk.BusName); err != nil {
		return nil, err
	}
	var err error
	if bk.PriceKes, err = parseFloatOrZero(priceText); err != nil {
		return nil, err
	}
	bk.DepartAt = departAt.UTC().Format(time.RFC3339)
	return &bk, nil
}

// ListBusBookingsByCode — public: the code is the secret, same
// convention GetBooking's own comment uses for a ticketing booking id.
// Every seat booked in the same checkout shares this code, so this
// returns all of them (seat order) rather than a single row.
func ListBusBookingsByCode(ctx context.Context, pool *pgxpool.Pool, code string) ([]BusBooking, error) {
	rows, err := pool.Query(ctx, `
		SELECT `+busBookingColumns+`
		FROM bus_booking bb
		JOIN bus_trip t ON t.id = bb."tripId"
		`+routeOriginDestJoin(`t."routeId"`)+`
		JOIN bus b ON b.id = t."busId"
		WHERE bb.code = $1
		ORDER BY bb."seatNumber" ASC`, code)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BusBooking{}
	for rows.Next() {
		bk, err := scanBusBooking(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *bk)
	}
	return out, rows.Err()
}

// ListBusBookingsForTrip — the manifest for one departure, seat order.
func ListBusBookingsForTrip(ctx context.Context, pool *pgxpool.Pool, orgID, tripID string) ([]BusBooking, error) {
	rows, err := pool.Query(ctx, `
		SELECT `+busBookingColumns+`
		FROM bus_booking bb
		JOIN bus_trip t ON t.id = bb."tripId"
		`+routeOriginDestJoin(`t."routeId"`)+`
		JOIN bus b ON b.id = t."busId"
		WHERE t.id = $1 AND t."parcelOrgId" = $2 AND bb.status IN ('PENDING_PAYMENT', 'PAID')
		ORDER BY bb."seatNumber" ASC`, tripID, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BusBooking{}
	for rows.Next() {
		bk, err := scanBusBooking(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *bk)
	}
	return out, rows.Err()
}
