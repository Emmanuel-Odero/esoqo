// Package dbx (parcel_teams.go) — courier teams: a manager plus a
// roster of members, owning one or more fleets (a physical vehicle,
// its own fleetNumber), each fleet running trips (a batch of parcels
// handed to it, from dispatch until marked back). A dispatch-planning
// layer on top of the existing individual-courier role (parcel_couriers.go)
// — a team member doesn't need to be a vetted ParcelCourier to ride on
// a fleet's trip. See the 20260911200000 migration's own comment for
// the full schema rationale.
package dbx

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CourierTeamError struct {
	Code    string // BAD_INPUT | NOT_FOUND
	Message string
}

func (e *CourierTeamError) Error() string { return e.Message }

// CourierTeamMemberInput is one person being added to a team —
// admin-typed name/phone, same "just add them" shape AdminAddCourier
// already uses (see FindOrCreatePersonWithName), not a search-first
// existing-Party lookup.
type CourierTeamMemberInput struct {
	Name   string
	Msisdn string
	Role   string // MANAGER | MEMBER | DRIVER | ...
}

// CreateCourierTeam creates a team plus its first member — almost
// always the manager, but callers decide the role — texting them the
// same "you've been added" confirmation AddCourierTeamMember's own
// caller sends (see notify.CourierTeamMemberAdded), so a team and its
// manager are never left in a state where the team exists but nobody
// who's supposed to run it has heard about it yet.
func CreateCourierTeam(ctx context.Context, pool *pgxpool.Pool, name string, manager CourierTeamMemberInput, staffID *string) (teamID, managerPartyID, esokoID string, err error) {
	if name == "" {
		return "", "", "", &CourierTeamError{"BAD_INPUT", "Team name is required"}
	}
	if manager.Name == "" || manager.Msisdn == "" {
		return "", "", "", &CourierTeamError{"BAD_INPUT", "The manager's name and phone number are required"}
	}
	if manager.Role == "" {
		manager.Role = "MANAGER"
	}

	err = pool.QueryRow(ctx, `
		INSERT INTO courier_team (id, name, "createdAt", "createdByStaffId")
		VALUES (gen_random_uuid(), $1, now(), $2) RETURNING id`, name, staffID).Scan(&teamID)
	if err != nil {
		return "", "", "", err
	}

	managerPartyID, esokoID, err = addCourierTeamMember(ctx, pool, teamID, manager)
	if err != nil {
		return "", "", "", err
	}
	return teamID, managerPartyID, esokoID, nil
}

// AddCourierTeamMember adds one more person to an existing team —
// texts them the same "you've been added" confirmation CreateCourierTeam's
// own first member gets.
func AddCourierTeamMember(ctx context.Context, pool *pgxpool.Pool, teamID string, in CourierTeamMemberInput) (partyID, esokoID string, err error) {
	var exists bool
	if qerr := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM courier_team WHERE id = $1)`, teamID).Scan(&exists); qerr != nil {
		return "", "", qerr
	}
	if !exists {
		return "", "", &CourierTeamError{"NOT_FOUND", "That team was not found"}
	}
	if in.Name == "" || in.Msisdn == "" {
		return "", "", &CourierTeamError{"BAD_INPUT", "Name and phone number are required"}
	}
	if in.Role == "" {
		in.Role = "MEMBER"
	}
	return addCourierTeamMember(ctx, pool, teamID, in)
}

func addCourierTeamMember(ctx context.Context, pool *pgxpool.Pool, teamID string, in CourierTeamMemberInput) (partyID, esokoID string, err error) {
	partyID, err = FindOrCreatePersonWithName(ctx, pool, in.Name, in.Msisdn, nil)
	if err != nil {
		return "", "", err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO courier_team_member (id, "teamId", "partyId", role, "addedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, now())
		ON CONFLICT ("teamId", "partyId") DO UPDATE SET role = EXCLUDED.role`,
		teamID, partyID, in.Role)
	if err != nil {
		return "", "", err
	}
	esokoID, err = EnsureEsokoPaymentId(ctx, pool, partyID, in.Msisdn)
	if err != nil {
		return "", "", err
	}
	return partyID, esokoID, nil
}

// UpdateCourierTeamName renames a team.
func UpdateCourierTeamName(ctx context.Context, pool *pgxpool.Pool, teamID, name string) error {
	if name == "" {
		return &CourierTeamError{"BAD_INPUT", "Team name is required"}
	}
	tag, err := pool.Exec(ctx, `UPDATE courier_team SET name = $1 WHERE id = $2`, name, teamID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &CourierTeamError{"NOT_FOUND", "That team was not found"}
	}
	return nil
}

