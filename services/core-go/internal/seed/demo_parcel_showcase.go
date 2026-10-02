// Package seed (demo_parcel_showcase.go) — a lived-in parcel company.
//
// Two tenants share this showcase:
//
//   - Demo Swift Riders (slug demo-swift-riders) is the synthetic tour
//     tenant prospects click through.
//   - ESOQO Shippers (slug esoqo-shippers) is the REAL company account —
//     the same ~24-parcel shape is planted there too so the team sees
//     every dashboard state on their own login, on the web.
//
// The real org's own profile (contact, locationHint, openingHours) is
// never overwritten — only acceptsWalkIn is ensured. Showcase holders on
// the real org point at its own staffer (Kiki Viki) so custody names,
// handoffs and the live map resolve to someone actually on its roster,
// never to demo-tenant riders from another company.
//
// Idempotent: stations upsert by (org, name), parcels upsert by code
// (display fields refreshed, money/paid fields backfilled when null).
// Courier pings are deliberately NOT idempotent — the live map only
// shows dots from the last hour, so every seed run posts fresh ones.
package seed

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type showcaseParcel struct {
	code, ticket, deliveryCode   string
	senderName, senderMsisdn     string
	receiverName, receiverMsisdn string
	origin, dest                 string
	originZone, destZone         string // parcel_zone names, "" = none
	parcelType                   string
	priceKES                     float64
	status                       string
	originMethod                 string
	holderMsisdn                 string // person msisdn holding it, "" = nobody yet
	createdDaysAgo               float64
	paidDaysAgo                  *float64 // nil = unpaid draft-like (not used here; all showcase parcels are paid)
	deliveredDaysAgo             *float64
	slaHoursFromCreate           *float64
	deliveryAttempts             int
	lastAttemptReason            *string
	codAmountKES                 *float64
	codStatus                    string
	atAgent                      string // station name when HELD_AT_AGENT
	agentHeldDaysAgo             *float64
}

func f64(v float64) *float64 { return &v }

