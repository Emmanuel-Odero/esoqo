// Package seed (demo_parcel_teams.go) — the courier companies' teams.
//
// The parcel showcase and dispatch fleet plant stations, parcels and
// vans, but before this file a company's OWN roster was nearly empty on
// a fresh database: Demo Swift Riders got three staff out of
// ensureDemoParcelOrg, ESOQO Shippers got nothing at all (its only row,
// Kiki Viki, exists in whatever environment created the real account).
// The Team page was a one-row table — while every other screen under
// /parcel-org was fully staged. This file fills that gap.
//
// Two teams, two shapes:
//
//   - demo-swift-riders is the synthetic tour tenant. Its additions
//     reuse the existing "Demo …" people already seeded elsewhere in this
//     package (Alice, Kevin, Peter Kamau, David, Mary, Grace, Faith,
//     Sam, Brian) rather than inventing single-purpose accounts — the
//     standing rule here is one demo person, many hats.
//   - esoqo-shippers is the real company account the team demos on. Its
//     roster is the crew the dispatch fleet already names (Samuel
//     Kariuki, Peter Njoroge, … — see demo_dispatch_fleet.go): the board
//     links those runs to people actually on the books, and the Team
//     page stops being a single row. These people get their own phone
//   - PIN accounts (same "PIN = last six digits" rule as every other
//     demo login) because a rider must exist as a Person to take
//     custody of anything.
//
// Office staff (managers, dispatchers, clerks) are desk logins — no
// partyId, matching the Demo Njeri Kamau precedent in
// ensureDemoParcelOrg, so custody is never attributed to a desk row.
// Riders carry a partyId so msisdn, custody and the OTP path all
// resolve to a real person.
//
// Idempotent like its siblings: staff upsert by (orgId, lower(name)),
// stations upsert by (orgId, name), person+party+credential upsert by
// msisdn. Re-running `go run ./cmd/seed` extends, never duplicates.
// Roles are stored against authsvc.ParcelStaffCapabilitiesForRole, the
// same resolver the portal uses to answer a sign-in.
package seed

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
)

type teamStaffSpec struct {
	name      string
	role      string
	pin       string // portal PIN; "" = unprintable placeholder (never used here)
	msisdn    string // person to link, "" = office-only login
	station   string // station name on this org, "" = no post
	isContact bool
}

type teamOrgSpec struct {
	slug     string
	stations []stationDef
	staff    []teamStaffSpec
}

// swiftTeamOrg and eshipTeamOrg — the two dev tenants. Stations are
// declared here (not relied on from showcase/fleet) so a run ordering
// that puts teams first on a fresh database still resolves every
// stationId. A production push reuses eshipTeamOrg's roster unchanged,
// pointed at the SEED_PROD_ORG account instead of needing to invent a
// second company for it.
var swiftTeamOrg = teamOrgSpec{
	slug: "demo-swift-riders",
	stations: []stationDef{
		{"Demo Swift Riders – Kilimani Hub", "+254700500030", "Woodvale Grove, Kilimani — ground floor", -1.2921, 36.7872, 100},
		{"Demo Swift Riders – Ngara Counter", "+254700500031", "Fig Tree Market, Ngara — bay 2", -1.2762, 36.8236, 60},
	},
	staff: []teamStaffSpec{
		// Riders first — existing demo people, added onto a second
		// company's books like a real rider joining a second firm.
		{name: "Demo Peter Mwangi", role: "RIDER", pin: "500022", msisdn: "+254700500022", station: "Demo Swift Riders – Kilimani Hub"},
		{name: "Demo Susan Wanjala", role: "DISPATCHER", pin: "500023", msisdn: "+254700500023", station: "Demo Swift Riders – Ngara Counter"},
		{name: "Demo Alice Nduta", role: "RIDER", pin: "500011", msisdn: "+254700500011", station: "Demo Swift Riders – Kilimani Hub"},
		{name: "Demo Kevin Otieno", role: "RIDER", pin: "500008", msisdn: "+254700500008", station: "Demo Swift Riders – Ngara Counter"},
		{name: "Demo Peter Kamau", role: "RIDER", pin: "500004", msisdn: "+254700500004", station: "Demo Swift Riders – Kilimani Hub"},
		{name: "Demo David Kiprop", role: "RIDER", pin: "500016", msisdn: "+254700500016", station: "Demo Swift Riders – Ngara Counter"},
		// Desk roles spread across the two stations.
		{name: "Demo Njeri Kamau", role: "MANAGER", pin: "500024", station: "Demo Swift Riders – Kilimani Hub", isContact: true},
		{name: "Demo Brian Kimutai", role: "DISPATCHER", pin: "500018", msisdn: "+254700500018", station: "Demo Swift Riders – Kilimani Hub"},
		{name: "Demo Mary Chebet", role: "INTAKE_CLERK", pin: "500007", msisdn: "+254700500007", station: "Demo Swift Riders – Kilimani Hub"},
		{name: "Demo Grace Wairimu", role: "ARRIVAL_CLERK", pin: "500015", msisdn: "+254700500015", station: "Demo Swift Riders – Ngara Counter"},
		{name: "Demo Faith Njeri", role: "COLLECTION_CLERK", pin: "500003", msisdn: "+254700500003", station: "Demo Swift Riders – Kilimani Hub"},
		{name: "Demo Sam Kiprotich", role: "STATION_MANAGER", pin: "500012", msisdn: "+254700500012", station: "Demo Swift Riders – Ngara Counter", isContact: true},
	},
}

