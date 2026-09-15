// Package seed (demo_unified_identity.go) — local dev/demo accounts for
// the unified-crew-identity model (docs/proposals/
// esoqo-unified-crew-identity.md). There is no self-serve sign-up screen
// in the mobile app (OTP auto-provisions on first verify, but that needs
// a real SMS round trip) — these 20 accounts exist so a phone/PIN sign-in
// works immediately for local testing, covering every role shape the
// design introduced: plain subject, company owner (several company
// types), org-scoped staff grants (SCANNER/MANAGER/ADMIN/CREW) including
// a suspended one and an unlinked-crew one, cross-tenant isolation
// between two transport companies, and one person holding two hats at
// once (their own store *and* a CREW grant elsewhere) — the exact
// scenario the whole redesign was for. Every name is prefixed "Demo".
package seed

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// ensureOrgStaffGrant seeds directly into org_staff_grant rather than
// going through dbx.CreateOrgStaffGrant, which requires an authorised
// Ctx — there is no signed-in actor at seed time, and a seed script is
// exactly the "migrations, workers and seeds only" case authsvc.SystemCtx
// documents, so bypassing the capability check here (not the DAL's
// enforcement in general) is the intended escape hatch.
func ensureOrgStaffGrant(ctx context.Context, pool *pgxpool.Pool, orgID, partyID, role, status, grantedBy string, crewMemberID *string) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO org_staff_grant ("orgId", "partyId", role, status, "grantedBy", "crewMemberId", "updatedAt")
		VALUES ($1, $2, $3, $4, $5, $6, now())
		ON CONFLICT ("orgId", "partyId") DO UPDATE SET
			role = $3, status = $4, "crewMemberId" = $6, "updatedAt" = now()`,
		orgID, partyID, role, status, grantedBy, crewMemberID)
	return err
}

func ensureCrewMemberSeed(ctx context.Context, pool *pgxpool.Pool, orgID, name, role, msisdn string) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `SELECT id FROM crew_member WHERE "orgId" = $1 AND name = $2`, orgID, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO crew_member (id, "orgId", name, msisdn, role, active, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4::"CrewRole", true, now(), now())
		RETURNING id`, orgID, name, msisdn, role).Scan(&id)
	return id, err
}

