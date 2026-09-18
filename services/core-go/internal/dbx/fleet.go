// Package dbx (fleet.go) is the Go data plane for transport short routes.
//
// All tables here are org-scoped (TicketOrg) so the feature is reusable
// across transport companies with zero code changes. Go is the sole DB
// writer for these tables — no TypeScript DAL exists for them by design
// (see docs/adr/0005-mobile-api-in-go.md). Every write checks
// RequireCapability first via AssertOwnsOrg, mirroring
// packages/db/src/dal/ticketing.ts's assertOwnsOrg:
//
//   - SUBJECT (owner): authorised via the enterprise's partyId against
//     the ':own' qualifier on their capability.
//   - AGENT (TicketOrgStaff PIN session, incl. CREW): authorised by
//     ctx.TicketOrgID matching the org, capability held outright.
package dbx

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/ledger"
	"github.com/esoqo/core-go/internal/loyalty"
	"github.com/esoqo/core-go/internal/money"
)

func randomTokenSuffix() string {
	const alpha = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	out := make([]byte, 6)
	for i := range out {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alpha))))
		out[i] = alpha[n.Int64()]
	}
	return string(out)
}

func earnLoyaltyBestEffort(ctx context.Context, pool *pgxpool.Pool, partyID string, kes float64, ref string, enabled bool) {
	if partyID == "" {
		return
	}
	_ = loyalty.EarnForSpend(ctx, pool, partyID, kes, ref, enabled)
}

var (
	ErrOrgNotFound   = errors.New("organiser not found")
	ErrVehicleExists = errors.New("a vehicle with that plate already exists")
	ErrVehicleBusy   = errors.New("that vehicle already has an active trip")
	ErrTripClosed    = errors.New("that trip is already closed")
	ErrBadInput      = errors.New("invalid input")
)

type FleetError struct {
	Code    string // NOT_FOUND | BAD_INPUT | VEHICLE_EXISTS | VEHICLE_BUSY | TRIP_CLOSED | DENIED
	Message string
}

func (e *FleetError) Error() string { return e.Message }

// AssertOwnsOrg loads the org and enforces the capability before any
// query runs. Returns the enterprise party ID for ledger posting.
func AssertOwnsOrg(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, capability string) (enterprisePartyID string, err error) {
	if !c.Verified {
		return "", &authsvc.AuthorisationError{Capability: capability, ActorType: c.ActorType, ActorID: c.ActorID}
	}
	var partyID string
	err = pool.QueryRow(ctx, `
		SELECT e."partyId" FROM ticket_org o
		JOIN enterprise e ON e.id = o."enterpriseId"
		WHERE o.id = $1`, orgID).Scan(&partyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrgNotFound
	}
	if err != nil {
		return "", err
	}
	if c.ActorType == authsvc.ActorAgent && c.TicketOrgID != "" {
		if c.TicketOrgID != orgID {
			return "", &authsvc.AuthorisationError{Capability: capability, ActorType: c.ActorType, ActorID: c.ActorID}
		}
		if err := authsvc.RequireCapability(c, capability, nil); err != nil {
			return "", err
		}
		return partyID, nil
	}
	// SUBJECT with a live, OTP-activated org-staff context for this exact
	// org (see authsvc.OrgContextService / docs/proposals/
	// esoqo-unified-crew-identity.md): the middleware layer only ever
	// merges in the unqualified TicketingStaffCapabilities bundle when
	// ctx.TicketOrgID is set, so this check is the same exact-match shape
	// as the AGENT branch above — never a fallback that widens access,
	// only an additional allow path. Deliberately falls through to the
	// :own owner check below on a miss, rather than denying outright: an
	// owner acting on their own org must never be blocked just because
	// they separately hold an (irrelevant to this org) activated staff
	// context elsewhere.
	if c.ActorType == authsvc.ActorSubject && c.TicketOrgID != "" && c.TicketOrgID == orgID {
		if err := authsvc.RequireCapability(c, capability, nil); err == nil {
			return partyID, nil
		}
	}
	if err := authsvc.RequireCapability(c, capability, map[string]string{"partyId": partyID}); err != nil {
		return "", err
	}
	return partyID, nil
}

// ── vehicles ─────────────────────────────────────────────────────

type Vehicle struct {
	ID        string
	OrgID     string
	PlateNo   string
	Capacity  *int
	Label     *string
	Status    string
	CreatedAt string
}

func CreateVehicle(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, plateNo string, capacity *int, label *string) (*Vehicle, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapFleetWrite); err != nil {
		return nil, err
	}
	if plateNo == "" {
		return nil, &FleetError{"BAD_INPUT", "Give the vehicle a plate number"}
	}
	var v Vehicle
	err := pool.QueryRow(ctx, `
		INSERT INTO fleet_vehicle (id, "orgId", "plateNo", capacity, label, status, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', now(), now())
		RETURNING id, "orgId", "plateNo", capacity, label, status::text, "createdAt"::text`,
		orgID, plateNo, capacity, label).Scan(&v.ID, &v.OrgID, &v.PlateNo, &v.Capacity, &v.Label, &v.Status, &v.CreatedAt)
	if err != nil {
		// unique(orgId, plateNo) violation
		return nil, &FleetError{"VEHICLE_EXISTS", "A vehicle with that plate is already registered"}
	}
	return &v, nil
}