// eshipTeamOrg — the ESOQO-family roster (riders + desk roles) used both
// for the dev esoqo-shippers tenant and, pointed at the production
// account, for the live push.
var eshipTeamOrg = teamOrgSpec{
	slug: "esoqo-shippers",
	stations: []stationDef{
		{"ESOQO Shippers – Kabiria Hub", "+254728387694", "Kabiria Cabby Centre — ground floor", -1.3121, 36.7446, 100},
		{"ESOQO Shippers – CBD Counter", "+254728387694", "CBD — Tom Mboya St, Odeon side", -1.2833, 36.8167, 60},
		{"ESOQO Shippers – Nakuru Hub", "+254728387694", "Nakuru town — Kenyatta Ave, next to the main stage", -0.3031, 36.0800, 120},
		{"ESOQO Shippers – Thika Counter", "+254728387694", "Thika town — Commercial St, near the stage", -1.0332, 37.0693, 60},
	},
	staff: []teamStaffSpec{
		// The dispatch fleet's own crew — every staffName in
		// demo_dispatch_fleet.go resolves to one of these rows, so
		// the board shows crew "on the books" instead of free text.
		{name: "Samuel Kariuki", role: "RIDER", pin: "114401", msisdn: "+254722114401", station: "ESOQO Shippers – Kabiria Hub"},
		{name: "Peter Njoroge", role: "RIDER", pin: "114402", msisdn: "+254722114402", station: "ESOQO Shippers – Kabiria Hub"},
		{name: "Mary Wambui", role: "RIDER", pin: "114403", msisdn: "+254722114403", station: "ESOQO Shippers – Kabiria Hub"},
		{name: "John Kiprop", role: "RIDER", pin: "114404", msisdn: "+254722114404", station: "ESOQO Shippers – Kabiria Hub"},
		{name: "Grace Achieng", role: "RIDER", pin: "114405", msisdn: "+254722114405", station: "ESOQO Shippers – CBD Counter"},
		{name: "Daniel Mutua", role: "RIDER", pin: "114406", msisdn: "+254722114406", station: "ESOQO Shippers – CBD Counter"},
		{name: "Faith Nyambura", role: "RIDER", pin: "114407", msisdn: "+254722114407", station: "ESOQO Shippers – CBD Counter"},
		{name: "Kevin Barasa", role: "RIDER", pin: "114408", msisdn: "+254722114408", station: "ESOQO Shippers – Kabiria Hub"},
		{name: "Alice Moraa", role: "RIDER", pin: "114409", msisdn: "+254722114409", station: "ESOQO Shippers – Nakuru Hub"},
		{name: "Tom Ochieng", role: "RIDER", pin: "114410", msisdn: "+254722114410", station: "ESOQO Shippers – Nakuru Hub"},
		{name: "Brian Kimani", role: "RIDER", pin: "114411", msisdn: "+254722114411", station: "ESOQO Shippers – Thika Counter"},
		{name: "Susan Njoki", role: "RIDER", pin: "114412", msisdn: "+254722114412", station: "ESOQO Shippers – Thika Counter"},
		{name: "Dennis Kibet", role: "RIDER", pin: "114413", msisdn: "+254722114413", station: "ESOQO Shippers – Kabiria Hub"},
		{name: "Ann Wanjiru", role: "RIDER", pin: "114414", msisdn: "+254722114414", station: "ESOQO Shippers – Thika Counter"},
		{name: "George Kamau", role: "RIDER", pin: "114415", msisdn: "+254722114415", station: "ESOQO Shippers – Kabiria Hub"},
		{name: "Irene Nyakundi", role: "RIDER", pin: "114416", msisdn: "+254722114416", station: "ESOQO Shippers – CBD Counter"},
		{name: "Paul Mwangi", role: "RIDER", pin: "114417", msisdn: "+254722114417", station: "ESOQO Shippers – CBD Counter"},
		{name: "Stephen Ouma", role: "RIDER", pin: "114418", msisdn: "+254722114418", station: "ESOQO Shippers – Thika Counter"},
		// Desk roles: a manager, dispatch coordinators at each hub,
		// and the station managers/clerk seats each counter needs.
		{name: "Wambui Njoroge", role: "DISPATCHER", pin: "610011", station: "ESOQO Shippers – Kabiria Hub"},
		{name: "Brian Kipsang", role: "DISPATCHER", pin: "610021", station: "ESOQO Shippers – Nakuru Hub"},
		{name: "Gitau Kamande", role: "STATION_MANAGER", pin: "610014", station: "ESOQO Shippers – Kabiria Hub", isContact: true},
		{name: "Hellen Wairimu", role: "STATION_MANAGER", pin: "610015", station: "ESOQO Shippers – CBD Counter", isContact: true},
		{name: "Collins Mburu", role: "STATION_MANAGER", pin: "610016", station: "ESOQO Shippers – Nakuru Hub", isContact: true},
		{name: "Frank Odhiambo", role: "INTAKE_CLERK", pin: "610012", station: "ESOQO Shippers – Kabiria Hub"},
		{name: "Agnes Chebet", role: "INTAKE_CLERK", pin: "610017", station: "ESOQO Shippers – Nakuru Hub"},
		{name: "David Otieno", role: "INTAKE_CLERK", pin: "610018", station: "ESOQO Shippers – Thika Counter"},
		{name: "Mercy Wanjiku", role: "ARRIVAL_CLERK", pin: "610013", station: "ESOQO Shippers – CBD Counter"},
		{name: "Ruth Akinyi", role: "ARRIVAL_CLERK", pin: "610019", station: "ESOQO Shippers – Thika Counter"},
		{name: "Sylvia Muthoni", role: "COLLECTION_CLERK", pin: "610020", station: "ESOQO Shippers – CBD Counter"},
	},
}