// showcaseParcels — Kenyan names, real neighbourhood labels, prices in
// the 250–650 band a same-city courier actually charges. Codes
// PKG-DEMO-101… are namespaced away from the 5 hand-seeded PKG-DEMO00x
// rows so the two sets never collide.
var showcaseParcels = []showcaseParcel{
	// ── Waiting for a rider (BOOKED, scheduled pickup) ──
	{code: "PKG-DEMO-101", ticket: "TCK-DEMO-101", deliveryCode: "101101", senderName: "Demo Wanjiku Mwangi", senderMsisdn: "+254722111001", receiverName: "Demo Otis Baraka", receiverMsisdn: "+254722111002", origin: "Kilimani, Woodvale Grove, Hse B4", dest: "Ngara, Fig Tree Market stall 12", originZone: "Kilimani", destZone: "Ngara", parcelType: "SMALL", priceKES: 280, status: "BOOKED", originMethod: "SCHEDULED_PICKUP", createdDaysAgo: 0.2},
	{code: "PKG-DEMO-102", ticket: "TCK-DEMO-102", deliveryCode: "102102", senderName: "Demo Brian Otieno", senderMsisdn: "+254700500002", receiverName: "Demo Sharon Nyambura", receiverMsisdn: "+254722111003", origin: "CBD, Moi Avenue, Sonalux Hse", dest: "Westlands, Sarit Centre, gate B", originZone: "CBD", destZone: "Westlands", parcelType: "MEDIUM", priceKES: 420, status: "BOOKED", originMethod: "SCHEDULED_PICKUP", createdDaysAgo: 0.5},
	{code: "PKG-DEMO-103", ticket: "TCK-DEMO-103", deliveryCode: "103103", senderName: "Demo Amina Wanjiru", senderMsisdn: "+254700500001", receiverName: "Demo Kevin Maina", receiverMsisdn: "+254722111004", origin: "Kilimani, Amina's Grocers", dest: "South B, Plainsview Estate, Hse 7", originZone: "Kilimani", destZone: "", parcelType: "LARGE", priceKES: 550, status: "BOOKED", originMethod: "SCHEDULED_PICKUP", createdDaysAgo: 1.1},
	// ── Awaiting drop-off (BOOKED, self drop-off — the front desk's own tab) ──
	{code: "PKG-DEMO-104", ticket: "TCK-DEMO-104", deliveryCode: "104104", senderName: "Demo Faith Njeri", senderMsisdn: "+254700500003", receiverName: "Demo Grace Wairimu", receiverMsisdn: "+254700500015", origin: "Walk-in — Kilimani Hub counter", dest: "Ngara, David's Fashion Corner", originZone: "Kilimani", destZone: "Ngara", parcelType: "SMALL", priceKES: 250, status: "BOOKED", originMethod: "SELF_DROPOFF", createdDaysAgo: 0.3},
	{code: "PKG-DEMO-105", ticket: "TCK-DEMO-105", deliveryCode: "105105", senderName: "Demo Peter Kamau", senderMsisdn: "+254700500004", receiverName: "Demo Linda Wambui", receiverMsisdn: "+254700500009", origin: "Walk-in — Ngara Counter", dest: "Kilimani, opposite Yaya Centre", originZone: "Ngara", destZone: "Kilimani", parcelType: "ENVELOPE_DOCUMENT", priceKES: 180, status: "BOOKED", originMethod: "SELF_DROPOFF", createdDaysAgo: 0.8},
	// ── At the station ──
	{code: "PKG-DEMO-106", ticket: "TCK-DEMO-106", deliveryCode: "106106", senderName: "Demo David Kiprop", senderMsisdn: "+254700500016", receiverName: "Demo Esther Muthoni", receiverMsisdn: "+254700500017", origin: "Walk-in — Kilimani Hub counter", dest: "Westlands, Westgate, 2nd floor", originZone: "Kilimani", destZone: "Westlands", parcelType: "MEDIUM", priceKES: 380, status: "RECEIVED_AT_COUNTER", originMethod: "SELF_DROPOFF", createdDaysAgo: 0.6},
	{code: "PKG-DEMO-107", ticket: "TCK-DEMO-107", deliveryCode: "107107", senderName: "Demo Mary Chebet", senderMsisdn: "+254700500007", receiverName: "Demo Tom Kiptoo", receiverMsisdn: "+254700500010", origin: "Walk-in — Ngara Counter", dest: "CBD, Tom Mboya St, Odeon", originZone: "Ngara", destZone: "CBD", parcelType: "SMALL", priceKES: 300, status: "RECEIVED_AT_COUNTER", originMethod: "SELF_DROPOFF", createdDaysAgo: 1.4},
	// ── Picked up ──
	{code: "PKG-DEMO-108", ticket: "TCK-DEMO-108", deliveryCode: "108108", senderName: "Demo Susan Achieng", senderMsisdn: "+254700500005", receiverName: "Demo Nancy Adhiambo", receiverMsisdn: "+254700500013", origin: "CBD, Kencom, office drop", dest: "Kilimani, Kindaruma Rd, Hse 9", originZone: "CBD", destZone: "Kilimani", parcelType: "SMALL", priceKES: 320, status: "PICKED_UP", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500022", createdDaysAgo: 0.4},
	{code: "PKG-DEMO-109", ticket: "TCK-DEMO-109", deliveryCode: "109109", senderName: "Demo James Mwangi", senderMsisdn: "+254700500006", receiverName: "Demo Alice Nduta", receiverMsisdn: "+254700500011", origin: "Westlands, Rhapta Rd", dest: "Ngara, Park Rd, flats G3", originZone: "Westlands", destZone: "Ngara", parcelType: "MEDIUM", priceKES: 400, status: "PICKED_UP", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500018", createdDaysAgo: 0.7},
	// ── In transit (one overdue past SLA to light the overdue queue) ──
	{code: "PKG-DEMO-110", ticket: "TCK-DEMO-110", deliveryCode: "110110", senderName: "Demo Winnie Achola", senderMsisdn: "+254700500019", receiverName: "Demo Ochieng Barasa", receiverMsisdn: "+254700500014", origin: "Kilimani, Prestige Plaza", dest: "CBD, Ronald Ngala St, shop 4", originZone: "Kilimani", destZone: "CBD", parcelType: "SMALL", priceKES: 290, status: "IN_TRANSIT", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500022", createdDaysAgo: 0.9, slaHoursFromCreate: f64(48)},
	{code: "PKG-DEMO-111", ticket: "TCK-DEMO-111", deliveryCode: "111111", senderName: "Demo Esther Muthoni", senderMsisdn: "+254700500017", receiverName: "Demo Brian Kimutai", receiverMsisdn: "+254700500018", origin: "Ngara, Fig Tree Market", dest: "Westlands, Mpaka Rd, Hse 21", originZone: "Ngara", destZone: "Westlands", parcelType: "MEDIUM", priceKES: 450, status: "IN_TRANSIT", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500018", createdDaysAgo: 3.2, slaHoursFromCreate: f64(48)},
	{code: "PKG-DEMO-112", ticket: "TCK-DEMO-112", deliveryCode: "112112", senderName: "Demo Grace Otieno", senderMsisdn: "+254700500021", receiverName: "Demo Peter Mwangi", receiverMsisdn: "+254700500022", origin: "Westlands, Nairobi Nights Hotel", dest: "Kilimani, Lenana Rd, Hse 3", originZone: "Westlands", destZone: "Kilimani", parcelType: "LARGE", priceKES: 620, status: "IN_TRANSIT", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500022", createdDaysAgo: 0.3, slaHoursFromCreate: f64(48)},
	// ── COD in transit — buyer pays the rider at the door ──
	{code: "PKG-DEMO-113", ticket: "TCK-DEMO-113", deliveryCode: "113113", senderName: "Demo David Kiprop", senderMsisdn: "+254700500016", receiverName: "Demo Sharon Nyambura", receiverMsisdn: "+254722111003", origin: "Ngara, David's Fashion Corner", dest: "Kilimani, Suna Rd, Hse 11", originZone: "Ngara", destZone: "Kilimani", parcelType: "SMALL", priceKES: 300, status: "IN_TRANSIT", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500022", createdDaysAgo: 0.5, slaHoursFromCreate: f64(48), codAmountKES: f64(3500), codStatus: "COLLECTED"},
	// ── Failed attempts — somebody has to phone the receiver ──
	{code: "PKG-DEMO-114", ticket: "TCK-DEMO-114", deliveryCode: "114114", senderName: "Demo Amina Wanjiru", senderMsisdn: "+254700500001", receiverName: "Demo Kevin Maina", receiverMsisdn: "+254722111004", origin: "Kilimani, Amina's Grocers", dest: "Ngara, Desai Rd, nobody home", originZone: "Kilimani", destZone: "Ngara", parcelType: "MEDIUM", priceKES: 360, status: "FAILED_DELIVERY", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500018", createdDaysAgo: 1.8, slaHoursFromCreate: f64(48), deliveryAttempts: 1, lastAttemptReason: strPtr("NOBODY_HOME")},
	{code: "PKG-DEMO-115", ticket: "TCK-DEMO-115", deliveryCode: "115115", senderName: "Demo Brian Otieno", senderMsisdn: "+254700500002", receiverName: "Demo Wanjiku Mwangi", receiverMsisdn: "+254722111001", origin: "CBD, Brian's Electronics", dest: "Westlands, wrong gate, guard refused", originZone: "CBD", destZone: "Westlands", parcelType: "SMALL", priceKES: 310, status: "FAILED_DELIVERY", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500022", createdDaysAgo: 2.5, slaHoursFromCreate: f64(48), deliveryAttempts: 2, lastAttemptReason: strPtr("REFUSED")},
	// ── At pickup points (one stale >5d so the amber tile has a row) ──
	{code: "PKG-DEMO-116", ticket: "TCK-DEMO-116", deliveryCode: "116116", senderName: "Demo Susan Wanjala", senderMsisdn: "+254700500023", receiverName: "Demo Tom Kiptoo", receiverMsisdn: "+254700500010", origin: "Ngara, Fig Tree Market", dest: "Collect at Kilimani Hub", originZone: "Ngara", destZone: "Kilimani", parcelType: "SMALL", priceKES: 280, status: "HELD_AT_AGENT", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "", createdDaysAgo: 2.0, atAgent: "Demo Swift Riders – Kilimani Hub", agentHeldDaysAgo: f64(2)},
	{code: "PKG-DEMO-117", ticket: "TCK-DEMO-117", deliveryCode: "117117", senderName: "Demo Peter Mwangi", senderMsisdn: "+254700500022", receiverName: "Demo Grace Wairimu", receiverMsisdn: "+254700500015", origin: "CBD, Archives, stall drop", dest: "Collect at Ngara Counter", originZone: "CBD", destZone: "Ngara", parcelType: "MEDIUM", priceKES: 390, status: "HELD_AT_AGENT", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "", createdDaysAgo: 8.0, atAgent: "Demo Swift Riders – Ngara Counter", agentHeldDaysAgo: f64(6)},
	// ── Delivered today (earnings tile) + older delivered (all-time) ──
	{code: "PKG-DEMO-118", ticket: "TCK-DEMO-118", deliveryCode: "118118", senderName: "Demo Nancy Adhiambo", senderMsisdn: "+254700500013", receiverName: "Demo Linda Wambui", receiverMsisdn: "+254700500009", origin: "Kilimani, Yaya Centre, shop 2", dest: "Ngara, Park Rd, Hse 8", originZone: "Kilimani", destZone: "Ngara", parcelType: "SMALL", priceKES: 270, status: "DELIVERED", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500022", createdDaysAgo: 0.4, deliveredDaysAgo: f64(0.1), slaHoursFromCreate: f64(48)},
	{code: "PKG-DEMO-119", ticket: "TCK-DEMO-119", deliveryCode: "119119", senderName: "Demo Ochieng Barasa", senderMsisdn: "+254700500014", receiverName: "Demo Faith Njeri", receiverMsisdn: "+254700500003", origin: "Westlands, Sarit, kiosk 3", dest: "CBD, Latema Rd, Hse 5", originZone: "Westlands", destZone: "CBD", parcelType: "ENVELOPE_DOCUMENT", priceKES: 200, status: "DELIVERED", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500018", createdDaysAgo: 0.6, deliveredDaysAgo: f64(0.2), slaHoursFromCreate: f64(48)},
	{code: "PKG-DEMO-120", ticket: "TCK-DEMO-120", deliveryCode: "120120", senderName: "Demo Kevin Otieno", senderMsisdn: "+254700500008", receiverName: "Demo Mary Chebet", receiverMsisdn: "+254700500007", origin: "Ngara, Fig Tree, bay 2", dest: "Kilimani, Rose Ave, Hse 14", originZone: "Ngara", destZone: "Kilimani", parcelType: "MEDIUM", priceKES: 410, status: "DELIVERED", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500022", createdDaysAgo: 4.0, deliveredDaysAgo: f64(3.5), slaHoursFromCreate: f64(48)},
	{code: "PKG-DEMO-121", ticket: "TCK-DEMO-121", deliveryCode: "121121", senderName: "Demo David Kiprop", senderMsisdn: "+254700500016", receiverName: "Demo Esther Muthoni", receiverMsisdn: "+254700500017", origin: "Ngara, David's Fashion Corner", dest: "Kilimani, Argwings Kodhek, flat 2B", originZone: "Ngara", destZone: "Kilimani", parcelType: "SMALL", priceKES: 300, status: "DELIVERED", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "+254700500018", createdDaysAgo: 6.0, deliveredDaysAgo: f64(5.5), slaHoursFromCreate: f64(48), codAmountKES: f64(2800), codStatus: "SETTLED"},
	// ── Returned to sender — the give-up path, terminal but billed ──
	{code: "PKG-DEMO-122", ticket: "TCK-DEMO-122", deliveryCode: "122122", senderName: "Demo Grace Wairimu", senderMsisdn: "+254700500015", receiverName: "Demo Sam Kiprotich", receiverMsisdn: "+254700500012", origin: "Kilimani, Prestige, shop 6", dest: "Ngara, receiver moved, 3 attempts", originZone: "Kilimani", destZone: "Ngara", parcelType: "MEDIUM", priceKES: 380, status: "RETURNED_TO_SENDER", originMethod: "SCHEDULED_PICKUP", holderMsisdn: "", createdDaysAgo: 9.0, slaHoursFromCreate: f64(48), deliveryAttempts: 3, lastAttemptReason: strPtr("UNREACHABLE")},
}

// eshipShowcaseConfig — the ESOQO-family tour shape. Names read as real
// customers (cleanNames strips the template's "Demo " prefix), and the
// real org's own profile is never overwritten — only acceptsWalkIn is
// ensured. A production push re-points this at the tagged account.
var eshipShowcaseConfig = showcaseOrgConfig{
	slug:           "esoqo-shippers",
	codePrefix:     "PKG-ESHIP-",
	ticketPrefix:   "TCK-ESHIP-",
	labelPrefix:    "PKG-ESHIP-LBL-",
	touchProfile:   false, // real company profile — never overwrite name/hint/hours
	cleanNames:     true,
	holderOverride: "+254728387694", // Kiki Viki — custody stays on its own roster
	stations: []stationDef{
		{"ESOQO Shippers – Kabiria Hub", "+254728387694", "Kabiria Cabby Centre — ground floor", -1.3121, 36.7446, 100},
		{"ESOQO Shippers – CBD Counter", "+254728387694", "CBD — Tom Mboya St, Odeon side", -1.2833, 36.8167, 60},
	},
	stationA:       "ESOQO Shippers – Kabiria Hub",
	stationB:       "ESOQO Shippers – CBD Counter",
	dispatchPlate:  "KDJ 508S",
	dispatchNotes:  "Morning run — Kabiria to CBD",
	dispatchLat:    -1.2981,
	dispatchLng:    36.7803,
	crewName:       "Kiki Viki",
	receiverName:   "Kiki Viki",
	fallbackHolder: "+254728387694",
}

// SeedDemoParcelShowcase plants the tour shape onto both the synthetic
// demo tenant and the real ESOQO account — or, when SEED_PROD_ORG is
// set, onto that single production account. Call after
// SeedDemoUnifiedIdentity; safe to re-run.
func SeedDemoParcelShowcase(ctx context.Context, pool *pgxpool.Pool) error {
	if IsProdSeed() {
		cfg := eshipShowcaseConfig
		cfg.slug = OrgSlug("esoqo-shippers")
		if err := seedShowcaseForOrg(ctx, pool, cfg); err != nil {
			return err
		}
		postShowcaseCourierPings(ctx, pool)
		return nil
	}
	if err := seedShowcaseForOrg(ctx, pool, showcaseOrgConfig{
		slug:         "demo-swift-riders",
		codePrefix:   "PKG-DEMO-",
		ticketPrefix: "TCK-DEMO-",
		labelPrefix:  "PKG-DEMO-LBL-",
		touchProfile: true,
		profileLat:   -1.2921,
		profileLng:   36.7872,
		profileHint:  "Ground floor, Woodvale Grove, Kilimani — next to the Naivas",
		profileHours: "Mon–Sat 8am–7pm",
		stations: []stationDef{
			{"Demo Swift Riders – Kilimani Hub", "+254700500030", "Woodvale Grove, Kilimani — ground floor", -1.2921, 36.7872, 100},
			{"Demo Swift Riders – Ngara Counter", "+254700500031", "Fig Tree Market, Ngara — bay 2", -1.2762, 36.8236, 60},
		},
		stationA:       "Demo Swift Riders – Kilimani Hub",
		stationB:       "Demo Swift Riders – Ngara Counter",
		dispatchPlate:  "KDJ 412M",
		dispatchNotes:  "Demo morning run — Kilimani to Ngara",
		dispatchLat:    -1.2841,
		dispatchLng:    36.8053,
		crewName:       "Demo Peter Mwangi",
		receiverName:   "Demo Susan Wanjala",
		fallbackHolder: "+254700500022",
	}); err != nil {
		return err
	}
	if err := seedShowcaseForOrg(ctx, pool, eshipShowcaseConfig); err != nil {
		return err
	}
	postShowcaseCourierPings(ctx, pool)
	return nil
}

// postShowcaseCourierPings plants fresh courier dots — the live map only
// renders pings <1h old. Kiki's ping is what lights ESOQO Shippers' own
// map (dots are roster-scoped); the demo-tenant dots keep Swift Riders
// alive. On a production push the swift-demo persons don't exist and are
// skipped; whoever does exist (e.g. the real account owner) gets a dot.
func postShowcaseCourierPings(ctx context.Context, pool *pgxpool.Pool) {
	for _, c := range []struct {
		msisdn   string
		lat, lng float64
	}{
		{"+254700500022", -1.2841, 36.8053}, // Peter — mid-route, CBD
		{"+254700500023", -1.2762, 36.8236}, // Susan — at Ngara counter
		{"+254700500018", -1.2921, 36.7872}, // Brian — Kilimani
		{"+254728387694", -1.2981, 36.7803}, // Kiki — mid-route, Ngong Rd
	} {
		var partyID string
		if err := pool.QueryRow(ctx, `SELECT "partyId" FROM person WHERE msisdn=$1`, c.msisdn).Scan(&partyID); err != nil {
			continue
		}
		_, _ = pool.Exec(ctx, `INSERT INTO parcel_courier (id, "partyId", "vehicleType", status, "activatedAt", "createdAt")
			VALUES (gen_random_uuid(), $1, 'VAN', 'ACTIVE', now(), now())
			ON CONFLICT ("partyId") DO UPDATE SET status='ACTIVE'`, partyID)
		_, _ = pool.Exec(ctx, `INSERT INTO parcel_courier_ping (id, "courierPartyId", lat, lng, at)
			VALUES (gen_random_uuid(), $1, $2, $3, now())`, partyID, c.lat, c.lng)
	}
}

type stationDef struct {
	name, msisdn, hint string
	lat, lng           float64
	capacity           int
}

type showcaseOrgConfig struct {
	slug, codePrefix, ticketPrefix, labelPrefix string
	touchProfile                                bool
	cleanNames                                  bool
	profileLat, profileLng                      float64
	profileHint, profileHours                   string
	holderOverride                              string
	stations                                    []stationDef
	stationA, stationB                          string
	dispatchPlate, dispatchNotes                string
	dispatchLat, dispatchLng                    float64
	crewName, receiverName, fallbackHolder      string
}

func seedShowcaseForOrg(ctx context.Context, pool *pgxpool.Pool, cfg showcaseOrgConfig) error {
	var orgID string
	var commissionPct float64
	if err := pool.QueryRow(ctx, `SELECT id, "commissionPct"::float8 FROM parcel_org WHERE slug = $1`, cfg.slug).Scan(&orgID, &commissionPct); err != nil {
		return fmt.Errorf("%s org: %w", cfg.slug, err)
	}
	if commissionPct <= 0 || commissionPct >= 100 {
		commissionPct = 15
	}

	if cfg.touchProfile {
		// Walk-in desk — without it the booking form's drop-off picker
		// and the "awaiting drop-off" story have nowhere to land.
		if _, err := pool.Exec(ctx, `UPDATE parcel_org SET "acceptsWalkIn" = true, lat = $2, lng = $3,
			"locationHint" = $4, "openingHours" = $5, "updatedAt" = now() WHERE id = $1`,
			orgID, cfg.profileLat, cfg.profileLng, cfg.profileHint, cfg.profileHours); err != nil {
			return fmt.Errorf("walk-in desk: %w", err)
		}
	} else if _, err := pool.Exec(ctx, `UPDATE parcel_org SET "acceptsWalkIn" = true, "updatedAt" = now() WHERE id = $1`, orgID); err != nil {
		return fmt.Errorf("walk-in desk: %w", err)
	}

	stationIDByName := map[string]string{}
	for _, s := range cfg.stations {
		var id string
		err := pool.QueryRow(ctx, `SELECT id FROM parcel_agent WHERE "parcelOrgId" = $1 AND name = $2`, orgID, s.name).Scan(&id)
		if err != nil {
			err = pool.QueryRow(ctx, `INSERT INTO parcel_agent (id, name, msisdn, "locationHint", lat, lng, capacity, active, "parcelOrgId", "createdAt")
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, $7, now()) RETURNING id`,
				s.name, s.msisdn, s.hint, s.lat, s.lng, s.capacity, orgID).Scan(&id)
			if err != nil {
				return fmt.Errorf("station %s: %w", s.name, err)
			}
		} else {
			_, _ = pool.Exec(ctx, `UPDATE parcel_agent SET msisdn=$1, "locationHint"=$2, lat=$3, lng=$4, capacity=$5, active=true WHERE id=$6`,
				s.msisdn, s.hint, s.lat, s.lng, s.capacity, id)
		}
		stationIDByName[s.name] = id
	}

	// Zones the showcase parcels price against — same hubs the rest of
	// the demo already uses, so distance pricing lines up with the map.
	zoneIDByName := map[string]*string{}
	for _, z := range []string{"Kilimani", "Ngara", "Westlands", "CBD"} {
		var id string
		if err := pool.QueryRow(ctx, `SELECT id FROM parcel_zone WHERE name = $1`, z).Scan(&id); err == nil {
			c := id
			zoneIDByName[z] = &c
		}
	}

	holderParty := func(msisdn string) *string {
		if msisdn == "" {
			return nil
		}
		var id string
		if err := pool.QueryRow(ctx, `SELECT "partyId" FROM person WHERE msisdn = $1`, msisdn).Scan(&id); err != nil {
			return nil
		}
		return &id
	}

	// The delivery code is a credential now, so it cannot be copied from
	// the template: two seeded orgs sharing one would violate the unique
	// index added in 20261001130000_parcel_delivery_code_unique, and
	// before that index it quietly meant the same code opened two
	// different parcels. Deriving it from the parcel's own code keeps the
	// code six digits, keeps it stable across re-seeds (it is a pure
	// function of the parcel code, which is the seed's upsert key), and
	// makes it distinct per org without a counter that would drift.
	deliveryCodeFor := func(parcelCode string) string {
		var h uint32 = 2166136261 // FNV-1a offset basis
		for i := 0; i < len(parcelCode); i++ {
			h ^= uint32(parcelCode[i])
			h *= 16777619
		}
		return fmt.Sprintf("%06d", h%1000000)
	}

	remap := func(p showcaseParcel) showcaseParcel {
		out := p
		out.code = strings.Replace(p.code, "PKG-DEMO-", cfg.codePrefix, 1)
		out.ticket = strings.Replace(p.ticket, "TCK-DEMO-", cfg.ticketPrefix, 1)
		out.deliveryCode = deliveryCodeFor(out.code)
		if cfg.holderOverride != "" && out.holderMsisdn != "" {
			out.holderMsisdn = cfg.holderOverride
		}
		if out.atAgent != "" {
			// Template alternates Kilimani Hub / Ngara Counter — keep
			// the same rhythm on this org's own station pair.
			if strings.Contains(p.atAgent, "Kilimani") {
				out.atAgent = cfg.stationA
			} else {
				out.atAgent = cfg.stationB
			}
		}
		if cfg.cleanNames {
			// The ESOQO account itself is the demo — names read as real
			// customers, not seed rows. The ESHIP code prefix is what
			// marks them as seeded.
			strip := func(s string) string { return strings.TrimPrefix(s, "Demo ") }
			out.senderName, out.receiverName = strip(out.senderName), strip(out.receiverName)
			area := strings.NewReplacer(
				"Kilimani Hub", "Kabiria Hub", "Ngara Counter", "CBD Counter",
				"Ngara,", "Kawangware,", "Ngara ", "Kawangware ",
				"Fig Tree Market", "Kawangware Market", "Park Rd", "Naivasha Rd",
				"Desai Rd", "Kabiria Rd",
			)
			out.origin, out.dest = area.Replace(out.origin), area.Replace(out.dest)
		}
		return out
	}

	for _, tpl := range showcaseParcels {
		p := remap(tpl)
		platformFee := p.priceKES * commissionPct / 100
		orgEarnings := p.priceKES - platformFee
		paidAgo := p.createdDaysAgo - 0.05
		if paidAgo < 0 {
			paidAgo = 0.02
		}
		if p.paidDaysAgo != nil {
			paidAgo = *p.paidDaysAgo
		}
		codStatus := p.codStatus
		if codStatus == "" && p.codAmountKES == nil {
			codStatus = "NOT_APPLICABLE"
		} else if codStatus == "" {
			codStatus = "PENDING"
		}
		var existing string
		err := pool.QueryRow(ctx, `SELECT id FROM parcel WHERE code = $1`, p.code).Scan(&existing)
		if err == nil {
			// Refresh the tour-facing fields; never stomp money already
			// settled by a real flow, only backfill nulls.
			var agentID *string
			if p.atAgent != "" {
				if id, ok := stationIDByName[p.atAgent]; ok {
					agentID = &id
				}
			}
			_, err = pool.Exec(ctx, `UPDATE parcel SET
				"senderName"=$1, "senderMsisdn"=$2, "receiverName"=$3, "receiverMsisdn"=$4,
				"originLabel"=$5, "destinationLabel"=$6, "parcelType"=$7::"ParcelType",
				status=$8::"ParcelStatus", "originMethod"=$9::"ParcelOriginMethod",
				"currentHolderPartyId"=COALESCE($10, "currentHolderPartyId"),
				"parcelOrgId"=$11, "priceKes"=COALESCE("priceKes",$12),
				"platformFeeKes"=COALESCE("platformFeeKes",$13), "orgEarningsKes"=COALESCE("orgEarningsKes",$14),
				"paidAt"=COALESCE("paidAt", now() - ($15::float || ' days')::interval),
				"deliveryAttempts"=GREATEST("deliveryAttempts",$16), "lastAttemptReason"=COALESCE("lastAttemptReason",$17),
				"codAmountKes"=COALESCE("codAmountKes",$18), "codStatus"=CASE WHEN "codStatus"='NOT_APPLICABLE' THEN $19 ELSE "codStatus" END,
				"destinationAgentId"=COALESCE("destinationAgentId",$20::uuid),
				"intakeConfirmedAt"=CASE WHEN $8 = 'BOOKED' THEN NULL ELSE COALESCE("intakeConfirmedAt", now() - ($21::float || ' days')::interval + interval '30 minutes') END
				WHERE id=$22`,
				p.senderName, p.senderMsisdn, p.receiverName, p.receiverMsisdn,
				p.origin, p.dest, p.parcelType, p.status, p.originMethod,
				holderParty(p.holderMsisdn), orgID, p.priceKES, platformFee, orgEarnings, paidAgo,
				p.deliveryAttempts, p.lastAttemptReason, p.codAmountKES, codStatus, agentID, p.createdDaysAgo, existing)
			if err != nil {
				return fmt.Errorf("update parcel %s: %w", p.code, err)
			}
			if err := backfillShowcaseDates(ctx, pool, existing, p); err != nil {
				return err
			}
			continue
		}

		var originZoneID, destZoneID *string
		if p.originZone != "" {
			originZoneID = zoneIDByName[p.originZone]
		}
		if p.destZone != "" {
			destZoneID = zoneIDByName[p.destZone]
		}
		var agentID *string
		if p.atAgent != "" {
			if id, ok := stationIDByName[p.atAgent]; ok {
				agentID = &id
			}
		}
		var parcelID string
		err = pool.QueryRow(ctx, `
			INSERT INTO parcel (id, code, "deliveryCode", "serviceTicketNumber",
				"senderName", "senderMsisdn", "receiverName", "receiverMsisdn",
				"originLabel", "destinationLabel", "originZoneId", "destinationZoneId",
				"parcelType", "transportMode", "paymentMethod", "priceKes",
				"platformFeeKes", "orgEarningsKes", "paidAt",
				"currentHolderPartyId", status, "originMethod",
				"deliveryAttempts", "lastAttemptReason",
				"codAmountKes", "codStatus", "destinationAgentId", "parcelOrgId",
				"externalRef", "externalSource",
				"createdAt", "slaDeadlineAt", "deliveredAt", "agentHeldSince", "intakeConfirmedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
				$12::"ParcelType", 'BODA', 'MPESA_STK', $13, $14, $15,
				now() - ($16::float || ' days')::interval,
				$17, $18::"ParcelStatus", $19::"ParcelOriginMethod",
				$20, $21, $22, $23, $24, $25, NULL, NULL,
				now() - ($26::float || ' days')::interval,
				now() - ($26::float || ' days')::interval + (COALESCE($27::float, 48) || ' hours')::interval,
				CASE WHEN $28::float IS NULL THEN NULL ELSE now() - ($28::float || ' days')::interval END,
				CASE WHEN $29::float IS NULL THEN NULL ELSE now() - ($29::float || ' days')::interval END,
				CASE WHEN $18 = 'BOOKED' THEN NULL ELSE now() - ($26::float || ' days')::interval + interval '30 minutes' END)
			RETURNING id`,
			p.code, p.deliveryCode, p.ticket,
			p.senderName, p.senderMsisdn, p.receiverName, p.receiverMsisdn,
			p.origin, p.dest, originZoneID, destZoneID,
			p.parcelType, p.priceKES, platformFee, orgEarnings, paidAgo,
			holderParty(p.holderMsisdn), p.status, p.originMethod,
			p.deliveryAttempts, p.lastAttemptReason,
			p.codAmountKES, codStatus, agentID, orgID,
			p.createdDaysAgo, slaOrNil(p.slaHoursFromCreate), deliveredOrNil(p.deliveredDaysAgo), agentHeldOrNil(p.agentHeldDaysAgo)).Scan(&parcelID)
		if err != nil {
			return fmt.Errorf("insert parcel %s: %w", p.code, err)
		}
		// Custody leg so tracking / handoff history isn't a single row.
		if hp := holderParty(p.holderMsisdn); hp != nil {
			_, _ = pool.Exec(ctx, `INSERT INTO parcel_handoff (id, "parcelId", "toPartyId", status, "createdAt")
				VALUES (gen_random_uuid(), $1, $2, $3::"ParcelStatus", now() - ($4::float || ' days')::interval)`,
				parcelID, *hp, p.status, floatMin(p.createdDaysAgo, 0.3))
		}
		if p.deliveryAttempts > 0 {
			by := holderParty(p.holderMsisdn)
			byID := ""
			if by != nil {
				byID = *by
			} else {
				_ = pool.QueryRow(ctx, `SELECT "partyId" FROM person WHERE msisdn=$1`, cfg.fallbackHolder).Scan(&byID)
			}
			reason := "NOBODY_HOME"
			if p.lastAttemptReason != nil {
				reason = *p.lastAttemptReason
			}
			_, _ = pool.Exec(ctx, `INSERT INTO parcel_delivery_attempt (id, "parcelId", "byPartyId", reason, "createdAt")
				VALUES (gen_random_uuid(), $1, $2, $3, now() - ($4::float || ' days')::interval)`,
				parcelID, byID, reason, floatMin(p.createdDaysAgo, 0.5))
		}
	}

	// One active dispatch run so the dispatch board + live map have a
	// vehicle to draw, not just dots.
	var runID string
	_ = pool.QueryRow(ctx, `SELECT id FROM parcel_shipment WHERE "parcelOrgId"=$1 AND status='DEPARTED' LIMIT 1`, orgID).Scan(&runID)
	if runID == "" {
		stationA := stationIDByName[cfg.stationA]
		stationB := stationIDByName[cfg.stationB]
		err := pool.QueryRow(ctx, `INSERT INTO parcel_shipment (id, "parcelOrgId", "vehiclePlate", "vehicleType",
			"originStationId", "destinationStationId", status, notes, "currentLat", "currentLng", "currentAt", "createdAt",
			"originLabel", "destinationLabel")
			VALUES (gen_random_uuid(), $1, $2, 'VAN', $3, $4, 'DEPARTED',
			$5, $6, $7, now(), now(),
			COALESCE((SELECT name FROM parcel_agent WHERE id = $3), 'Origin'),
			COALESCE((SELECT name FROM parcel_agent WHERE id = $4), 'Destination')) RETURNING id`,
			orgID, cfg.dispatchPlate, stationA, stationB, cfg.dispatchNotes, cfg.dispatchLat, cfg.dispatchLng).Scan(&runID)
		if err != nil {
			return fmt.Errorf("dispatch: %w", err)
		}
		var crewStaff, receiverStaff string
		_ = pool.QueryRow(ctx, `SELECT id FROM parcel_org_staff WHERE "orgId"=$1 AND name=$2`, orgID, cfg.crewName).Scan(&crewStaff)
		_ = pool.QueryRow(ctx, `SELECT id FROM parcel_org_staff WHERE "orgId"=$1 AND name=$2`, orgID, cfg.receiverName).Scan(&receiverStaff)
		_, _ = pool.Exec(ctx, `INSERT INTO parcel_run_crew (id, "runId", name, role, "staffId")
			VALUES (gen_random_uuid(), $1, $2, 'DRIVER', $3) ON CONFLICT DO NOTHING`, runID, cfg.crewName, nullableUUID(crewStaff))
		_, _ = pool.Exec(ctx, `INSERT INTO parcel_run_receiver (id, "runId", name, "staffId")
			VALUES (gen_random_uuid(), $1, $2, $3) ON CONFLICT DO NOTHING`, runID, cfg.receiverName, nullableUUID(receiverStaff))
	}
	if runID != "" {
		_, _ = pool.Exec(ctx, `INSERT INTO parcel_run_ping (id, "runId", lat, lng, at)
			VALUES (gen_random_uuid(), $1, $2, $3, now()),
			       (gen_random_uuid(), $1, $2, $3, now() - interval '12 minutes')`, runID, cfg.dispatchLat, cfg.dispatchLng)
	}

	// Label stock so the counter's label picker isn't empty — and so
	// the register reads like a lived-in pad rather than a wall of
	// identical blanks. Two stickers are written on (item + sender +
	// receiver, filled via the field entry just like a desk would), one
	// is bound to a showcase parcel, one is withdrawn, and the rest
	// stay blank for the counter flow to spend.
	labelFills := []struct {
		suffix, item, destination, sender, receiver string
	}{
		{"01", "Shoes, size 42", "Nakuru CBD — West Side Mall", "Wanjiru Muthoni", "Brian Ochieng"},
		{"02", "Laptop charger & power bank", "Thika Town — Kenol", "Kevin Mwangi", "Esther Kamau"},
	}
	for i, f := range labelFills {
		code := fmt.Sprintf("%s%s", cfg.labelPrefix, f.suffix)
		_, _ = pool.Exec(ctx, `INSERT INTO parcel_label_stock
			(id, code, "parcelOrgId", "createdAt", "itemDescription", destination,
			 "senderName", "senderMsisdn", "receiverName", "receiverMsisdn", "infoAttachedAt")
			VALUES (gen_random_uuid(), $1, $2, now() - interval '4 days',
			        $3, $4, $5, $6, $7, $8, now() - interval '3 days')
			ON CONFLICT (code) DO UPDATE SET
				"itemDescription" = excluded."itemDescription",
				destination = excluded.destination,
				"senderName" = excluded."senderName",
				"receiverName" = excluded."receiverName",
				"infoAttachedAt" = excluded."infoAttachedAt"
			WHERE parcel_label_stock."usedAt" IS NULL AND parcel_label_stock."voidedAt" IS NULL`,
			code, orgID, f.item, f.destination, f.sender,
			fmt.Sprintf("+25472240%d", 100+i), f.receiver, fmt.Sprintf("+25472240%d", 200+i))
	}
	for i := 3; i <= 5; i++ {
		code := fmt.Sprintf("%s%02d", cfg.labelPrefix, i)
		_, _ = pool.Exec(ctx, `INSERT INTO parcel_label_stock (id, code, "parcelOrgId", "createdAt")
			VALUES (gen_random_uuid(), $1, $2, now() - ($3::float || ' days')::interval)
			ON CONFLICT (code) DO NOTHING`, code, orgID, float64(i-1))
	}
	// A sticker that walked away — withdrawn so a counter scan answers
	// "this pad was retired" instead of silently spending dead stock.
	{
		code := fmt.Sprintf("%s06", cfg.labelPrefix)
		_, _ = pool.Exec(ctx, `INSERT INTO parcel_label_stock
			(id, code, "parcelOrgId", "createdAt", "voidedAt", "voidedReason")
			VALUES (gen_random_uuid(), $1, $2, now() - interval '5 days',
			        now() - interval '1 day', 'Misprinted — address ran off the sticker')
			ON CONFLICT (code) DO UPDATE SET
				"voidedAt" = excluded."voidedAt",
				"voidedReason" = excluded."voidedReason"
			WHERE parcel_label_stock."usedAt" IS NULL AND parcel_label_stock."voidedAt" IS NULL`, code, orgID)
	}
	// One label already spent on the org's own BOOKED showcase parcel,
	// so the "Used" tab and the spent tile have a row to point at.
	{
		code := fmt.Sprintf("%s07", cfg.labelPrefix)
		_, _ = pool.Exec(ctx, `INSERT INTO parcel_label_stock (id, code, "parcelOrgId", "createdAt")
			VALUES (gen_random_uuid(), $1, $2, now() - interval '6 days')
			ON CONFLICT (code) DO NOTHING`, code, orgID)
		_, _ = pool.Exec(ctx, `UPDATE parcel_label_stock
			SET "usedAt" = now() - interval '5 days',
			    "usedByParcelId" = (SELECT id FROM parcel WHERE code = $1)
			WHERE code = $2 AND "parcelOrgId" = $3 AND "usedAt" IS NULL`,
			cfg.codePrefix+"101", code, orgID)
	}

	fmt.Printf("  parcel showcase: %s (%d parcels, 2 stations, 1 active run)\n", cfg.slug, len(showcaseParcels))
	return nil
}

func backfillShowcaseDates(ctx context.Context, pool *pgxpool.Pool, parcelID string, p showcaseParcel) error {
	_, err := pool.Exec(ctx, `UPDATE parcel SET
		"createdAt" = CASE WHEN "createdAt" > now() - ($1::float || ' days')::interval - interval '1 hour'
			THEN now() - ($1::float || ' days')::interval ELSE "createdAt" END,
		"deliveredAt" = CASE WHEN $2::float IS NOT NULL AND "deliveredAt" IS NULL
			THEN now() - ($2::float || ' days')::interval ELSE "deliveredAt" END,
		"agentHeldSince" = CASE WHEN $3::float IS NOT NULL AND "agentHeldSince" IS NULL
			THEN now() - ($3::float || ' days')::interval ELSE "agentHeldSince" END
		WHERE id = $4`, p.createdDaysAgo, deliveredOrNil(p.deliveredDaysAgo), agentHeldOrNil(p.agentHeldDaysAgo), parcelID)
	return err
}

func slaOrNil(v *float64) *float64       { return v }
func deliveredOrNil(v *float64) *float64 { return v }
func agentHeldOrNil(v *float64) *float64 { return v }

func floatMin(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func nullableUUID(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