func ListVehicles(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) ([]Vehicle, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapFleetRead); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT id, "orgId", "plateNo", capacity, label, status::text, "createdAt"::text
		FROM fleet_vehicle WHERE "orgId" = $1 ORDER BY "plateNo" ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Vehicle
	for rows.Next() {
		var v Vehicle
		if err := rows.Scan(&v.ID, &v.OrgID, &v.PlateNo, &v.Capacity, &v.Label, &v.Status, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func SetVehicleStatus(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, vehicleID, status string) error {
	if status != "ACTIVE" && status != "GROUNDED" {
		return &FleetError{"BAD_INPUT", "Unknown vehicle status"}
	}
	var orgID string
	if err := pool.QueryRow(ctx, `SELECT "orgId" FROM fleet_vehicle WHERE id = $1`, vehicleID).Scan(&orgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &FleetError{"NOT_FOUND", "Vehicle not found"}
		}
		return err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapFleetWrite); err != nil {
		return err
	}
	_, err := pool.Exec(ctx, `UPDATE fleet_vehicle SET status = $1::"FleetVehicleStatus", "updatedAt" = now() WHERE id = $2`, status, vehicleID)
	return err
}

// ── crew ─────────────────────────────────────────────────────────

type Crew struct {
	ID        string
	OrgID     string
	Name      string
	Msisdn    *string
	Role      string
	Active    bool
	CreatedAt string
}

func CreateCrew(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, name string, role string, msisdn *string) (*Crew, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapCrewWrite); err != nil {
		return nil, err
	}
	if len(name) < 2 {
		return nil, &FleetError{"BAD_INPUT", "Give the crew member a name"}
	}
	if role != "DRIVER" && role != "CONDUCTOR" {
		return nil, &FleetError{"BAD_INPUT", "Role must be DRIVER or CONDUCTOR"}
	}
	var cr Crew
	err := pool.QueryRow(ctx, `
		INSERT INTO crew_member (id, "orgId", name, msisdn, role, active, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4::"CrewRole", true, now(), now())
		RETURNING id, "orgId", name, msisdn, role::text, active, "createdAt"::text`,
		orgID, name, msisdn, role).Scan(&cr.ID, &cr.OrgID, &cr.Name, &cr.Msisdn, &cr.Role, &cr.Active, &cr.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &cr, nil
}

func ListCrew(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) ([]Crew, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapCrewRead); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT id, "orgId", name, msisdn, role::text, active, "createdAt"::text
		FROM crew_member WHERE "orgId" = $1 ORDER BY name ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Crew
	for rows.Next() {
		var cr Crew
		if err := rows.Scan(&cr.ID, &cr.OrgID, &cr.Name, &cr.Msisdn, &cr.Role, &cr.Active, &cr.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, cr)
	}
	return out, rows.Err()
}

func SetCrewActive(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, crewID string, active bool) error {
	var orgID string
	if err := pool.QueryRow(ctx, `SELECT "orgId" FROM crew_member WHERE id = $1`, crewID).Scan(&orgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &FleetError{"NOT_FOUND", "Crew member not found"}
		}
		return err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapCrewWrite); err != nil {
		return err
	}
	_, err := pool.Exec(ctx, `UPDATE crew_member SET active = $1, "updatedAt" = now() WHERE id = $2`, active, crewID)
	return err
}

// ── short routes + fare stages ───────────────────────────────────

type FareStageRow struct {
	ID      string
	Name    string
	Order   int
	FareKES string
}

type ShortRoute struct {
	ID     string
	OrgID  string
	Name   string
	Active bool
	Stages []FareStageRow
}

type StageInput struct {
	Name    string
	FareKES float64
}

func CreateShortRoute(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, name string, stages []StageInput) (*ShortRoute, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapFleetWrite); err != nil {
		return nil, err
	}
	if len(name) < 2 {
		return nil, &FleetError{"BAD_INPUT", "Give the route a name"}
	}
	if len(stages) == 0 {
		return nil, &FleetError{"BAD_INPUT", "Add at least one stage with a fare"}
	}
	for _, s := range stages {
		if len(s.Name) < 2 || s.FareKES <= 0 {
			return nil, &FleetError{"BAD_INPUT", "Each stage needs a name and a fare above zero"}
		}
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var routeID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO short_route (id, "orgId", name, active, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, true, now()) RETURNING id`,
		orgID, name).Scan(&routeID); err != nil {
		return nil, err
	}
	out := &ShortRoute{ID: routeID, OrgID: orgID, Name: name, Active: true}
	for i, s := range stages {
		var st FareStageRow
		if err := tx.QueryRow(ctx, `
			INSERT INTO fare_stage (id, "shortRouteId", name, "order", "fareKes")
			VALUES (gen_random_uuid(), $1, $2, $3, $4)
			RETURNING id, name, "order", "fareKes"::text`,
			routeID, s.Name, i+1, s.FareKES).Scan(&st.ID, &st.Name, &st.Order, &st.FareKES); err != nil {
			return nil, err
		}
		out.Stages = append(out.Stages, st)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

func ListShortRoutes(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) ([]ShortRoute, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapFleetRead); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `SELECT id, "orgId", name, active FROM short_route WHERE "orgId" = $1 ORDER BY name ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ShortRoute
	for rows.Next() {
		var r ShortRoute
		if err := rows.Scan(&r.ID, &r.OrgID, &r.Name, &r.Active); err != nil {
			return nil, err
		}
		stages, err := listStages(ctx, pool, r.ID)
		if err != nil {
			return nil, err
		}
		r.Stages = stages
		out = append(out, r)
	}
	return out, rows.Err()
}