// teamOrgs resolves which tenants this run seeds: the two dev orgs, or,
// for a production push (SEED_PROD_ORG), the ESOQO roster pointed at the
// tagged account — never inventing a new company on a live database.
func teamOrgs() []teamOrgSpec {
	if IsProdSeed() {
		return []teamOrgSpec{{slug: OrgSlug("esoqo-shippers"), stations: eshipTeamOrg.stations, staff: eshipTeamOrg.staff}}
	}
	return []teamOrgSpec{swiftTeamOrg, eshipTeamOrg}
}

// SeedDemoParcelTeams plants the full roster for both parcel-org
// tenants — or, when SEED_PROD_ORG is set, the ESOQO roster onto that
// single production account. Call after SeedDemoUnifiedIdentity (swift's
// org + first three staff come from there) and before
// SeedDemoDispatchFleet (whose crew links read these rows). Safe to
// re-run.
func SeedDemoParcelTeams(ctx context.Context, pool *pgxpool.Pool) error {
	orgs := teamOrgs()
	total := 0
	for _, org := range orgs {
		var orgID string
		if err := pool.QueryRow(ctx, `SELECT id FROM parcel_org WHERE slug = $1`, org.slug).Scan(&orgID); err != nil {
			return fmt.Errorf("%s org: %w", org.slug, err)
		}
		stationIDByName, err := ensureTeamStations(ctx, pool, orgID, org.stations)
		if err != nil {
			return fmt.Errorf("%s stations: %w", org.slug, err)
		}
		for _, s := range org.staff {
			partyID := nullableStr(s.msisdn)
			if s.msisdn != "" {
				id, err := EnsurePersonParty(ctx, pool, s.msisdn, s.name, s.name, "047", s.pin)
				if err != nil {
					return fmt.Errorf("%s person %s: %w", org.slug, s.name, err)
				}
				partyID = &id
			}
			hash, err := authsvc.HashPin(s.pin)
			if err != nil {
				return fmt.Errorf("%s pin %s: %w", org.slug, s.name, err)
			}
			caps := authsvc.ParcelStaffCapabilitiesForRole(s.role, nil)
			isContact := s.isContact
			stationID := nullableStr(stationIDByName[s.station])
			if err := upsertTeamStaff(ctx, pool, orgID, s.name, s.role, hash, partyID, stationID, isContact, caps); err != nil {
				return fmt.Errorf("%s staff %s: %w", org.slug, s.name, err)
			}
			total++
		}
		fmt.Printf("  parcel teams: %s (%d staff)\n", org.slug, len(org.staff))
	}
	fmt.Printf("  parcel teams: %d staff rows total — riders sign in by phone+PIN (last six digits); desk roles by name+PIN at /parcel-org\n", total)
	return nil
}