// ensureDemoGroup is the idempotent wrapper around dbx.CreateOwnGroup
// this file's own "rerunning never duplicates" promise needed and did
// not have. CreateOwnGroup mints a fresh Organisation every call —
// correct for the real endpoint (two chamas may legitimately share a
// name), wrong for a seed, which had been quietly giving Faith a
// brand-new "Demo Kilimani Women Chama" on every run. Five reruns left
// her a member of five identically-named groups, which is what the
// mobile Chama hub's balance hero then had to add up.
//
// Matched on founder + official name rather than name alone, so this
// can never adopt a group some other demo person founded.
func ensureDemoGroup(ctx context.Context, pool *pgxpool.Pool, founderPartyID, orgKind, officialName, knownAs, county string) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		SELECT o."partyId" FROM organisation o
		JOIN membership m ON m."orgId" = o."partyId" AND m."personId" = $1 AND m."exitedAt" IS NULL
		WHERE o."officialName" = $2
		ORDER BY m."joinedAt" ASC
		LIMIT 1`, founderPartyID, officialName).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	return dbx.CreateOwnGroup(ctx, pool, founderPartyID, orgKind, officialName, knownAs, county)
}

// DemoAccount is one row of the credentials table SeedDemoUnifiedIdentity
// prints — msisdn + PIN is everything `POST /v1/auth/sign-in` needs.
type DemoAccount struct {
	Msisdn, Pin, Name, Description string
}

// SeedDemoUnifiedIdentity plants 20 phone+PIN accounts spanning every
// shape the unified-crew-identity design introduced. Idempotent —
// EnsurePersonParty/ensureOrgStaffGrant all upsert, so rerunning
// `go run ./cmd/seed` never duplicates.
func SeedDemoUnifiedIdentity(ctx context.Context, pool *pgxpool.Pool) ([]DemoAccount, error) {
	var accounts []DemoAccount
	add := func(msisdn, pin, name, desc string) {
		accounts = append(accounts, DemoAccount{msisdn, pin, name, desc})
	}

	person := func(msisdn, name, pin string) (string, error) {
		return EnsurePersonParty(ctx, pool, msisdn, name, name, "047", pin)
	}

	// ── 1–2: store owners, two different retail businesses ───────────
	amina, err := person("+254700500001", "Demo Amina Wanjiru", "500001")
	if err != nil {
		return nil, fmt.Errorf("amina: %w", err)
	}
	aminaEnt, err := EnsureEnterprise(ctx, pool, amina, "retail-grocery")
	if err != nil {
		return nil, fmt.Errorf("amina enterprise: %w", err)
	}
	if _, err := ensureStore(ctx, pool, aminaEnt, demoStore{
		name: "Demo Amina's Grocers", slug: "demo-aminas-grocers", tagline: "Fresh produce, fair prices",
		primaryCategory: "Groceries", neighborhood: "Kilimani", lat: -1.2921, lng: 36.7872,
		codEnabled: true, products: freshmartCatalog[:5],
	}); err != nil {
		return nil, fmt.Errorf("amina store: %w", err)
	}
	add("+254700500001", "500001", "Demo Amina Wanjiru", "Store owner — Demo Amina's Grocers (groceries)")

	brian, err := person("+254700500002", "Demo Brian Otieno", "500002")
	if err != nil {
		return nil, fmt.Errorf("brian: %w", err)
	}
	brianEnt, err := EnsureEnterprise(ctx, pool, brian, "retail-electronics")
	if err != nil {
		return nil, fmt.Errorf("brian enterprise: %w", err)
	}
	if _, err := ensureStore(ctx, pool, brianEnt, demoStore{
		name: "Demo Brian's Electronics", slug: "demo-brians-electronics", tagline: "Phones, accessories, repairs",
		primaryCategory: "Electronics", neighborhood: "CBD", lat: -1.2833, lng: 36.8167,
		codEnabled: true, products: []demoProduct{
			{"Phone charger, USB-C", "Electronics", "pc", 450, intPtr(60), false},
			{"Earphones, wired", "Electronics", "pc", 300, intPtr(90), false},
		},
	}); err != nil {
		return nil, fmt.Errorf("brian store: %w", err)
	}
	add("+254700500002", "500002", "Demo Brian Otieno", "Store owner — Demo Brian's Electronics")

	// ── 3–4: a chama — treasurer (chairperson-by-founding) + member ──
	faith, err := person("+254700500003", "Demo Faith Njeri", "500003")
	if err != nil {
		return nil, fmt.Errorf("faith: %w", err)
	}
	chamaID, err := ensureDemoGroup(ctx, pool, faith, "CHAMA", "Demo Kilimani Women Chama", "Kilimani Chama", "047")
	if err != nil {
		return nil, fmt.Errorf("chama: %w", err)
	}
	add("+254700500003", "500003", "Demo Faith Njeri", "Group treasurer/chairperson — Demo Kilimani Women Chama")

	peter, err := person("+254700500004", "Demo Peter Kamau", "500004")
	if err != nil {
		return nil, fmt.Errorf("peter: %w", err)
	}
	if _, err := dbx.JoinGroup(ctx, pool, peter, chamaID); err != nil && err != dbx.ErrAlreadyMember {
		return nil, fmt.Errorf("peter join chama: %w", err)
	}
	add("+254700500004", "500004", "Demo Peter Kamau", "Group member — Demo Kilimani Women Chama")

	// ── 5: a second chama, different treasurer (tenant variety) ──────
	winnie, err := person("+254700500019", "Demo Winnie Achola", "500019")
	if err != nil {
		return nil, fmt.Errorf("winnie: %w", err)
	}
	if _, err := ensureDemoGroup(ctx, pool, winnie, "SACCO", "Demo Umoja Boda SACCO", "Umoja Boda", "047"); err != nil {
		return nil, fmt.Errorf("umoja sacco: %w", err)
	}
	add("+254700500019", "500019", "Demo Winnie Achola", "Group treasurer/chairperson — Demo Umoja Boda SACCO")

	// ── 6–7: two ticketing companies (events + two transport SACCOs) ─
	susan, err := person("+254700500005", "Demo Susan Achieng", "500005")
	if err != nil {
		return nil, fmt.Errorf("susan: %w", err)
	}
	susanEnt, err := EnsureEnterprise(ctx, pool, susan, "events")
	if err != nil {
		return nil, fmt.Errorf("susan enterprise: %w", err)
	}
	eventsOrgID, err := ensureTicketOrg(ctx, pool, susanEnt, "Demo Nairobi Live Events", "demo-nairobi-live-events", "EVENTS", "+254700500005")
	if err != nil {
		return nil, fmt.Errorf("events org: %w", err)
	}
	add("+254700500005", "500005", "Demo Susan Achieng", "Company owner — Demo Nairobi Live Events (events)")

	james, err := person("+254700500006", "Demo James Mwangi", "500006")
	if err != nil {
		return nil, fmt.Errorf("james: %w", err)
	}
	jamesEnt, err := EnsureEnterprise(ctx, pool, james, "transport-metro")
	if err != nil {
		return nil, fmt.Errorf("james enterprise: %w", err)
	}
	metroOrgID, err := ensureTicketOrg(ctx, pool, jamesEnt, "Demo Metro Coach SACCO", "demo-metro-coach", "TRANSPORT", "+254700500006")
	if err != nil {
		return nil, fmt.Errorf("metro org: %w", err)
	}
	add("+254700500006", "500006", "Demo James Mwangi", "Company owner — Demo Metro Coach SACCO (transport)")

	mary, err := person("+254700500007", "Demo Mary Chebet", "500007")
	if err != nil {
		return nil, fmt.Errorf("mary: %w", err)
	}
	maryEnt, err := EnsureEnterprise(ctx, pool, mary, "transport-highway")
	if err != nil {
		return nil, fmt.Errorf("mary enterprise: %w", err)
	}
	highwayOrgID, err := ensureTicketOrg(ctx, pool, maryEnt, "Demo Highway Express", "demo-highway-express", "TRANSPORT", "+254700500007")
	if err != nil {
		return nil, fmt.Errorf("highway org: %w", err)
	}
	add("+254700500007", "500007", "Demo Mary Chebet", "Company owner — Demo Highway Express (transport, separate tenant from Metro Coach)")

	// ── 8–13: Metro Coach's staff roster — every org-staff-grant role,
	// plus a suspended one and an unlinked-crew one, both deliberately
	// left in that state to demo suspend/reinstate and the
	// fail-closed-without-a-link behaviour respectively.
	kevin, err := person("+254700500008", "Demo Kevin Otieno", "500008")
	if err != nil {
		return nil, fmt.Errorf("kevin: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, metroOrgID, kevin, "SCANNER", "active", james, nil); err != nil {
		return nil, fmt.Errorf("kevin grant: %w", err)
	}
	add("+254700500008", "500008", "Demo Kevin Otieno", "Metro Coach staff — SCANNER (org-staff-grant, active)")

	linda, err := person("+254700500009", "Demo Linda Wambui", "500009")
	if err != nil {
		return nil, fmt.Errorf("linda: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, metroOrgID, linda, "MANAGER", "active", james, nil); err != nil {
		return nil, fmt.Errorf("linda grant: %w", err)
	}
	add("+254700500009", "500009", "Demo Linda Wambui", "Metro Coach staff — MANAGER (org-staff-grant, active)")

	tom, err := person("+254700500010", "Demo Tom Kiptoo", "500010")
	if err != nil {
		return nil, fmt.Errorf("tom: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, metroOrgID, tom, "ADMIN", "active", james, nil); err != nil {
		return nil, fmt.Errorf("tom grant: %w", err)
	}
	add("+254700500010", "500010", "Demo Tom Kiptoo", "Metro Coach staff — ADMIN (org-staff-grant, active)")

	aliceCrewMemberID, err := ensureCrewMemberSeed(ctx, pool, metroOrgID, "Demo Alice Nduta (crew record)", "CONDUCTOR", "+254700500011")
	if err != nil {
		return nil, fmt.Errorf("alice crew member: %w", err)
	}
	alice, err := person("+254700500011", "Demo Alice Nduta", "500011")
	if err != nil {
		return nil, fmt.Errorf("alice: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, metroOrgID, alice, "CREW", "active", james, &aliceCrewMemberID); err != nil {
		return nil, fmt.Errorf("alice grant: %w", err)
	}
	add("+254700500011", "500011", "Demo Alice Nduta", "Metro Coach staff — CREW, linked to a CrewMember (can declare cash AND close a trip)")

	sam, err := person("+254700500012", "Demo Sam Kiprotich", "500012")
	if err != nil {
		return nil, fmt.Errorf("sam: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, metroOrgID, sam, "SCANNER", "suspended", james, nil); err != nil {
		return nil, fmt.Errorf("sam grant: %w", err)
	}
	add("+254700500012", "500012", "Demo Sam Kiprotich", "Metro Coach staff — SCANNER, SUSPENDED (sign-in works; activating/switching duty is denied — demo the suspend/reinstate screen with this one)")

	peterOtieno, err := person("+254700500020", "Demo Peter Otieno", "500020")
	if err != nil {
		return nil, fmt.Errorf("peter otieno: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, metroOrgID, peterOtieno, "CREW", "active", james, nil); err != nil {
		return nil, fmt.Errorf("peter otieno grant: %w", err)
	}
	add("+254700500020", "500020", "Demo Peter Otieno", "Metro Coach staff — CREW, NOT linked to a CrewMember (can declare cash, fails closed on close-trip — see dbx.crewOwnsTrip)")

	// ── 14–15: Highway Express's own roster — proves tenant isolation:
	// Nancy's grant only ever layers Metro Coach capabilities when she
	// activates *Highway Express*'s context, never the other way round.
	nancy, err := person("+254700500013", "Demo Nancy Adhiambo", "500013")
	if err != nil {
		return nil, fmt.Errorf("nancy: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, highwayOrgID, nancy, "SCANNER", "active", mary, nil); err != nil {
		return nil, fmt.Errorf("nancy grant: %w", err)
	}
	add("+254700500013", "500013", "Demo Nancy Adhiambo", "Highway Express staff — SCANNER (separate tenant from Metro Coach — cross-org isolation demo)")

	// ── 16–17: Nairobi Live Events' own roster ────────────────────────
	ochieng, err := person("+254700500014", "Demo Ochieng Barasa", "500014")
	if err != nil {
		return nil, fmt.Errorf("ochieng: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, eventsOrgID, ochieng, "SCANNER", "active", susan, nil); err != nil {
		return nil, fmt.Errorf("ochieng grant: %w", err)
	}
	add("+254700500014", "500014", "Demo Ochieng Barasa", "Nairobi Live Events staff — SCANNER (gate check-in)")

	graceW, err := person("+254700500015", "Demo Grace Wairimu", "500015")
	if err != nil {
		return nil, fmt.Errorf("grace w: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, eventsOrgID, graceW, "ADMIN", "active", susan, nil); err != nil {
		return nil, fmt.Errorf("grace w grant: %w", err)
	}
	add("+254700500015", "500015", "Demo Grace Wairimu", "Nairobi Live Events staff — ADMIN")

	// ── 18: the dual-hat account — the whole point of the redesign.
	// Signs in once, sees their own store as owner, AND can switch on
	// CREW duty for Metro Coach without a second login or credential.
	david, err := person("+254700500016", "Demo David Kiprop", "500016")
	if err != nil {
		return nil, fmt.Errorf("david: %w", err)
	}
	davidEnt, err := EnsureEnterprise(ctx, pool, david, "retail-fashion")
	if err != nil {
		return nil, fmt.Errorf("david enterprise: %w", err)
	}
	if _, err := ensureStore(ctx, pool, davidEnt, demoStore{
		name: "Demo David's Fashion Corner", slug: "demo-davids-fashion", tagline: "Everyday wear, fair prices",
		primaryCategory: "Fashion", neighborhood: "Ngara", lat: -1.2762, lng: 36.8236,
		codEnabled: true, products: []demoProduct{
			{"T-shirt, cotton", "Fashion", "pc", 600, intPtr(50), false},
		},
	}); err != nil {
		return nil, fmt.Errorf("david store: %w", err)
	}
	if err := ensureOrgStaffGrant(ctx, pool, metroOrgID, david, "CREW", "active", james, nil); err != nil {
		return nil, fmt.Errorf("david grant: %w", err)
	}
	add("+254700500016", "500016", "Demo David Kiprop", "DUAL HAT — owns Demo David's Fashion Corner AND holds a CREW grant for Metro Coach: one login, switch duty on/off from Profile > Acting as")

	// ── 19–20: plain shoppers, no company/staff role at all — the
	// control group showing the default SUBJECT experience.
	esther, err := person("+254700500017", "Demo Esther Muthoni", "500017")
	if err != nil {
		return nil, fmt.Errorf("esther: %w", err)
	}
	add("+254700500017", "500017", "Demo Esther Muthoni", "Plain shopper — no company, no staff grant")

	brianK, err := person("+254700500018", "Demo Brian Kimutai", "500018")
	if err != nil {
		return nil, fmt.Errorf("brian k: %w", err)
	}
	add("+254700500018", "500018", "Demo Brian Kimutai", "Plain shopper — no company, no staff grant. Also doubles as a parcel courier below (custody itself needs no special role — any signed-in Party can accept/deliver a scan; the courier-company portal added later is a separate, org-scoped login, see ensureDemoParcelOrg).")

	// ── 21: a hotelier — modelled as a Store (primaryCategory
	// "Hospitality"), not a new domain concept. There is no dedicated
	// hotel/booking model in schema.prisma yet — a "room" is just a
	// Product with a per-night price, the same way the MSME-shape phase
	// already lets any business type list what it sells. Flagged here
	// rather than silently invented: if hoteliers need real
	// room-inventory/date-range booking later, that's new schema work,
	// not something this seed can stand in for.
	grace, err := person("+254700500021", "Demo Grace Otieno", "500021")
	if err != nil {
		return nil, fmt.Errorf("grace hotelier: %w", err)
	}
	graceEnt, err := EnsureEnterprise(ctx, pool, grace, "hospitality")
	if err != nil {
		return nil, fmt.Errorf("grace hotelier enterprise: %w", err)
	}
	if _, err := ensureStore(ctx, pool, graceEnt, demoStore{
		name: "Demo Nairobi Nights Hotel", slug: "demo-nairobi-nights-hotel", tagline: "Rooms by the night, walk-in or reserved",
		primaryCategory: "Hospitality", neighborhood: "Westlands", lat: -1.2648, lng: 36.8025,
		codEnabled: false, products: []demoProduct{
			{"Standard room — per night", "Rooms", "night", 4500, intPtr(8), false},
			{"Executive suite — per night", "Rooms", "night", 9000, intPtr(2), false},
			{"Airport transfer", "Services", "trip", 1500, nil, true},
		},
	}); err != nil {
		return nil, fmt.Errorf("grace hotelier store: %w", err)
	}
	add("+254700500021", "500021", "Demo Grace Otieno", "Store owner — Demo Nairobi Nights Hotel (hospitality — modelled as a store; see this file's own comment on why there's no dedicated hotel model yet)")

	// ── Metro Coach SACCO: short-distance/matatu operational data —
	// vehicle, a driver alongside Alice's existing CONDUCTOR crew
	// record, a 3-stage town route, and an open trip, so there's
	// something to actually verify fares/declare cash/close against
	// when signed in as Kevin/Linda/Tom/Alice/Sam/Peter above. Mirrors
	// demo_ticketing.go's ensureDemoFleet exactly.
	if err := ensureMetroCoachFleet(ctx, pool, metroOrgID, aliceCrewMemberID); err != nil {
		return nil, fmt.Errorf("metro coach fleet: %w", err)
	}

	// ── Highway Express: long-distance intercity route — the
	// seated-bus/schedule shape (as opposed to Metro Coach's
	// short-hop/fare-stage shape), so Nancy's SCANNER grant has actual
	// tickets to check in against.
	if err := ensureHighwayExpressRoute(ctx, pool, highwayOrgID); err != nil {
		return nil, fmt.Errorf("highway express route: %w", err)
	}

	// ── Parcels: one in each real status, spread across existing demo
	// people rather than inventing single-purpose "parcel" accounts —
	// there is no parcel-handler role to seed (see the comment on
	// Brian Kimutai above), just parcels that happen to be
	// booked/picked-up/in-transit/delivered right now.
	if err := ensureDemoParcels(ctx, pool, esther, amina, david, brianK, alice); err != nil {
		return nil, fmt.Errorf("demo parcels: %w", err)
	}

	// ── Bills: nothing had ever seeded one, so the mobile Bills screen
	// (and its overdue/due-soon urgency sort — see bills_list_screen.dart's
	// byUrgency comparator) had zero real data to render against on any
	// demo account. Esther gets one of each urgency bucket.
	if err := ensureDemoBills(ctx, pool, esther); err != nil {
		return nil, fmt.Errorf("demo bills: %w", err)
	}

	// ── 22–23: dedicated parcel couriers — Brian and Alice above already
	// hold parcels as "whichever signed-in Party scanned the code" (see
	// ensureDemoParcels' own comment), but neither is a formal
	// ParcelCourier row, so neither would show up in the admin Couriers
	// list, the assign panel's search, or claim a job. Peter and Susan
	// here are dedicated courier-only accounts — phone+PIN sign-in like
	// every other demo account, nothing parcel-specific about the login.
	peterMwangi, err := person("+254700500022", "Demo Peter Mwangi", "500022")
	if err != nil {
		return nil, fmt.Errorf("peter mwangi: %w", err)
	}
	add("+254700500022", "500022", "Demo Peter Mwangi", "Parcel courier — BODA, Active, online now (posts a fresh ping so Live dispatch shows them). Also RIDER at Demo Swift Riders.")

	susanAchieng, err := person("+254700500023", "Demo Susan Wanjala", "500023")
	if err != nil {
		return nil, fmt.Errorf("susan achieng: %w", err)
	}
	add("+254700500023", "500023", "Demo Susan Wanjala", "Parcel courier — VAN, Active, online now (posts a fresh ping so Live dispatch shows them). Also DISPATCHER at Demo Swift Riders.")

	if err := ensureDemoParcelCouriers(ctx, pool, []demoCourier{
		{partyID: brianK, vehicleType: "BODA", online: false, lat: 0, lng: 0},
		{partyID: alice, vehicleType: "TUKTUK", online: false, lat: 0, lng: 0},
		{partyID: peterMwangi, vehicleType: "BODA", online: true, lat: -1.2921, lng: 36.7872}, // Kilimani
		{partyID: susanAchieng, vehicleType: "VAN", online: true, lat: -1.2762, lng: 36.8236}, // Ngara
	}); err != nil {
		return nil, fmt.Errorf("demo parcel couriers: %w", err)
	}

	// ── Parcel zones + distance rate — without these the pricing page's
	// zone list and every distance-aware price preview are just empty;
	// same four hubs the demo stores/parcels above already use as
	// origin/destination labels, so a zone-priced demo booking lines up
	// with what's already on screen elsewhere.
	if err := ensureDemoParcelZones(ctx, pool); err != nil {
		return nil, fmt.Errorf("demo parcel zones: %w", err)
	}

	// ── A courier company, so the operator portal has something behind
	// it on a fresh seed. Without this, /parcel-co/<slug> 404s and two
	// of the product's six personas still have nothing to sign in to —
	// which is exactly the gap tenancy was added to close, so leaving
	// the demo unable to show it would be an odd place to stop.
	//
	// Peter and Susan (already seeded as active couriers above) become
	// its rider and dispatcher rather than getting parcel-only
	// doppelgangers, matching this file's standing rule of reusing the
	// same demo people across verticals.
	if err := ensureDemoParcelOrg(ctx, pool, peterMwangi, susanAchieng); err != nil {
		return nil, fmt.Errorf("demo parcel org: %w", err)
	}
	// Courier-company staff sign in by NAME at their company's own URL,
	// not by phone — so the "msisdn" column here carries that URL. The
	// three below are the same login for three different role bundles;
	// signing in as each is the fastest way to see what a rider can do
	// that a dispatcher can't, and vice versa.
	add("/parcel-co/demo-swift-riders", "500024", "Demo Njeri Kamau", "Courier-company MANAGER — team + earnings. Sign in by name at that URL, not by phone.")
	add("/parcel-co/demo-swift-riders", "500023", "Demo Susan Wanjala", "Courier-company DISPATCHER — assigns parcels to riders, no earnings.")
	add("/parcel-co/demo-swift-riders", "500022", "Demo Peter Mwangi", "Courier-company RIDER — carries and closes parcels only.")

	_ = authsvc.DummyPinHash // referenced for parity with the other seed files' pattern
	return accounts, nil
}

// demoCourier — one row for ensureDemoParcelCouriers. online=true also
// posts a ParcelCourierPing at (lat,lng) with now() as its timestamp,
// so the admin Live dispatch map shows this courier immediately after
// a fresh seed run rather than "last seen" being however old the seed
// data itself is.
type demoCourier struct {
	partyID     string
	vehicleType string
	online      bool
	lat, lng    float64
}

func ensureDemoParcelCouriers(ctx context.Context, pool *pgxpool.Pool, couriers []demoCourier) error {
	for _, c := range couriers {
		if _, err := pool.Exec(ctx, `
			INSERT INTO parcel_courier (id, "partyId", "vehicleType", status, "activatedAt", "createdAt")
			VALUES (gen_random_uuid(), $1, $2::"ParcelTransportMode", 'ACTIVE', now(), now())
			ON CONFLICT ("partyId") DO UPDATE SET status = 'ACTIVE', "activatedAt" = COALESCE(parcel_courier."activatedAt", now())`,
			c.partyID, c.vehicleType); err != nil {
			return fmt.Errorf("courier %s: %w", c.partyID, err)
		}
		if c.online {
			if _, err := pool.Exec(ctx, `
				INSERT INTO parcel_courier_ping (id, "courierPartyId", lat, lng, at)
				VALUES (gen_random_uuid(), $1, $2, $3, now())`,
				c.partyID, c.lat, c.lng); err != nil {
				return fmt.Errorf("courier ping %s: %w", c.partyID, err)
			}
		}
	}
	return nil
}

// ensureDemoParcelOrg stands up one courier company with a manager, a
// dispatcher and a rider, so a fresh seed can actually demonstrate the
// operator side: open /parcel-co/demo-swift-riders, sign in as any of
// the three, and see that company's own parcels and nobody else's.
//
// PINs match the phone-number convention every other demo login in this
// file uses (last six digits), so there is one rule to remember rather
// than a special case for parcels.
//
// Idempotent on the company's slug and on each staff member's
// (org, name) pair — this seed is re-run constantly during development
// and must never accumulate duplicate riders.
func ensureDemoParcelOrg(ctx context.Context, pool *pgxpool.Pool, riderPartyID, dispatcherPartyID string) error {
	// The company hangs off the rider's own enterprise — one of the demo
	// people running a business, same shape as every other tenant here,
	// rather than a synthetic "courier co" party with no history.
	ent, err := EnsureEnterprise(ctx, pool, riderPartyID, "logistics")
	if err != nil {
		return fmt.Errorf("courier enterprise: %w", err)
	}

	var orgID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO parcel_org (
			id, "enterpriseId", name, slug, status, "contactPerson", "contactPhone",
			"commissionPct", "createdAt", "updatedAt"
		) VALUES (
			gen_random_uuid(), $1, 'Demo Swift Riders', 'demo-swift-riders', 'ACTIVE',
			'Demo Peter Mwangi', '+254700500022', 15, now(), now()
		)
		ON CONFLICT (slug) DO UPDATE SET status = 'ACTIVE', "updatedAt" = now()
		RETURNING id`, ent).Scan(&orgID); err != nil {
		return fmt.Errorf("parcel org: %w", err)
	}

	staff := []struct {
		name    string
		role    string
		pin     string
		partyID *string
	}{
		// The manager is an office login: no partyId, because they never
		// take custody of anything. A rider's login does carry one —
		// custody is always attributed to a real person, never to a staff
		// row (see ParcelOrgStaff.partyId).
		{"Demo Njeri Kamau", "MANAGER", "500024", nil},
		{"Demo Susan Wanjala", "DISPATCHER", "500023", &dispatcherPartyID},
		{"Demo Peter Mwangi", "RIDER", "500022", &riderPartyID},
	}
	for _, s := range staff {
		hash, err := authsvc.HashPin(s.pin)
		if err != nil {
			return fmt.Errorf("parcel staff pin %s: %w", s.name, err)
		}
		// No unique constraint on (orgId, name) in the schema — a company
		// may legitimately employ two people with the same name — so this
		// seeds idempotently by checking first rather than relying on
		// ON CONFLICT.
		var existing string
		err = pool.QueryRow(ctx, `
			SELECT id FROM parcel_org_staff WHERE "orgId" = $1 AND lower(name) = lower($2)`,
			orgID, s.name).Scan(&existing)
		if err == nil {
			if _, err := pool.Exec(ctx, `
				UPDATE parcel_org_staff SET "pinHash" = $1, role = $2, active = true,
				       "partyId" = $3, "updatedAt" = now()
				WHERE id = $4`, hash, s.role, s.partyID, existing); err != nil {
				return fmt.Errorf("parcel staff update %s: %w", s.name, err)
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("parcel staff lookup %s: %w", s.name, err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO parcel_org_staff (id, "orgId", name, "pinHash", role, active, "partyId", "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5, now(), now())`,
			orgID, s.name, hash, s.role, s.partyID); err != nil {
			return fmt.Errorf("parcel staff insert %s: %w", s.name, err)
		}
	}

	// Put the demo couriers on this company's books so the rider's
	// Nearby-jobs and the dispatcher's assign screen agree about who
	// works here.
	if _, err := pool.Exec(ctx, `
		UPDATE parcel_courier SET "parcelOrgId" = $1 WHERE "partyId" = ANY($2)`,
		orgID, []string{riderPartyID, dispatcherPartyID}); err != nil {
		return fmt.Errorf("courier org membership: %w", err)
	}

	// Hand it the unpaid demo parcels so the portal isn't an empty
	// table. Only DRAFT/BOOKED ones: AssignParcelToOrg refuses anything
	// already paid for, and the seed must not do by raw SQL what the
	// application refuses to do for good reason.
	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET "parcelOrgId" = $1
		WHERE "parcelOrgId" IS NULL
		  AND "paidAt" IS NULL
		  AND status IN ('DRAFT_PENDING_PAYMENT', 'BOOKED')`, orgID); err != nil {
		return fmt.Errorf("parcel org backfill: %w", err)
	}
	return nil
}

func ensureDemoParcelZones(ctx context.Context, pool *pgxpool.Pool) error {
	zones := []struct {
		name     string
		lat, lng float64
	}{
		{"Kilimani", -1.2921, 36.7872},
		{"Ngara", -1.2762, 36.8236},
		{"Westlands", -1.2648, 36.8025},
		{"CBD", -1.2833, 36.8167},
	}
	for _, z := range zones {
		if _, err := pool.Exec(ctx, `
			INSERT INTO parcel_zone (id, name, lat, lng, active, "createdAt")
			VALUES (gen_random_uuid(), $1, $2, $3, true, now())
			ON CONFLICT (name) DO NOTHING`, z.name, z.lat, z.lng); err != nil {
			return fmt.Errorf("zone %s: %w", z.name, err)
		}
	}
	var rateExists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM parcel_distance_rate)`).Scan(&rateExists); err != nil {
		return err
	}
	if !rateExists {
		if _, err := pool.Exec(ctx, `
			INSERT INTO parcel_distance_rate (id, "perKmKes", "minChargeableKm", "updatedAt")
			VALUES (gen_random_uuid(), 15, 1, now())`); err != nil {
			return fmt.Errorf("distance rate: %w", err)
		}
	}
	return nil
}

func ensureMetroCoachFleet(ctx context.Context, pool *pgxpool.Pool, orgID, conductorCrewMemberID string) error {
	var vehicleID string
	err := pool.QueryRow(ctx, `SELECT id FROM fleet_vehicle WHERE "orgId" = $1 AND "plateNo" = 'KDN 700M'`, orgID).Scan(&vehicleID)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO fleet_vehicle (id, "orgId", "plateNo", capacity, label, status, "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, 'KDN 700M', 14, 'Demo matatu', 'ACTIVE', now(), now())
			RETURNING id`, orgID).Scan(&vehicleID)
		if err != nil {
			return err
		}
	}
	driverID, err := ensureCrewMemberSeed(ctx, pool, orgID, "Demo Metro Coach Driver", "DRIVER", "+254700500022")
	if err != nil {
		return err
	}
	var routeID string
	err = pool.QueryRow(ctx, `SELECT id FROM short_route WHERE "orgId" = $1 AND name = 'Demo Metro Town Loop'`, orgID).Scan(&routeID)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO short_route (id, "orgId", name, active, "createdAt")
			VALUES (gen_random_uuid(), $1, 'Demo Metro Town Loop', true, now()) RETURNING id`, orgID).Scan(&routeID)
		if err != nil {
			return err
		}
		for i, st := range []struct {
			name string
			fare float64
		}{{"Town Stage", 60}, {"Junction Stage", 90}, {"Estate Terminus", 120}} {
			if _, err := pool.Exec(ctx, `
				INSERT INTO fare_stage (id, "shortRouteId", name, "order", "fareKes")
				VALUES (gen_random_uuid(), $1, $2, $3, $4)
				ON CONFLICT ("shortRouteId", "order") DO NOTHING`, routeID, st.name, i+1, st.fare); err != nil {
				return err
			}
		}
	}
	var open int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM trip WHERE "vehicleId" = $1 AND status = 'ACTIVE'`, vehicleID).Scan(&open); err != nil {
		return err
	}
	if open == 0 {
		if _, err := pool.Exec(ctx, `
			INSERT INTO trip (id, "orgId", "vehicleId", "driverId", "conductorId", "shortRouteId", status, "startedAt", "createdAt", "qrToken", "qrShortCode", "qrRotatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE', now(), now(), 'METRO-' || substr(gen_random_uuid()::text,1,6), 'BUS-METRO', now())`,
			orgID, vehicleID, driverID, conductorCrewMemberID, routeID); err != nil {
			return err
		}
	}
	return nil
}