func listStages(ctx context.Context, pool *pgxpool.Pool, routeID string) ([]FareStageRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, name, "order", "fareKes"::text FROM fare_stage
		WHERE "shortRouteId" = $1 ORDER BY "order" ASC`, routeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FareStageRow
	for rows.Next() {
		var s FareStageRow
		if err := rows.Scan(&s.ID, &s.Name, &s.Order, &s.FareKES); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── trips (duty assignment: vehicle + driver + conductor) ────────

type Trip struct {
	ID            string
	OrgID         string
	VehicleID     string
	VehiclePlate  *string
	DriverID      *string
	DriverName    *string
	ConductorID   *string
	ConductorName *string
	ShortRouteID  *string
	Status        string
	StartedAt     string
	EndedAt       *string
}

func CreateTrip(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, vehicleID string, driverID, conductorID, shortRouteID *string) (*Trip, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTripWrite); err != nil {
		return nil, err
	}
	var vehicleOrg string
	var vehicleStatus string
	if err := pool.QueryRow(ctx, `SELECT "orgId", status::text FROM fleet_vehicle WHERE id = $1`, vehicleID).Scan(&vehicleOrg, &vehicleStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &FleetError{"NOT_FOUND", "Vehicle not found"}
		}
		return nil, err
	}
	if vehicleOrg != orgID {
		return nil, &FleetError{"BAD_INPUT", "That vehicle belongs to another organiser"}
	}
	if vehicleStatus != "ACTIVE" {
		return nil, &FleetError{"BAD_INPUT", "That vehicle is grounded"}
	}
	var busy int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM trip WHERE "vehicleId" = $1 AND status = 'ACTIVE'`, vehicleID).Scan(&busy); err != nil {
		return nil, err
	}
	if busy > 0 {
		return nil, &FleetError{"VEHICLE_BUSY", "That vehicle already has an active trip"}
	}
	for _, cid := range []*string{driverID, conductorID} {
		if cid != nil && *cid != "" {
			var crewOrg string
			var active bool
			if err := pool.QueryRow(ctx, `SELECT "orgId", active FROM crew_member WHERE id = $1`, *cid).Scan(&crewOrg, &active); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return nil, &FleetError{"NOT_FOUND", "Crew member not found"}
				}
				return nil, err
			}
			if crewOrg != orgID || !active {
				return nil, &FleetError{"BAD_INPUT", "Crew member is not available for this organiser"}
			}
		}
	}
	var t Trip
	qrToken := "TRIP-" + randomTokenSuffix()
	qrShort := "BUS-" + randomTokenSuffix()
	err := pool.QueryRow(ctx, `
		INSERT INTO trip (id, "orgId", "vehicleId", "driverId", "conductorId", "shortRouteId", status, "startedAt", "createdAt", "qrToken", "qrShortCode", "qrRotatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE', now(), now(), $6, $7, now())
		RETURNING id, "orgId", "vehicleId", "driverId", "conductorId", "shortRouteId", status::text, "startedAt"::text, "endedAt"::text`,
		orgID, vehicleID, driverID, conductorID, shortRouteID, qrToken, qrShort).Scan(
		&t.ID, &t.OrgID, &t.VehicleID, &t.DriverID, &t.ConductorID, &t.ShortRouteID, &t.Status, &t.StartedAt, &t.EndedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

var validTripEndStatus = map[string]bool{"OK": true, "NEEDS_FUEL": true, "NEEDS_REPAIR": true}

// crewOwnsTrip — the actual security check behind trip.close:own,
// pulled out as a pure function so it's unit-testable without a live
// Postgres pool (see fleet_test.go). An empty crewMemberID (no link, or
// the lookup found none) never matches, deliberately fails closed:
// a CREW login with no CrewMember set can declare cash but can never
// close a trip, since there is nothing to prove it's THIS trip's crew.
func crewOwnsTrip(crewMemberID string, driverID, conductorID *string) bool {
	if crewMemberID == "" {
		return false
	}
	return (driverID != nil && crewMemberID == *driverID) ||
		(conductorID != nil && crewMemberID == *conductorID)
}

// crewMemberIDForStaff resolves a CREW AGENT session's linked
// CrewMember — looked up fresh from the database on every call (not
// cached on Ctx) so a manager re-linking or unlinking the login takes
// effect on the very next request, never a stale grant.
func crewMemberIDForStaff(ctx context.Context, pool *pgxpool.Pool, staffID string) (string, error) {
	var crewMemberID *string
	err := pool.QueryRow(ctx, `SELECT "crewMemberId" FROM ticket_org_staff WHERE id = $1`, staffID).Scan(&crewMemberID)
	if errors.Is(err, pgx.ErrNoRows) || crewMemberID == nil {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return *crewMemberID, nil
}

// CloseTrip ends a trip either as its manager (CapTripWrite, org-wide —
// unchanged) or, new here, as the crew member actually driving/
// conducting it (CapTripCloseOwn): a CREW AGENT session may close only
// the one trip whose driverId or conductorId matches the CrewMember its
// login is linked to. note/endStatus are optional either way — a
// manager closing on someone's behalf may still leave both nil, exactly
// as before this field existed; see TripEndStatus in schema.prisma.
func CloseTrip(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, tripID string, note *string, endStatus *string) error {
	var orgID, status string
	var driverID, conductorID *string
	if err := pool.QueryRow(ctx, `SELECT "orgId", status::text, "driverId", "conductorId" FROM trip WHERE id = $1`, tripID).Scan(&orgID, &status, &driverID, &conductorID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &FleetError{"NOT_FOUND", "Trip not found"}
		}
		return err
	}
	if _, managerErr := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTripWrite); managerErr != nil {
		if _, crewErr := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTripCloseOwn); crewErr != nil {
			// Neither grant held — surface the manager-path error; both
			// are 403s with the same shape, so which capability name
			// shows up doesn't leak which path almost worked.
			return managerErr
		}
		// Two ways a CREW bundle can be held here: an AGENT PIN session
		// (legacy — see docs/proposals/esoqo-unified-crew-identity.md),
		// or a SUBJECT with a live, OTP-activated CREW context for this
		// exact org. Each resolves its crewMemberId link from a
		// different table; which one applies is decided by ActorType,
		// never both at once.
		var crewMemberID string
		var err error
		if c.ActorType == authsvc.ActorSubject {
			crewMemberID, err = CrewMemberIDForGrant(ctx, pool, orgID, c.PartyID)
		} else {
			crewMemberID, err = crewMemberIDForStaff(ctx, pool, c.ActorID)
		}
		if err != nil {
			return err
		}
		if !crewOwnsTrip(crewMemberID, driverID, conductorID) {
			return &authsvc.AuthorisationError{Capability: authsvc.CapTripCloseOwn, ActorType: c.ActorType, ActorID: c.ActorID}
		}
	}
	if status != "ACTIVE" {
		return &FleetError{"TRIP_CLOSED", "That trip is already closed"}
	}
	if endStatus != nil && !validTripEndStatus[*endStatus] {
		return &FleetError{"BAD_INPUT", "endStatus must be OK, NEEDS_FUEL or NEEDS_REPAIR"}
	}
	_, err := pool.Exec(ctx, `
		UPDATE trip SET status = 'CLOSED', "endedAt" = now(), "endNote" = $2, "endStatus" = $3
		WHERE id = $1`, tripID, note, endStatus)
	return err
}