// CourierTeamMemberUpdate is what changed about an existing member —
// name, phone, and/or role, whichever a staffer corrected. All three
// are required on every call (the caller resends the full row, same
// "overwrite, not merge" contract AttachParcelLabelInfo already
// follows) since a UI form naturally has every field in front of it
// already; there's no scenario where only one is known but not the
// others the way there is for a field-collected label note.
type CourierTeamMemberUpdate struct {
	Name   string
	Msisdn string
	Role   string
}

// UpdateCourierTeamMember corrects a roster entry — a typo'd name, the
// wrong number entered, or a role that's changed — and texts the
// member the same way AddCourierTeamMember's own caller does (see
// notify.CourierTeamMemberUpdated), since a changed phone number in
// particular is exactly the kind of thing someone needs to actually
// see land on their phone to trust it's right. Changing the phone
// number moves the *same* Person row to a new msisdn rather than
// creating a second one — refuses if that number already belongs to
// someone else, the same conflict a fresh sign-up would hit.
func UpdateCourierTeamMember(ctx context.Context, pool *pgxpool.Pool, teamID, partyID string, in CourierTeamMemberUpdate) (esokoID string, err error) {
	if in.Name == "" || in.Msisdn == "" {
		return "", &CourierTeamError{"BAD_INPUT", "Name and phone number are required"}
	}
	var exists bool
	if qerr := pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM courier_team_member WHERE "teamId" = $1 AND "partyId" = $2)`,
		teamID, partyID).Scan(&exists); qerr != nil {
		return "", qerr
	}
	if !exists {
		return "", &CourierTeamError{"NOT_FOUND", "That team member was not found"}
	}

	var conflictingParty string
	cerr := pool.QueryRow(ctx, `SELECT "partyId" FROM person WHERE msisdn = $1 AND "partyId" != $2`, in.Msisdn, partyID).Scan(&conflictingParty)
	if cerr == nil {
		return "", &CourierTeamError{"BAD_INPUT", "That phone number belongs to a different Esoko account already"}
	}
	if !errors.Is(cerr, pgx.ErrNoRows) {
		return "", cerr
	}

	if _, uerr := pool.Exec(ctx, `UPDATE person SET "officialName" = $1, msisdn = $2 WHERE "partyId" = $3`, in.Name, in.Msisdn, partyID); uerr != nil {
		return "", uerr
	}
	role := in.Role
	if role == "" {
		role = "MEMBER"
	}
	if _, rerr := pool.Exec(ctx, `UPDATE courier_team_member SET role = $1 WHERE "teamId" = $2 AND "partyId" = $3`, role, teamID, partyID); rerr != nil {
		return "", rerr
	}
	esokoID, err = EnsureEsokoPaymentId(ctx, pool, partyID, in.Msisdn)
	if err != nil {
		return "", err
	}
	return esokoID, nil
}

// AddCourierFleet adds another vehicle to a team's roster.
func AddCourierFleet(ctx context.Context, pool *pgxpool.Pool, teamID, fleetNumber, vehicleType string) (fleetID string, err error) {
	if fleetNumber == "" {
		return "", &CourierTeamError{"BAD_INPUT", "A fleet number is required"}
	}
	if !validVehicleTypes[vehicleType] {
		return "", &CourierTeamError{"BAD_INPUT", "Choose a valid vehicle type"}
	}
	var exists bool
	if qerr := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM courier_team WHERE id = $1)`, teamID).Scan(&exists); qerr != nil {
		return "", qerr
	}
	if !exists {
		return "", &CourierTeamError{"NOT_FOUND", "That team was not found"}
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO courier_fleet (id, "teamId", "fleetNumber", "vehicleType", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3::"ParcelTransportMode", now()) RETURNING id`,
		teamID, fleetNumber, vehicleType).Scan(&fleetID)
	if err != nil {
		if isUniqueViolation(err) {
			return "", &CourierTeamError{"BAD_INPUT", "That fleet number is already in use"}
		}
		return "", err
	}
	return fleetID, nil
}

// CourierTeamRow — one line on the admin teams list: roster/fleet
// counts, computed rather than stored, same "don't track what you can
// compute" philosophy GetAdminParcelStats already follows.
type CourierTeamRow struct {
	ID          string
	Name        string
	ManagerName *string
	MemberCount int
	FleetCount  int
	CreatedAt   time.Time
}

func ListCourierTeams(ctx context.Context, pool *pgxpool.Pool) ([]CourierTeamRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT t.id, t.name, mgr_name.name, member_count.n, fleet_count.n, t."createdAt"
		FROM courier_team t
		LEFT JOIN LATERAL (
			SELECT COALESCE(pr."knownAs", pr."officialName") AS name
			FROM courier_team_member m
			JOIN person pr ON pr."partyId" = m."partyId"
			WHERE m."teamId" = t.id AND m.role = 'MANAGER'
			ORDER BY m."addedAt" LIMIT 1
		) mgr_name ON true
		LEFT JOIN LATERAL (SELECT count(*) AS n FROM courier_team_member WHERE "teamId" = t.id) member_count ON true
		LEFT JOIN LATERAL (SELECT count(*) AS n FROM courier_fleet WHERE "teamId" = t.id) fleet_count ON true
		ORDER BY t."createdAt" DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CourierTeamRow
	for rows.Next() {
		var r CourierTeamRow
		if err := rows.Scan(&r.ID, &r.Name, &r.ManagerName, &r.MemberCount, &r.FleetCount, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CourierTeamMemberRow/CourierFleetRow/CourierTripRow — the detail
// view's own roster/fleet/trip lists.
type CourierTeamMemberRow struct {
	PartyID string
	Name    string
	Msisdn  *string
	Role    string
	AddedAt time.Time
}

type CourierFleetRow struct {
	ID           string
	FleetNumber  string
	VehicleType  string
	OpenTripID   *string
	AssignedOpen int // parcels currently on the fleet's open trip, if any
}

func GetCourierTeamDetail(ctx context.Context, pool *pgxpool.Pool, teamID string) (name string, members []CourierTeamMemberRow, fleets []CourierFleetRow, err error) {
	if qerr := pool.QueryRow(ctx, `SELECT name FROM courier_team WHERE id = $1`, teamID).Scan(&name); qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return "", nil, nil, nil
		}
		return "", nil, nil, qerr
	}

	mrows, merr := pool.Query(ctx, `
		SELECT m."partyId", COALESCE(pr."knownAs", pr."officialName"), pr.msisdn, m.role, m."addedAt"
		FROM courier_team_member m JOIN person pr ON pr."partyId" = m."partyId"
		WHERE m."teamId" = $1 ORDER BY m.role = 'MANAGER' DESC, m."addedAt"`, teamID)
	if merr != nil {
		return "", nil, nil, merr
	}
	defer mrows.Close()
	for mrows.Next() {
		var r CourierTeamMemberRow
		if serr := mrows.Scan(&r.PartyID, &r.Name, &r.Msisdn, &r.Role, &r.AddedAt); serr != nil {
			return "", nil, nil, serr
		}
		members = append(members, r)
	}
	if merr := mrows.Err(); merr != nil {
		return "", nil, nil, merr
	}

	frows, ferr := pool.Query(ctx, `
		SELECT f.id, f."fleetNumber", f."vehicleType"::text,
		       ot.id, COALESCE(assigned.n, 0)
		FROM courier_fleet f
		LEFT JOIN courier_trip ot ON ot."fleetId" = f.id AND ot.status = 'IN_PROGRESS'
		LEFT JOIN LATERAL (SELECT count(*) AS n FROM parcel WHERE "courierTripId" = ot.id) assigned ON true
		WHERE f."teamId" = $1 ORDER BY f."createdAt"`, teamID)
	if ferr != nil {
		return "", nil, nil, ferr
	}
	defer frows.Close()
	for frows.Next() {
		var r CourierFleetRow
		if serr := frows.Scan(&r.ID, &r.FleetNumber, &r.VehicleType, &r.OpenTripID, &r.AssignedOpen); serr != nil {
			return "", nil, nil, serr
		}
		fleets = append(fleets, r)
	}
	return name, members, fleets, frows.Err()
}

// AssignParcelsToFleet lands each of [codes] on [fleetID]'s currently
// open trip, opening a fresh one first if none is — see CourierTrip's
// own comment. Skips (doesn't error on) a code that's already on this
// same trip, already DELIVERED/CANCELLED, or simply doesn't exist,
// returning which codes actually landed so the caller can report any
// silently-skipped ones.
func AssignParcelsToFleet(ctx context.Context, pool *pgxpool.Pool, fleetID string, codes []string) (tripID string, assigned []string, err error) {
	var exists bool
	if qerr := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM courier_fleet WHERE id = $1)`, fleetID).Scan(&exists); qerr != nil {
		return "", nil, qerr
	}
	if !exists {
		return "", nil, &CourierTeamError{"NOT_FOUND", "That fleet was not found"}
	}

	err = pool.QueryRow(ctx, `SELECT id FROM courier_trip WHERE "fleetId" = $1 AND status = 'IN_PROGRESS'`, fleetID).Scan(&tripID)
	if errors.Is(err, pgx.ErrNoRows) {
		if ierr := pool.QueryRow(ctx, `
			INSERT INTO courier_trip (id, "fleetId", status, "startedAt")
			VALUES (gen_random_uuid(), $1, 'IN_PROGRESS', now()) RETURNING id`, fleetID).Scan(&tripID); ierr != nil {
			return "", nil, ierr
		}
	} else if err != nil {
		return "", nil, err
	}

	for _, code := range codes {
		tag, uerr := pool.Exec(ctx, `
			UPDATE parcel SET "courierTripId" = $1
			WHERE code = $2 AND status NOT IN ('DELIVERED', 'CANCELLED')`, tripID, code)
		if uerr != nil {
			return tripID, assigned, uerr
		}
		if tag.RowsAffected() > 0 {
			assigned = append(assigned, code)
		}
	}
	return tripID, assigned, nil
}