func ensureHighwayExpressRoute(ctx context.Context, pool *pgxpool.Pool, orgID string) error {
	routeID, err := ensureRoute(ctx, pool, orgID, "Nairobi", "Kisumu", 350)
	if err != nil {
		return err
	}
	listingID, err := ensureListing(ctx, pool, orgID, "Nairobi → Kisumu Highway Express", "demo-nairobi-kisumu",
		"Daily intercity coach, Nairobi to Kisumu — reclining seats, VIP class has wifi and extra legroom.", &routeID, nil)
	if err != nil {
		return err
	}
	economyID, err := ensureTicketClass(ctx, pool, listingID, "Economy", 1200, 44, false, nil, nil)
	if err != nil {
		return err
	}
	vipNote := "Extra legroom, USB charging"
	vipID, err := ensureTicketClass(ctx, pool, listingID, "VIP", 2200, 12, true, []string{"RECLINING", "WIFI"}, &vipNote)
	if err != nil {
		return err
	}
	_ = economyID
	if err := scheduleOccurrence(ctx, pool, listingID, time.Now().Add(48*time.Hour), strPtr("KDQ 900H"), []ticketClassSeatSpec{{vipID, 12}}); err != nil {
		return err
	}
	return scheduleOccurrence(ctx, pool, listingID, time.Now().Add(96*time.Hour), strPtr("KDQ 901H"), []ticketClassSeatSpec{{vipID, 12}})
}