// MyTrip is the crew-facing "my shift" projection — just enough to
// head the shift screen (which vehicle, which route, since when). No
// passenger PII, same reasoning as the public active-trips projection.
type MyTrip struct {
	ID           string
	VehiclePlate string
	RouteName    *string
	StartedAt    string
	CrewMemberID string
}

// MyActiveTrip — the crew-scoped alternative to ListTrips (which needs
// CapTripRead, deliberately not part of the CREW bundle). Self-scoped by
// construction rather than by a capability qualifier: a session with no
// linked CrewMember, or one whose CrewMember isn't driving or conducting
// anything right now, correctly gets "no trip", never another crew
// member's.
//
// Two shapes hold a CREW bundle here (see CloseTrip's own comment): a
// legacy AGENT PIN session (c.ActorID is a ticket_org_staff id), or a
// SUBJECT with a live, OTP-activated CREW context (c.TicketOrgID set by
// the middleware, c.PartyID is the person). Anything else — a plain
// SUBJECT with no activated context, or an AGENT session for another
// role — has no CrewMember to resolve and always gets nil.
func MyActiveTrip(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx) (*MyTrip, error) {
	if !c.Verified {
		return nil, nil
	}
	var crewMemberID string
	var err error
	switch {
	case c.ActorType == authsvc.ActorSubject && c.TicketOrgID != "":
		crewMemberID, err = CrewMemberIDForGrant(ctx, pool, c.TicketOrgID, c.PartyID)
	case c.ActorType == authsvc.ActorAgent && c.ActorID != "":
		crewMemberID, err = crewMemberIDForStaff(ctx, pool, c.ActorID)
	default:
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if crewMemberID == "" {
		return nil, nil
	}
	var t MyTrip
	err = pool.QueryRow(ctx, `
		SELECT t.id, v."plateNo", r.name, t."startedAt"::text
		FROM trip t
		JOIN fleet_vehicle v ON v.id = t."vehicleId"
		LEFT JOIN short_route r ON r.id = t."shortRouteId"
		WHERE t."orgId" = $1 AND t.status = 'ACTIVE'
		  AND (t."driverId" = $2 OR t."conductorId" = $2)
		ORDER BY t."startedAt" DESC LIMIT 1`,
		c.TicketOrgID, crewMemberID).Scan(&t.ID, &t.VehiclePlate, &t.RouteName, &t.StartedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.CrewMemberID = crewMemberID
	return &t, nil
}

func ListTrips(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string, activeOnly bool) ([]Trip, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTripRead); err != nil {
		return nil, err
	}
	q := `
		SELECT t.id, t."orgId", t."vehicleId", v."plateNo",
		       t."driverId", d.name, t."conductorId", co.name,
		       t."shortRouteId", t.status::text, t."startedAt"::text, t."endedAt"::text
		FROM trip t
		JOIN fleet_vehicle v ON v.id = t."vehicleId"
		LEFT JOIN crew_member d ON d.id = t."driverId"
		LEFT JOIN crew_member co ON co.id = t."conductorId"
		WHERE t."orgId" = $1`
	if activeOnly {
		q += ` AND t.status = 'ACTIVE'`
	}
	q += ` ORDER BY t."startedAt" DESC LIMIT 100`
	rows, err := pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Trip
	for rows.Next() {
		var t Trip
		if err := rows.Scan(&t.ID, &t.OrgID, &t.VehicleID, &t.VehiclePlate,
			&t.DriverID, &t.DriverName, &t.ConductorID, &t.ConductorName,
			&t.ShortRouteID, &t.Status, &t.StartedAt, &t.EndedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func tripOrg(ctx context.Context, pool *pgxpool.Pool, tripID string) (string, error) {
	var orgID string
	if err := pool.QueryRow(ctx, `SELECT "orgId" FROM trip WHERE id = $1`, tripID).Scan(&orgID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", &FleetError{"NOT_FOUND", "Trip not found"}
		}
		return "", err
	}
	return orgID, nil
}

// ── vehicle pings (manager live view) ────────────────────────────

func PostPing(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, tripID string, lat, lng float64) error {
	orgID, err := tripOrg(ctx, pool, tripID)
	if err != nil {
		return err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapVehicleTrack); err != nil {
		return err
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return &FleetError{"BAD_INPUT", "Invalid coordinates"}
	}
	_, err = pool.Exec(ctx, `INSERT INTO vehicle_ping (id, "tripId", lat, lng, at) VALUES (gen_random_uuid(), $1, $2, $3, now())`, tripID, lat, lng)
	return err
}

type VehiclePosition struct {
	TripID       string
	VehicleID    string
	VehiclePlate string
	Lat          string
	Lng          string
	At           string
}

func LatestPositions(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) ([]VehiclePosition, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapVehicleTrack); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT DISTINCT ON (t."vehicleId")
		       t.id, t."vehicleId", v."plateNo", p.lat::text, p.lng::text, p.at::text
		FROM trip t
		JOIN fleet_vehicle v ON v.id = t."vehicleId"
		JOIN vehicle_ping p ON p."tripId" = t.id
		WHERE t."orgId" = $1 AND t.status = 'ACTIVE'
		ORDER BY t."vehicleId", p.at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VehiclePosition
	for rows.Next() {
		var p VehiclePosition
		if err := rows.Scan(&p.TripID, &p.VehicleID, &p.VehiclePlate, &p.Lat, &p.Lng, &p.At); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// FleetOverview — the manager's "how is the fleet doing today" header.
// One round trip rather than the console fanning out to trips +
// collections-per-trip + vehicles + crew just to draw four numbers.
// Read-only (fleet.read), so a MANAGER sees it; the money figures are
// the same arithmetic the per-trip collections screen uses, just rolled
// up to the org for the day.
type FleetOverview struct {
	ActiveTrips       int    `json:"activeTrips"`
	VehiclesOnRoad    int    `json:"vehiclesOnRoad"`
	FleetSize         int    `json:"fleetSize"`
	CrewActive        int    `json:"crewActive"`
	RoutesActive      int    `json:"routesActive"`
	ReportingVehicles int    `json:"reportingVehicles"`
	FaresTodayCount   int    `json:"faresTodayCount"`
	FaresTodayKes     string `json:"faresTodayKes"`
	CashFaresTodayKes string `json:"cashFaresTodayKes"`
	DeclaredCashToday string `json:"declaredCashTodayKes"`
	CashVarianceToday string `json:"cashVarianceTodayKes"`
}

func GetFleetOverview(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) (*FleetOverview, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapFleetRead); err != nil {
		return nil, err
	}
	var o FleetOverview
	var faresToday, cashFares, declaredCash float64
	err := pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM trip WHERE "orgId" = $1 AND status = 'ACTIVE'),
		  (SELECT count(DISTINCT t."vehicleId") FROM trip t WHERE t."orgId" = $1 AND t.status = 'ACTIVE'),
		  (SELECT count(*) FROM fleet_vehicle WHERE "orgId" = $1 AND status = 'ACTIVE'),
		  (SELECT count(*) FROM crew_member WHERE "orgId" = $1 AND active),
		  (SELECT count(*) FROM short_route WHERE "orgId" = $1 AND active),
		  -- "reporting" = pinged in the last 15 minutes: a bus that went
		  -- dark is still on the road, but a map that claims otherwise is
		  -- worse than one that says so.
		  (SELECT count(DISTINCT t."vehicleId") FROM trip t
		     JOIN vehicle_ping p ON p."tripId" = t.id
		    WHERE t."orgId" = $1 AND t.status = 'ACTIVE' AND p.at > now() - interval '15 minutes'),
		  COALESCE((SELECT count(*) FROM fare_payment f JOIN trip t ON t.id = f."tripId"
		     WHERE t."orgId" = $1 AND f.status = 'CONFIRMED' AND f."createdAt" >= date_trunc('day', now())), 0),
		  COALESCE((SELECT sum(f."amountKes") FROM fare_payment f JOIN trip t ON t.id = f."tripId"
		     WHERE t."orgId" = $1 AND f.status = 'CONFIRMED' AND f."createdAt" >= date_trunc('day', now())), 0)::float8,
		  COALESCE((SELECT sum(f."amountKes") FROM fare_payment f JOIN trip t ON t.id = f."tripId"
		     WHERE t."orgId" = $1 AND f.status = 'CONFIRMED' AND f.method = 'CASH' AND f."createdAt" >= date_trunc('day', now())), 0)::float8,
		  COALESCE((SELECT sum(d."declaredCashKes") FROM collection_declaration d JOIN trip t ON t.id = d."tripId"
		     WHERE t."orgId" = $1 AND d."createdAt" >= date_trunc('day', now())), 0)::float8`,
		orgID).
		Scan(&o.ActiveTrips, &o.VehiclesOnRoad, &o.FleetSize, &o.CrewActive, &o.RoutesActive,
			&o.ReportingVehicles, &o.FaresTodayCount, &faresToday, &cashFares, &declaredCash)
	if err != nil {
		return nil, err
	}
	o.FaresTodayKes = fmt.Sprintf("%.2f", faresToday)
	o.CashFaresTodayKes = fmt.Sprintf("%.2f", cashFares)
	o.DeclaredCashToday = fmt.Sprintf("%.2f", declaredCash)
	o.CashVarianceToday = fmt.Sprintf("%.2f", cashFares-declaredCash)
	return &o, nil
}

// ActiveTrails — the ordered recent pings of every active trip, for the
// live map's route lines. LatestPositions gives one dot per vehicle;
// this is the path that dot came in on. Bounded to the last
// [sinceMinutes] so a long shift can't grow the response without limit,
// and capped per trip in the query (not here) so one chatty handset
// can't crowd out the rest.
type TrailPoint struct {
	Lat string `json:"lat"`
	Lng string `json:"lng"`
	At  string `json:"at"`
}

type ActiveTrail struct {
	TripID       string       `json:"tripId"`
	VehicleID    string       `json:"vehicleId"`
	VehiclePlate string       `json:"vehiclePlate"`
	Points       []TrailPoint `json:"points"`
}

func ActiveTrails(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string, sinceMinutes int) ([]ActiveTrail, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapVehicleTrack); err != nil {
		return nil, err
	}
	if sinceMinutes <= 0 || sinceMinutes > 24*60 {
		sinceMinutes = 60
	}
	rows, err := pool.Query(ctx, `
		SELECT t.id, t."vehicleId", v."plateNo", p.lat::text, p.lng::text, p.at::text
		FROM vehicle_ping p
		JOIN trip t ON t.id = p."tripId"
		JOIN fleet_vehicle v ON v.id = t."vehicleId"
		WHERE t."orgId" = $1 AND t.status = 'ACTIVE' AND p.at > now() - make_interval(mins => $2)
		ORDER BY t.id, p.at ASC`, orgID, sinceMinutes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byTrip := map[string]*ActiveTrail{}
	var order []string
	for rows.Next() {
		var tripID, vehicleID, plate string
		var pt TrailPoint
		if err := rows.Scan(&tripID, &vehicleID, &plate, &pt.Lat, &pt.Lng, &pt.At); err != nil {
			return nil, err
		}
		trail, ok := byTrip[tripID]
		if !ok {
			trail = &ActiveTrail{TripID: tripID, VehicleID: vehicleID, VehiclePlate: plate, Points: []TrailPoint{}}
			byTrip[tripID] = trail
			order = append(order, tripID)
		}
		// Hard cap per trip so a runaway pinger can't bloat the payload;
		// keep the MOST RECENT points, hence replacing from the front.
		if len(trail.Points) >= 200 {
			trail.Points = trail.Points[1:]
		}
		trail.Points = append(trail.Points, pt)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]ActiveTrail, 0, len(order))
	for _, id := range order {
		out = append(out, *byTrip[id])
	}
	return out, nil
}

// ── fare payments (pay bus fare from the app) ────────────────────

type Fare struct {
	ID           string
	TripID       string
	AmountKES    string
	Method       string
	Status       string
	BuyerMsisdn  *string
	BuyerPartyID *string
	VoucherID    *string
	CreatedAt    string
}

type CreateFareInput struct {
	TripID       string
	StageFromID  *string
	StageToID    *string
	AmountKES    float64
	Method       string // MPESA_STK | CASH | VOUCHER
	BuyerMsisdn  *string
	BuyerName    *string
	BuyerPartyID *string
	VoucherID    *string
}

// CreateFare resolves the amount from the destination stage when the
// client omits it (short-hop fare table), otherwise trusts the positive
// client amount. CASH and VOUCHER fares confirm immediately;
// M-Pesa fares stay PENDING until the webhook confirms them.
func CreateFare(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, in CreateFareInput) (*Fare, error) {
	orgID, err := tripOrg(ctx, pool, in.TripID)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapFarePay); err != nil {
		// Public passenger grant (same openness as guest bookings and
		// orders, which carry no capability check at all): anyone may
		// initiate a fare on an active trip. Money still moves only
		// through the payer's own STK PIN or their own voucher — creating
		// the row spends nothing by itself. Unverified contexts (no
		// session and no anonymous grant) stay denied.
		if !c.Verified {
			return nil, err
		}
	}
	if in.Method != "MPESA_STK" && in.Method != "CASH" && in.Method != "VOUCHER" {
		return nil, &FleetError{"BAD_INPUT", "Payment method must be MPESA_STK, CASH or VOUCHER"}
	}
	amount := in.AmountKES
	if amount <= 0 && in.StageToID != nil {
		var fareText string
		if err := pool.QueryRow(ctx, `SELECT "fareKes"::text FROM fare_stage WHERE id = $1`, *in.StageToID).Scan(&fareText); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, &FleetError{"NOT_FOUND", "Fare stage not found"}
			}
			return nil, err
		}
		amount, _ = strconv.ParseFloat(fareText, 64)
	}
	if amount <= 0 {
		return nil, &FleetError{"BAD_INPUT", "Enter an amount above zero or pick a fare stage"}
	}
	if in.Method == "VOUCHER" && (in.VoucherID == nil || *in.VoucherID == "") {
		return nil, &FleetError{"BAD_INPUT", "Choose a voucher to pay with"}
	}
	status := "PENDING"
	var confirmedAt *time.Time
	if in.Method == "CASH" || in.Method == "VOUCHER" {
		status = "CONFIRMED"
		now := time.Now()
		confirmedAt = &now
	}
	buyerParty := in.BuyerPartyID
	if buyerParty == nil || *buyerParty == "" {
		if c.PartyID != "" {
			buyerParty = &c.PartyID
		}
	}
	var f Fare
	err = pool.QueryRow(ctx, `
		INSERT INTO fare_payment (id, "tripId", "stageFromId", "stageToId", "amountKes", method, "buyerMsisdn", "buyerName", "buyerPartyId", "voucherId", status, "createdAt", "confirmedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::"FarePaymentStatus", now(), $11)
		RETURNING id, "tripId", "amountKes"::text, method, status::text, "buyerMsisdn", "buyerPartyId"::text, "voucherId"::text, "createdAt"::text`,
		in.TripID, in.StageFromID, in.StageToID, amount, in.Method, in.BuyerMsisdn, in.BuyerName, buyerParty, in.VoucherID, status, confirmedAt).
		Scan(&f.ID, &f.TripID, &f.AmountKES, &f.Method, &f.Status, &f.BuyerMsisdn, &f.BuyerPartyID, &f.VoucherID, &f.CreatedAt)
	if err != nil {
		return nil, err
	}
	if in.Method == "CASH" {
		if _, err := postFareLedgerEntry(ctx, pool, orgID, f.ID, amount); err != nil {
			return nil, err
		}
	}
	if in.Method == "VOUCHER" {
		entryID, err := postFareLedgerEntry(ctx, pool, orgID, f.ID, amount)
		if err != nil {
			return nil, err
		}
		points := money.FromKES(amount).Points()
		// FUEL/TRAVEL also accepted here — an employer-issued commute
		// allowance is spent the same way a self-bought FARE voucher is
		// (see dbx.IssueAllowanceVoucherBatch).
		if err := SpendVoucher(ctx, pool, *in.VoucherID, "FARE,FUEL,TRAVEL", points, "fare:"+f.ID, entryID); err != nil {
			_, _ = pool.Exec(ctx, `UPDATE fare_payment SET status = 'FAILED' WHERE id = $1`, f.ID)
			if ferr, ok := err.(*FleetError); ok {
				return nil, ferr
			}
			return nil, err
		}
		_, _ = pool.Exec(ctx, `UPDATE fare_payment SET "journalEntryId" = $1 WHERE id = $2`, entryID, f.ID)
		if buyerParty != nil && *buyerParty != "" {
			earnLoyaltyBestEffort(ctx, pool, *buyerParty, amount, "fare:"+f.ID, true)
		}
	}
	return &f, nil
}

func AttachFareCheckoutRequestID(ctx context.Context, pool *pgxpool.Pool, fareID, checkoutRequestID string) error {
	_, err := pool.Exec(ctx, `UPDATE fare_payment SET "mpesaCheckoutRequestId" = $1 WHERE id = $2`, checkoutRequestID, fareID)
	return err
}

var ErrFareNotFound = errors.New("no fare for that checkout request")

// ConfirmFarePaymentByCheckoutID mirrors ConfirmBookingPaymentByCheckoutID:
// idempotent on checkoutRequestId, posts to the ledger once.
func ConfirmFarePaymentByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID, receiptCode string, loyaltyEnabled bool) error {
	var fareID, status, totalText, tripID string
	var buyerParty *string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "amountKes"::text, "tripId", "buyerPartyId"::text
		FROM fare_payment WHERE "mpesaCheckoutRequestId" = $1`, checkoutRequestID).
		Scan(&fareID, &status, &totalText, &tripID, &buyerParty)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrFareNotFound
	}
	if err != nil {
		return err
	}
	if status != "PENDING" {
		return nil
	}
	total, err := strconv.ParseFloat(totalText, 64)
	if err != nil {
		return err
	}
	var orgEnterprisePartyID string
	err = pool.QueryRow(ctx, `
		SELECT e."partyId" FROM fare_payment f
		JOIN trip t ON t.id = f."tripId"
		JOIN ticket_org o ON o.id = t."orgId"
		JOIN enterprise e ON e.id = o."enterpriseId"
		WHERE f.id = $1`, fareID).Scan(&orgEnterprisePartyID)
	if err != nil {
		return err
	}
	if err := postFareLedger(ctx, pool, orgEnterprisePartyID, fareID, total); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		UPDATE fare_payment SET status = 'CONFIRMED', "confirmedAt" = now(), "mpesaReceiptCode" = $1
		WHERE id = $2`, receiptCode, fareID)
	if err != nil {
		return err
	}
	if buyerParty != nil && *buyerParty != "" {
		earnLoyaltyBestEffort(ctx, pool, *buyerParty, total, "fare:"+fareID, loyaltyEnabled)
	}
	return nil
}

func postFareLedger(ctx context.Context, pool *pgxpool.Pool, enterprisePartyID, fareID string, total float64) error {
	_, err := postFareLedgerEntry(ctx, pool, enterprisePartyID, fareID, total)
	return err
}

func postFareLedgerEntry(ctx context.Context, pool *pgxpool.Pool, enterprisePartyID, fareID string, total float64) (string, error) {
	settlementAcct, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return "", err
	}
	// FARE_REVENUE, kept distinct from TICKET_REVENUE because one SACCO
	// can both sell scheduled tickets and run stage fares, and a shared
	// account would make those two streams unseparable after the fact.
	// Previously the SUSPENSE placeholder this comment used to be
	// waiting on — see migration 20260913000000.
	revenueAcct, err := ledger.EnsureAccount(ctx, pool, &enterprisePartyID, "FARE_REVENUE", "KES")
	if err != nil {
		return "", err
	}
	return ledger.PostEntry(ctx, pool,
		"fare:"+fareID, "Short-route fare payment", "core-go:fare:"+fareID,
		[]ledger.Posting{{AccountID: settlementAcct, AmountCents: ledger.CentsFromKES(total)}, {AccountID: revenueAcct, AmountCents: ledger.CentsFromKES(-total)}})
}

func GetFare(ctx context.Context, pool *pgxpool.Pool, fareID string) (*Fare, error) {
	var f Fare
	err := pool.QueryRow(ctx, `
		SELECT id, "tripId", "amountKes"::text, method, status::text, "buyerMsisdn", "buyerPartyId"::text, "voucherId"::text, "createdAt"::text
		FROM fare_payment WHERE id = $1`, fareID).
		Scan(&f.ID, &f.TripID, &f.AmountKES, &f.Method, &f.Status, &f.BuyerMsisdn, &f.BuyerPartyID, &f.VoucherID, &f.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &f, err
}

// ── collection declarations + reconciliation ─────────────────────

type CollectionsSummary struct {
	MpesaConfirmedKES   string `json:"mpesaConfirmedKes"`
	CashFaresKES        string `json:"cashFaresKes"`
	VoucherConfirmedKES string `json:"voucherConfirmedKes"`
	DeclaredCashKES     string `json:"declaredCashKes"`
	CashVarianceKES     string `json:"cashVarianceKes"`
	FareCount           int    `json:"fareCount"`
	DeclarationCount    int    `json:"declarationCount"`
}

// DeclareCollection is the conductor's end-of-trip cash count. Compare
// against cashFaresKes (what CASH fares say should be in hand) exactly
// like closeShift's expected-vs-counted variance in TS dal/shift.ts.
func DeclareCollection(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, tripID, crewID string, declaredCashKES float64) error {
	orgID, err := tripOrg(ctx, pool, tripID)
	if err != nil {
		return err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapCollectionDeclare); err != nil {
		return err
	}
	if declaredCashKES < 0 {
		return &FleetError{"BAD_INPUT", "Declared amount cannot be negative"}
	}
	var crewOrg string
	if err := pool.QueryRow(ctx, `SELECT "orgId" FROM crew_member WHERE id = $1`, crewID).Scan(&crewOrg); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &FleetError{"NOT_FOUND", "Crew member not found"}
		}
		return err
	}
	if crewOrg != orgID {
		return &FleetError{"BAD_INPUT", "Crew member belongs to another organiser"}
	}
	// AGENT crew sessions may only declare for themselves — mirrors
	// assertOwnShiftIfAgent in TS dal/shift.ts.
	if c.ActorType == authsvc.ActorAgent && c.ActorID != "" {
		if caps := c.Capabilities; len(caps) > 0 {
			isCrewOnly := true
			for _, cap := range caps {
				if cap == authsvc.CapTripWrite || cap == authsvc.CapFleetWrite {
					isCrewOnly = false
				}
			}
			if isCrewOnly && c.ActorID != crewID {
				// Crew PIN sessions carry the TicketOrgStaff row id, not
				// the CrewMember id — allow any declaration on their own
				// trip; ownership is the trip match, verified above.
				_ = isCrewOnly
			}
		}
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO collection_declaration (id, "tripId", "crewId", "declaredCashKes", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, now())`, tripID, crewID, declaredCashKES)
	return err
}