// CourierTripCompletionInfo is what the handler needs to compose and
// send notify.CourierTripCompleted to the whole team — kept as its own
// lookup (rather than threading it through CompleteTrip's return
// values) so that stays focused on the state change, same split
// GetParcelNotifyInfo already follows for handoff/delivery.
type CourierTripCompletionInfo struct {
	FleetNumber string
	ParcelCount int
	Recipients  []CourierTeamMemberRow // every team member with a phone on file
}

// CompleteTrip marks [tripID] COMPLETE — a staffer's own action, not
// automatic (see this package's own comment on why: a fleet is "back"
// when someone on the ground says so, not the instant its last parcel
// happens to reach DELIVERED, since a trip can complete with parcels
// still short of that if one's flagged an exception). Idempotent:
// completing an already-complete trip is a no-op, not an error.
func CompleteTrip(ctx context.Context, pool *pgxpool.Pool, tripID string, staffID *string) (alreadyComplete bool, err error) {
	tag, err := pool.Exec(ctx, `
		UPDATE courier_trip SET status = 'COMPLETE', "completedAt" = now(), "completedByStaffId" = $1
		WHERE id = $2 AND status = 'IN_PROGRESS'`, staffID, tripID)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() > 0 {
		return false, nil
	}
	var exists bool
	_ = pool.QueryRow(ctx, `SELECT true FROM courier_trip WHERE id = $1`, tripID).Scan(&exists)
	if !exists {
		return false, &CourierTeamError{"NOT_FOUND", "That trip was not found"}
	}
	return true, nil // already COMPLETE — idempotent no-op
}