// ensureDemoParcels seeds one parcel in each real ParcelStatus, spread
// across existing demo people — never invented single-purpose parcel
// accounts, since there is no parcel-handler role in the domain model
// (see dbx/parcels.go: acceptance/delivery is just "whichever signed-in
// Party scanned the code", not a capability).
func ensureDemoParcels(ctx context.Context, pool *pgxpool.Pool, esther, amina, david, courierBrian, courierAlice string) error {
	type spec struct {
		code, deliveryCode, senderPartyID, senderName, senderMsisdn string
		receiverName, receiverMsisdn, origin, dest                  string
		status                                                      string
		holderPartyID                                               *string
		delivered                                                   bool
	}
	specs := []spec{
		{
			code: "PKG-DEMO001", deliveryCode: "112233",
			senderPartyID: esther, senderName: "Demo Esther Muthoni", senderMsisdn: "+254700500017",
			receiverName: "Demo David Kiprop", receiverMsisdn: "+254700500016",
			origin: "Kilimani, opposite Yaya Centre", dest: "Ngara, David's Fashion Corner",
			status: "BOOKED", holderPartyID: nil,
		},
		{
			code: "PKG-DEMO002", deliveryCode: "445566",
			senderPartyID: amina, senderName: "Demo Amina Wanjiru", senderMsisdn: "+254700500001",
			receiverName: "Demo Brian Otieno", receiverMsisdn: "+254700500002",
			origin: "Kilimani, Amina's Grocers", dest: "CBD, Brian's Electronics",
			status: "PICKED_UP", holderPartyID: &amina,
		},
		{
			code: "PKG-DEMO003", deliveryCode: "778899",
			senderPartyID: david, senderName: "Demo David Kiprop", senderMsisdn: "+254700500016",
			receiverName: "Demo Esther Muthoni", receiverMsisdn: "+254700500017",
			origin: "Ngara, David's Fashion Corner", dest: "Kilimani, opposite Yaya Centre",
			status: "IN_TRANSIT", holderPartyID: &courierBrian,
		},
		{
			code: "PKG-DEMO004", deliveryCode: "990011",
			senderPartyID: esther, senderName: "Demo Esther Muthoni", senderMsisdn: "+254700500017",
			receiverName: "Demo Amina Wanjiru", receiverMsisdn: "+254700500001",
			origin: "Kilimani, opposite Yaya Centre", dest: "Kilimani, Amina's Grocers",
			status: "DELIVERED", holderPartyID: &amina, delivered: true,
		},
		{
			// Alice is the demo conductor (linked CrewMember on Metro
			// Coach's open trip — see ensureMetroCoachFleet) *and* the
			// demo parcel handler here: one sign-in exercises both
			// "access as a conductor" and "parcel handling" at once,
			// since there is no separate parcel-handler role to seed
			// for (see this function's own header comment).
			code: "PKG-DEMO005", deliveryCode: "223344",
			senderPartyID: david, senderName: "Demo David Kiprop", senderMsisdn: "+254700500016",
			receiverName: "Demo Amina Wanjiru", receiverMsisdn: "+254700500001",
			origin: "Ngara, David's Fashion Corner", dest: "Kilimani, Amina's Grocers",
			status: "IN_TRANSIT", holderPartyID: &courierAlice,
		},
	}
	for _, s := range specs {
		var existing string
		err := pool.QueryRow(ctx, `SELECT id FROM parcel WHERE code = $1`, s.code).Scan(&existing)
		if err == nil {
			continue // already seeded — parcels have no other natural upsert key worth updating
		}
		var parcelID string
		err = pool.QueryRow(ctx, `
			INSERT INTO parcel (id, code, "deliveryCode", "senderPartyId", "senderName", "senderMsisdn",
				"receiverName", "receiverMsisdn", "originLabel", "destinationLabel",
				"currentHolderPartyId", status, "createdAt", "deliveredAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::"ParcelStatus", now(),
				CASE WHEN $12 THEN now() ELSE NULL END)
			RETURNING id`,
			s.code, s.deliveryCode, s.senderPartyID, s.senderName, s.senderMsisdn,
			s.receiverName, s.receiverMsisdn, s.origin, s.dest, s.holderPartyID, s.status, s.delivered).Scan(&parcelID)
		if err != nil {
			return fmt.Errorf("parcel %s: %w", s.code, err)
		}
		if s.holderPartyID != nil {
			if _, err := pool.Exec(ctx, `
				INSERT INTO parcel_handoff (id, "parcelId", "toPartyId", "createdAt")
				VALUES (gen_random_uuid(), $1, $2, now())`, parcelID, *s.holderPartyID); err != nil {
				return fmt.Errorf("parcel handoff %s: %w", s.code, err)
			}
		}
	}
	return nil
}