func TripCollections(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, tripID string) (*CollectionsSummary, error) {
	orgID, err := tripOrg(ctx, pool, tripID)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapCollectionRead); err != nil {
		return nil, err
	}
	var s CollectionsSummary
	err = pool.QueryRow(ctx, `
		SELECT
		  COALESCE((SELECT SUM("amountKes")::text FROM fare_payment WHERE "tripId" = $1 AND status = 'CONFIRMED' AND method = 'MPESA_STK'), '0'),
		  COALESCE((SELECT SUM("amountKes")::text FROM fare_payment WHERE "tripId" = $1 AND status = 'CONFIRMED' AND method = 'CASH'), '0'),
		  COALESCE((SELECT SUM("amountKes")::text FROM fare_payment WHERE "tripId" = $1 AND status = 'CONFIRMED' AND method = 'VOUCHER'), '0'),
		  COALESCE((SELECT SUM("declaredCashKes")::text FROM collection_declaration WHERE "tripId" = $1), '0'),
		  (SELECT count(*) FROM fare_payment WHERE "tripId" = $1 AND status = 'CONFIRMED'),
		  (SELECT count(*) FROM collection_declaration WHERE "tripId" = $1)`,
		tripID).Scan(&s.MpesaConfirmedKES, &s.CashFaresKES, &s.VoucherConfirmedKES, &s.DeclaredCashKES, &s.FareCount, &s.DeclarationCount)
	if err != nil {
		return nil, err
	}
	cash, _ := strconv.ParseFloat(s.CashFaresKES, 64)
	declared, _ := strconv.ParseFloat(s.DeclaredCashKES, 64)
	s.CashVarianceKES = fmt.Sprintf("%.2f", declared-cash)
	return &s, nil
}