// ensureTeamStations upserts the org's own station set so a run ordering
// that seeds teams before showcase/fleet still resolves every stationId.
func ensureTeamStations(ctx context.Context, pool *pgxpool.Pool, orgID string, defs []stationDef) (map[string]string, error) {
	out := map[string]string{}
	for _, st := range defs {
		var id string
		err := pool.QueryRow(ctx, `SELECT id FROM parcel_agent WHERE "parcelOrgId" = $1 AND name = $2`, orgID, st.name).Scan(&id)
		if err != nil {
			err = pool.QueryRow(ctx, `INSERT INTO parcel_agent (id, name, msisdn, "locationHint", lat, lng, capacity, active, "parcelOrgId", "createdAt")
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, $7, now()) RETURNING id`,
				st.name, st.msisdn, st.hint, st.lat, st.lng, st.capacity, orgID).Scan(&id)
			if err != nil {
				return nil, err
			}
		}
		out[st.name] = id
	}
	return out, nil
}

// upsertTeamStaff mirrors dbx.UpsertParcelOrgStaff's upsert semantics
// (matched on (orgId, lower(name)) like ensureDemoParcelOrg) so a seed
// run extends the roster rather than failing on a duplicate name. The
// DAL variant requires an authorised Ctx — a seed has none, and a seed
// script is exactly the "migrations, workers and seeds only" case
// authsvc.SystemCtx documents, so the raw upsert lives here instead.
func upsertTeamStaff(ctx context.Context, pool *pgxpool.Pool, orgID, name, role, pinHash string, partyID *string, stationID *string, isContact bool, capabilities []string) error {
	var existing string
	err := pool.QueryRow(ctx, `
		SELECT id FROM parcel_org_staff WHERE "orgId" = $1 AND lower(name) = lower($2)`,
		orgID, name).Scan(&existing)
	if err == nil {
		_, err := pool.Exec(ctx, `
			UPDATE parcel_org_staff SET role = $1, active = true, "isContact" = $2, "partyId" = $3,
			       "stationId" = $4, capabilities = $5, "pinHash" = $6, "updatedAt" = now()
			WHERE id = $7`, role, isContact, partyID, stationID, capabilities, pinHash, existing)
		return err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO parcel_org_staff (id, "orgId", name, "pinHash", role, active, "isContact", "partyId", "stationId", capabilities, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5, $6, $7, $8, now(), now())`,
		orgID, name, pinHash, role, isContact, partyID, stationID, capabilities)
	return err
}