// ensureDemoBills gives Esther one bill in each urgency bucket the
// mobile Bills screen groups by (bills_list_screen.dart's byUrgency
// comparator sorts overdue/due-soon/upcoming, each bucket sorted by
// due date) — without this, every demo account had zero bills and
// nobody could see that sort actually run against real rows.
func ensureDemoBills(ctx context.Context, pool *pgxpool.Pool, esther string) error {
	type spec struct {
		label, category    string
		accountRef         string
		amountKES          *float64
		cycle              string
		daysFromNow        int // negative = already overdue
		reminderDaysBefore int
	}
	kplc := 1450.0
	dstv := 3200.0
	specs := []spec{
		// Overdue — daysFromNow < 0.
		{label: "KPLC — home", category: "ELECTRICITY", accountRef: "12345678901", amountKES: &kplc, cycle: "MONTHLY", daysFromNow: -3, reminderDaysBefore: 3},
		// Due soon — inside its own reminder window.
		{label: "DSTV Compact", category: "PAY_TV", accountRef: "1044837201", amountKES: &dstv, cycle: "MONTHLY", daysFromNow: 2, reminderDaysBefore: 3},
		// Upcoming — outside the reminder window, sorted after the
		// two above but still listed, and with a null amount to
		// exercise the "amount varies" display path.
		{label: "Nairobi Water", category: "WATER", accountRef: "88213", amountKES: nil, cycle: "MONTHLY", daysFromNow: 21, reminderDaysBefore: 3},
	}
	for _, s := range specs {
		var existing string
		err := pool.QueryRow(ctx, `SELECT id FROM bill WHERE "partyId" = $1 AND label = $2`, esther, s.label).Scan(&existing)
		if err == nil {
			continue // already seeded — re-running the seed must not duplicate or reset due dates
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO bill (id, "partyId", label, category, "accountRef", "amountKes", cycle, "nextDueAt", "reminderDaysBefore", status, "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now() + make_interval(days => $7), $8, 'ACTIVE', now(), now())`,
			esther, s.label, s.category, s.accountRef, s.amountKES, s.cycle, s.daysFromNow, s.reminderDaysBefore); err != nil {
			return fmt.Errorf("bill %s: %w", s.label, err)
		}
	}
	return nil
}