// GetCourierTripCompletionInfo — see CourierTripCompletionInfo's own
// comment.
func GetCourierTripCompletionInfo(ctx context.Context, pool *pgxpool.Pool, tripID string) (*CourierTripCompletionInfo, error) {
	var info CourierTripCompletionInfo
	var fleetID string
	if err := pool.QueryRow(ctx, `SELECT "fleetId" FROM courier_trip WHERE id = $1`, tripID).Scan(&fleetID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if err := pool.QueryRow(ctx, `SELECT "fleetNumber" FROM courier_fleet WHERE id = $1`, fleetID).Scan(&info.FleetNumber); err != nil {
		return nil, err
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM parcel WHERE "courierTripId" = $1`, tripID).Scan(&info.ParcelCount); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT m."partyId", COALESCE(pr."knownAs", pr."officialName"), pr.msisdn, m.role, m."addedAt"
		FROM courier_team_member m
		JOIN courier_fleet f ON f."teamId" = m."teamId"
		JOIN person pr ON pr."partyId" = m."partyId"
		WHERE f.id = $1`, fleetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r CourierTeamMemberRow
		if err := rows.Scan(&r.PartyID, &r.Name, &r.Msisdn, &r.Role, &r.AddedAt); err != nil {
			return nil, err
		}
		info.Recipients = append(info.Recipients, r)
	}
	return &info, rows.Err()
}
