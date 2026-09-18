// Package seed (demo_dispatch_fleet.go) — a full live-dispatch board.
//
// ESOQO Shippers runs one van in the parcel showcase; a one-vehicle
// board teaches a prospect nothing about tracking a fleet. This file
// puts ~15 runs on its board — short hops around Nairobi, medium legs
// to Thika, inter-county runs to Nakuru, and long-haul trunks to
// Mombasa, Kisumu and Eldoret — each with a genuine travelled trail
// (not a straight origin→destination line), crew with callable phone
// numbers, dwell clusters where the vehicle actually stopped, and
// staggered last-seen times so the board shows the full range from
// "Active now" to cold.
//
// Trails are deterministic interpolations of hand-listed corridor
// waypoints that follow the real roads (Ngong Rd / Waiyaki Way /
// Northern Bypass / Nairobi–Nakuru highway / Thika Rd), with a small
// deterministic jitter so the line reads as driven GPS, not a ruler.
// Timestamps spread so segment speeds vary naturally — the web map
// colours trail segments by measured speed, and slow city crawls vs
// highway stretches fall out of the data, not out of a status flag.
//
// Idempotent by vehicle plate per org: re-running replaces the trail
// and current position rather than duplicating runs.
package seed

import (
	"context"
	"fmt"
	"math"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type fleetCrewSpec struct {
	name, msisdn, role string
	staffName          string // parcel_org_staff name to link, "" = free-text crew
}

type fleetRunSpec struct {
	plate, vehicleType string
	origin, dest       string // station names on this org
	notes              string
	corridor           string
	progress           float64 // 0..1 of the corridor travelled
	pings              int
	startedMinsAgo     float64
	lastSeenMinsAgo    float64
	dwellAt            []float64 // corridor fractions where a stop happened
	dwellMins          float64
	crew               []fleetCrewSpec
	receivers          []string
	status             string // ACTIVE, ARRIVED, CANCELLED
	arrivedMinsAgo     float64
}

// corridorWaypoints follow the driven roads, origin → destination.
// Coordinates are approximate road-following points, not survey data —
// close enough that the trail sits on the highway at map zoom.
var corridorWaypoints = map[string][][2]float64{
	"kabiria-cbd": {
		{-1.3121, 36.7446}, {-1.3060, 36.7560}, {-1.3005, 36.7680},
		{-1.2960, 36.7820}, {-1.2915, 36.7960}, {-1.2870, 36.8080},
		{-1.2833, 36.8167},
	},
	"cbd-thika": {
		{-1.2833, 36.8167}, {-1.2500, 36.8550}, {-1.2200, 36.8900},
		{-1.1900, 36.9250}, {-1.1600, 36.9600}, {-1.1200, 37.0000},
		{-1.0800, 37.0350}, {-1.0332, 37.0693},
	},
	"kabiria-nakuru": {
		{-1.3121, 36.7446}, {-1.2800, 36.7300}, {-1.2300, 36.6900},
		{-1.1700, 36.6200}, {-1.1100, 36.5500}, {-1.0600, 36.5000},
		{-1.0000, 36.4500}, {-0.9000, 36.4300}, {-0.7200, 36.4300},
		{-0.5500, 36.3500}, {-0.4000, 36.2000}, {-0.3031, 36.0800},
	},
	"cbd-nakuru": {
		{-1.2833, 36.8167}, {-1.2600, 36.7600}, {-1.2300, 36.6900},
		{-1.1700, 36.6200}, {-1.1100, 36.5500}, {-1.0600, 36.5000},
		{-1.0000, 36.4500}, {-0.9000, 36.4300}, {-0.7200, 36.4300},
		{-0.5500, 36.3500}, {-0.4000, 36.2000}, {-0.3031, 36.0800},
	},
	// Long-haul trunks. These follow the real road towns — Mombasa Rd
	// down to the coast, the Nakuru highway on to Kisumu and Eldoret —
	// so the ~5-hour legs read as driven inter-county routes, not a
	// ruler shot across the map.
	"kabiria-mombasa": {
		{-1.3121, 36.7446}, {-1.2900, 36.7700}, {-1.2833, 36.8167},
		{-1.3090, 36.8340}, {-1.3570, 36.8950}, {-1.4760, 37.0410},
		{-1.7160, 37.2440}, {-2.0330, 37.4330}, {-2.3800, 37.8400},
		{-2.4700, 38.2100}, {-3.0400, 38.4900}, {-3.4000, 38.7700},
		{-3.6500, 39.3000}, {-4.0435, 39.6682},
	},
	"nakuru-kisumu": {
		{-0.3031, 36.0800}, {-0.1900, 35.8800}, {-0.3500, 35.5000},
		{-0.3667, 35.2833}, {-0.2500, 35.1600}, {-0.1500, 35.2000},
		{-0.1300, 34.9700}, {-0.0917, 34.7680},
	},
	"nakuru-eldoret": {
		{-0.3031, 36.0800}, {-0.1600, 36.0800}, {0.0500, 35.9000},
		{0.2800, 35.4000}, {0.4330, 35.2800}, {0.5143, 35.2698},
	},
}

func init() {
	// Reverse + combined corridors derived once so the table above
	// stays the single source of corridor shapes.
	reverse := func(in [][2]float64) [][2]float64 {
		out := make([][2]float64, len(in))
		for i, p := range in {
			out[len(in)-1-i] = p
		}
		return out
	}
	corridorWaypoints["cbd-kabiria"] = reverse(corridorWaypoints["kabiria-cbd"])
	corridorWaypoints["thika-cbd"] = reverse(corridorWaypoints["cbd-thika"])
	corridorWaypoints["nakuru-kabiria"] = reverse(corridorWaypoints["kabiria-nakuru"])
	corridorWaypoints["nakuru-cbd"] = reverse(corridorWaypoints["cbd-nakuru"])
	corridorWaypoints["mombasa-kabiria"] = reverse(corridorWaypoints["kabiria-mombasa"])
	corridorWaypoints["kisumu-nakuru"] = reverse(corridorWaypoints["nakuru-kisumu"])
	corridorWaypoints["eldoret-nakuru"] = reverse(corridorWaypoints["nakuru-eldoret"])
	// Kabiria → Thika via the CBD join.
	joined := append(append([][2]float64{}, corridorWaypoints["kabiria-cbd"]...), corridorWaypoints["cbd-thika"][1:]...)
	corridorWaypoints["kabiria-thika"] = joined
	corridorWaypoints["thika-kabiria"] = reverse(joined)
	// Long-haul all the way from the hub: Kabiria → Nakuru → Kisumu and
	// Kabiria → Nakuru → Eldoret reuse the up-country trunk so the whole
	// route is the same real highway, once.
	kisumu := append(append([][2]float64{}, corridorWaypoints["kabiria-nakuru"]...), corridorWaypoints["nakuru-kisumu"][1:]...)
	corridorWaypoints["kabiria-kisumu"] = kisumu
	corridorWaypoints["kisumu-kabiria"] = reverse(kisumu)
	eldoret := append(append([][2]float64{}, corridorWaypoints["kabiria-nakuru"]...), corridorWaypoints["nakuru-eldoret"][1:]...)
	corridorWaypoints["kabiria-eldoret"] = eldoret
	corridorWaypoints["eldoret-kabiria"] = reverse(eldoret)
}

var eshipFleetRuns = []fleetRunSpec{
	{
		plate: "KDJ 508S", vehicleType: "VAN",
		origin: "ESOQO Shippers – Kabiria Hub", dest: "ESOQO Shippers – CBD Counter",
		notes: "Morning run — Kabiria to CBD", corridor: "kabiria-cbd",
		progress: 0.55, pings: 16, startedMinsAgo: 48, lastSeenMinsAgo: 1,
		crew: []fleetCrewSpec{
			{name: "Kiki Viki", msisdn: "+254728387694", role: "DRIVER", staffName: "Kiki Viki"},
			{name: "Samuel Kariuki", msisdn: "+254722114401", role: "TOUT", staffName: "Samuel Kariuki"},
		},
		receivers: []string{"Kiki Viki"}, status: "ACTIVE",
	},
	{
		plate: "KDK 214T", vehicleType: "TRUCK",
		origin: "ESOQO Shippers – Kabiria Hub", dest: "ESOQO Shippers – Nakuru Hub",
		notes: "Up-country trunk — 40 crates, weighbridge papers aboard", corridor: "kabiria-nakuru",
		progress: 0.62, pings: 30, startedMinsAgo: 300, lastSeenMinsAgo: 8,
		dwellAt: []float64{0.42}, dwellMins: 18,
		crew: []fleetCrewSpec{
			{name: "Peter Njoroge", msisdn: "+254722114402", role: "DRIVER", staffName: "Peter Njoroge"},
			{name: "Mary Wambui", msisdn: "+254722114403", role: "TOUT", staffName: "Mary Wambui"},
			{name: "John Kiprop", msisdn: "+254722114404", role: "LOADER", staffName: "John Kiprop"},
		},
		receivers: []string{"Nakuru receiving team"}, status: "ACTIVE",
	},
	{
		plate: "KDL 639P", vehicleType: "BUS",
		origin: "ESOQO Shippers – CBD Counter", dest: "ESOQO Shippers – Thika Counter",
		notes: "Parcels in the boot — Garden Estate drop first", corridor: "cbd-thika",
		progress: 0.8, pings: 20, startedMinsAgo: 95, lastSeenMinsAgo: 3,
		crew: []fleetCrewSpec{
			{name: "Grace Achieng", msisdn: "+254722114405", role: "DRIVER", staffName: "Grace Achieng"},
			{name: "Daniel Mutua", msisdn: "+254722114406", role: "TOUT", staffName: "Daniel Mutua"},
		},
		receivers: []string{"Thika receiving team"}, status: "ACTIVE",
	},
	{
		plate: "KDM 102B", vehicleType: "VAN",
		origin: "ESOQO Shippers – CBD Counter", dest: "ESOQO Shippers – Kabiria Hub",
		notes: "Return leg — empties and COD envelopes back", corridor: "cbd-kabiria",
		progress: 0.3, pings: 12, startedMinsAgo: 40, lastSeenMinsAgo: 19,
		crew: []fleetCrewSpec{
			{name: "Faith Nyambura", msisdn: "+254722114407", role: "DRIVER", staffName: "Faith Nyambura"},
		},
		receivers: []string{"Kiki Viki"}, status: "ACTIVE",
	},
	{
		plate: "KDN 771C", vehicleType: "MOTORBIKE",
		origin: "ESOQO Shippers – Kabiria Hub", dest: "ESOQO Shippers – CBD Counter",
		notes: "Express envelopes — CBD lawyers' packets", corridor: "kabiria-cbd",
		progress: 0.9, pings: 14, startedMinsAgo: 32, lastSeenMinsAgo: 0.5,
		crew: []fleetCrewSpec{
			{name: "Kevin Barasa", msisdn: "+254722114408", role: "DRIVER", staffName: "Kevin Barasa"},
		},
		receivers: []string{"CBD front desk"}, status: "ACTIVE",
	},
	{
		plate: "KDP 336F", vehicleType: "TRUCK",
		origin: "ESOQO Shippers – Nakuru Hub", dest: "ESOQO Shippers – Kabiria Hub",
		notes: "Down-country — farm inputs for Dagoretti agrodealers", corridor: "nakuru-kabiria",
		progress: 0.25, pings: 26, startedMinsAgo: 180, lastSeenMinsAgo: 42,
		dwellAt: []float64{0.14}, dwellMins: 22,
		crew: []fleetCrewSpec{
			{name: "Alice Moraa", msisdn: "+254722114409", role: "DRIVER", staffName: "Alice Moraa"},
			{name: "Tom Ochieng", msisdn: "+254722114410", role: "LOADER", staffName: "Tom Ochieng"},
		},
		receivers: []string{"Kiki Viki"}, status: "ACTIVE",
	},
	{
		plate: "KDQ 905H", vehicleType: "PICKUP",
		origin: "ESOQO Shippers – Thika Counter", dest: "ESOQO Shippers – CBD Counter",
		notes: "Blue Post pickup consolidated", corridor: "thika-cbd",
		progress: 0.5, pings: 16, startedMinsAgo: 70, lastSeenMinsAgo: 26,
		crew: []fleetCrewSpec{
			{name: "Brian Kimani", msisdn: "+254722114411", role: "DRIVER", staffName: "Brian Kimani"},
			{name: "Susan Njoki", msisdn: "+254722114412", role: "TOUT", staffName: "Susan Njoki"},
		},
		receivers: []string{"CBD front desk"}, status: "ACTIVE",
	},
	{
		plate: "KDR 118J", vehicleType: "VAN",
		origin: "ESOQO Shippers – Kabiria Hub", dest: "ESOQO Shippers – Thika Counter",
		notes: "Cross-town — Makadara shops' restock", corridor: "kabiria-thika",
		progress: 0.45, pings: 22, startedMinsAgo: 120, lastSeenMinsAgo: 12,
		dwellAt: []float64{0.3}, dwellMins: 14,
		crew: []fleetCrewSpec{
			{name: "Dennis Kibet", msisdn: "+254722114413", role: "DRIVER", staffName: "Dennis Kibet"},
			{name: "Ann Wanjiru", msisdn: "+254722114414", role: "TOUT", staffName: "Ann Wanjiru"},
		},
		receivers: []string{"Thika receiving team"}, status: "ACTIVE",
	},
	{
		plate: "KDS 452K", vehicleType: "VAN",
		origin: "ESOQO Shippers – Kabiria Hub", dest: "ESOQO Shippers – CBD Counter",
		notes: "Dawn run — arrived before the counters opened", corridor: "kabiria-cbd",
		progress: 1, pings: 15, startedMinsAgo: 200, lastSeenMinsAgo: 35,
		crew: []fleetCrewSpec{
			{name: "George Kamau", msisdn: "+254722114415", role: "DRIVER", staffName: "George Kamau"},
		},
		receivers: []string{"CBD front desk"}, status: "ARRIVED", arrivedMinsAgo: 35,
	},
	{
		plate: "KDT 709M", vehicleType: "BUS",
		origin: "ESOQO Shippers – CBD Counter", dest: "ESOQO Shippers – Thika Counter",
		notes: "Last night's boot parcels — signed in full", corridor: "cbd-thika",
		progress: 1, pings: 18, startedMinsAgo: 700, lastSeenMinsAgo: 130,
		crew: []fleetCrewSpec{
			{name: "Irene Nyakundi", msisdn: "+254722114416", role: "DRIVER", staffName: "Irene Nyakundi"},
			{name: "Paul Mwangi", msisdn: "+254722114417", role: "TOUT", staffName: "Paul Mwangi"},
		},
		receivers: []string{"Thika receiving team"}, status: "ARRIVED", arrivedMinsAgo: 130,
	},
	{
		plate: "KDU 331N", vehicleType: "PICKUP",
		origin: "ESOQO Shippers – Thika Counter", dest: "ESOQO Shippers – Kabiria Hub",
		notes: "Called off — receiver asked to hold till Monday", corridor: "thika-kabiria",
		progress: 0, pings: 0, startedMinsAgo: 300, lastSeenMinsAgo: 300,
		crew: []fleetCrewSpec{
			{name: "Stephen Ouma", msisdn: "+254722114418", role: "DRIVER", staffName: "Stephen Ouma"},
		},
		receivers: []string{"Kiki Viki"}, status: "CANCELLED",
	},
	// ── Long-haul trunks — the "more long-distance" half of the
	// complaint this file already answered for the short hops. Real
	// inter-county legs with weighbridge dwells and rotating crews,
	// so the board has 400 km journeys to talk about, not just
	// Kabiria ↔ CBD.
	{
		plate: "KEL 266A", vehicleType: "TRUCK",
		origin: "ESOQO Shippers – Kabiria Hub", dest: "ESOQO Shippers – Mombasa Depot",
		notes: "Mombasa trunk — 480 km, manifests aboard, weighbridge at Athi River", corridor: "kabiria-mombasa",
		progress: 0.42, pings: 54, startedMinsAgo: 1500, lastSeenMinsAgo: 9,
		dwellAt: []float64{0.2}, dwellMins: 35,
		crew: []fleetCrewSpec{
			{name: "Peter Njoroge", msisdn: "+254722114402", role: "DRIVER", staffName: "Peter Njoroge"},
			{name: "Mary Wambui", msisdn: "+254722114403", role: "TOUT", staffName: "Mary Wambui"},
			{name: "John Kiprop", msisdn: "+254722114404", role: "LOADER", staffName: "John Kiprop"},
		},
		receivers: []string{"Mombasa receiving team"}, status: "ACTIVE",
	},
	{
		plate: "KEM 088Z", vehicleType: "TRUCK",
		origin: "ESOQO Shippers – Kabiria Hub", dest: "ESOQO Shippers – Kisumu Depot",
		notes: "Kisumu trunk — fish boxes travelling empty", corridor: "kabiria-kisumu",
		progress: 0.55, pings: 46, startedMinsAgo: 620, lastSeenMinsAgo: 14,
		dwellAt: []float64{0.42}, dwellMins: 22,
		crew: []fleetCrewSpec{
			{name: "Alice Moraa", msisdn: "+254722114409", role: "DRIVER", staffName: "Alice Moraa"},
			{name: "Tom Ochieng", msisdn: "+254722114410", role: "LOADER", staffName: "Tom Ochieng"},
		},
		receivers: []string{"Kisumu receiving team"}, status: "ACTIVE",
	},
	{
		plate: "KEP 663X", vehicleType: "VAN",
		origin: "ESOQO Shippers – Kabiria Hub", dest: "ESOQO Shippers – Eldoret Depot",
		notes: "Eldoret restock — retail parcels for the Rift", corridor: "kabiria-eldoret",
		progress: 0.28, pings: 34, startedMinsAgo: 300, lastSeenMinsAgo: 22,
		crew: []fleetCrewSpec{
			{name: "Dennis Kibet", msisdn: "+254722114413", role: "DRIVER", staffName: "Dennis Kibet"},
			{name: "Ann Wanjiru", msisdn: "+254722114414", role: "TOUT", staffName: "Ann Wanjiru"},
		},
		receivers: []string{"Eldoret receiving team"}, status: "ACTIVE",
	},
	{
		plate: "KEQ 410C", vehicleType: "PICKUP",
		origin: "ESOQO Shippers – Nakuru Hub", dest: "ESOQO Shippers – CBD Counter",
		notes: "Down-country — Nakuru mails consolidated once full", corridor: "nakuru-cbd",
		progress: 0.65, pings: 24, startedMinsAgo: 160, lastSeenMinsAgo: 5,
		crew: []fleetCrewSpec{
			{name: "Irene Nyakundi", msisdn: "+254722114416", role: "DRIVER", staffName: "Irene Nyakundi"},
			{name: "Paul Mwangi", msisdn: "+254722114417", role: "TOUT", staffName: "Paul Mwangi"},
		},
		receivers: []string{"CBD front desk"}, status: "ACTIVE",
	},
}

// corridorPoint interpolates the corridor polyline by arc fraction,
// with a small deterministic jitter so the trail reads as driven GPS.
func corridorPoint(corridor string, f float64, seed int) (lat, lng float64) {
	pts := corridorWaypoints[corridor]
	if len(pts) == 0 {
		return -1.2864, 36.8172
	}
	if f < 0 {
		f = 0
	}
	if f > 1 {
		f = 1
	}
	// Arc-length parametrisation over the waypoint legs.
	total := 0.0
	segLen := make([]float64, len(pts)-1)
	for i := 0; i+1 < len(pts); i++ {
		dLat := (pts[i+1][0] - pts[i][0]) * 111.32
		dLng := (pts[i+1][1] - pts[i][1]) * 111.32 * math.Cos(pts[i][0]*math.Pi/180)
		segLen[i] = math.Hypot(dLat, dLng)
		total += segLen[i]
	}
	target := f * total
	for i := 0; i+1 < len(pts); i++ {
		if target <= segLen[i] || i == len(pts)-2 {
			t := 0.0
			if segLen[i] > 0 {
				t = target / segLen[i]
			}
			lat = pts[i][0] + (pts[i+1][0]-pts[i][0])*t
			lng = pts[i][1] + (pts[i+1][1]-pts[i][1])*t
			break
		}
		target -= segLen[i]
	}
	jitter := func(n int) float64 { return (float64((seed*37+n*53)%11) - 5) * 0.00045 }
	return lat + jitter(3), lng + jitter(7)
}

// SeedDemoDispatchFleet puts the full tracking board on ESOQO Shippers:
// extra up-country stations plus ~10 routed runs. Safe to re-run —
// matched by (org, plate); trails are replaced, never appended to.
func SeedDemoDispatchFleet(ctx context.Context, pool *pgxpool.Pool) error {
	slug := OrgSlug("esoqo-shippers")
	var orgID string
	if err := pool.QueryRow(ctx, `SELECT id FROM parcel_org WHERE slug = $1`, slug).Scan(&orgID); err != nil {
		return fmt.Errorf("%s org: %w", slug, err)
	}

	extraStations := []stationDef{
		{"ESOQO Shippers – Thika Counter", "+254728387694", "Thika town — Commercial St, near the stage", -1.0332, 37.0693, 60},
		{"ESOQO Shippers – Nakuru Hub", "+254728387694", "Nakuru town — Kenyatta Ave, next to the main stage", -0.3031, 36.0800, 120},
		// Long-haul termini — the deep-country runs in eshipFleetRuns
		// land on real stations so the board renders an origin →
		// destination, never a nameless marker at the end of a 400 km
		// trail.
		{"ESOQO Shippers – Mombasa Depot", "+254728387694", "Mombasa — Nyali industrial area, off Jomo Kenyatta Ave", -4.0435, 39.6682, 200},
		{"ESOQO Shippers – Kisumu Depot", "+254728387694", "Kisumu — Oginga Odinga St, the stage side", -0.0917, 34.7680, 150},
		{"ESOQO Shippers – Eldoret Depot", "+254728387694", "Eldoret — Uganda Rd, opposite the dairy", 0.5143, 35.2698, 150},
	}
	stationIDByName := map[string]string{}
	allStations := append([]stationDef{
		{"ESOQO Shippers – Kabiria Hub", "+254728387694", "Kabiria Cabby Centre — ground floor", -1.3121, 36.7446, 100},
		{"ESOQO Shippers – CBD Counter", "+254728387694", "CBD — Tom Mboya St, Odeon side", -1.2833, 36.8167, 60},
	}, extraStations...)
	for _, s := range allStations {
		var id string
		err := pool.QueryRow(ctx, `SELECT id FROM parcel_agent WHERE "parcelOrgId" = $1 AND name = $2`, orgID, s.name).Scan(&id)
		if err != nil {
			err = pool.QueryRow(ctx, `INSERT INTO parcel_agent (id, name, msisdn, "locationHint", lat, lng, capacity, active, "parcelOrgId", "createdAt")
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, $7, now()) RETURNING id`,
				s.name, s.msisdn, s.hint, s.lat, s.lng, s.capacity, orgID).Scan(&id)
			if err != nil {
				return fmt.Errorf("station %s: %w", s.name, err)
			}
		}
		stationIDByName[s.name] = id
	}

	staffIDByName := map[string]string{}
	rows, err := pool.Query(ctx, `SELECT id, name FROM parcel_org_staff WHERE "orgId" = $1 AND active`, orgID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			rows.Close()
			return err
		}
		staffIDByName[name] = id
	}
	rows.Close()

	for _, r := range eshipFleetRuns {
		if _, ok := corridorWaypoints[r.corridor]; !ok {
			return fmt.Errorf("run %s: unknown corridor %s", r.plate, r.corridor)
		}
		var dispatchID string
		err := pool.QueryRow(ctx, `SELECT id FROM parcel_dispatch WHERE "parcelOrgId" = $1 AND "vehiclePlate" = $2`, orgID, r.plate).Scan(&dispatchID)
		if err != nil {
			originID := stationIDByName[r.origin]
			destID := stationIDByName[r.dest]
			err = pool.QueryRow(ctx, `INSERT INTO parcel_dispatch (id, "parcelOrgId", "vehiclePlate", "vehicleType",
				"originStationId", "destinationStationId", status, notes, "createdAt")
				VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now() - ($8::float || ' minutes')::interval) RETURNING id`,
				orgID, r.plate, r.vehicleType, nullableStr(originID), nullableStr(destID),
				r.status, nullableStr(r.notes), r.startedMinsAgo).Scan(&dispatchID)
			if err != nil {
				return fmt.Errorf("dispatch %s: %w", r.plate, err)
			}
		}
		// Crew and receiving team are refreshed every run so the board
		// shows the current roster story, not the first seed's.
		if _, err := pool.Exec(ctx, `DELETE FROM parcel_dispatch_crew WHERE "dispatchId" = $1`, dispatchID); err != nil {
			return fmt.Errorf("crew clear %s: %w", r.plate, err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM parcel_dispatch_receiver WHERE "dispatchId" = $1`, dispatchID); err != nil {
			return fmt.Errorf("receivers clear %s: %w", r.plate, err)
		}
		for _, c := range r.crew {
			role, custom := sanitizeCrewRole(c.role)
			var staffID *string
			if c.staffName != "" {
				if id, ok := staffIDByName[c.staffName]; ok {
					staffID = &id
				}
			}
			if _, err := pool.Exec(ctx, `INSERT INTO parcel_dispatch_crew ("dispatchId", name, msisdn, role, "customRole", "staffId")
				VALUES ($1, $2, $3, $4, $5, $6)`, dispatchID, c.name, nullableStr(c.msisdn), role, custom, staffID); err != nil {
				return fmt.Errorf("crew %s: %w", c.name, err)
			}
		}
		for _, rcv := range r.receivers {
			var staffID *string
			if id, ok := staffIDByName[rcv]; ok {
				staffID = &id
			}
			if _, err := pool.Exec(ctx, `INSERT INTO parcel_dispatch_receiver ("dispatchId", name, "staffId")
				VALUES ($1, $2, $3)`, dispatchID, rcv, staffID); err != nil {
				return fmt.Errorf("receiver %s: %w", rcv, err)
			}
		}
		// Replace the trail wholesale — re-seeding replays the same
		// journey rather than stacking a second one on top.
		if _, err := pool.Exec(ctx, `DELETE FROM parcel_dispatch_ping WHERE "dispatchId" = $1`, dispatchID); err != nil {
			return fmt.Errorf("clear trail %s: %w", r.plate, err)
		}
		type ping struct{ lat, lng, minsAgo float64 }
		var trail []ping
		if r.pings > 0 && r.progress > 0 {
			n := r.pings
			elapsed := r.startedMinsAgo - r.lastSeenMinsAgo
			if elapsed < 5 {
				elapsed = 5
			}
			appliedDwell := map[float64]bool{}
			for i := 0; i < n; i++ {
				f := r.progress * float64(i) / float64(n-1)
				// Dwell clusters: everything past a stop shifts later by
				// the stop length, and a second ping at the stop point
				// records the standstill itself.
				shift := 0.0
				for _, d := range r.dwellAt {
					if f > d && !appliedDwell[d] && i > 0 {
						prevF := r.progress * float64(i-1) / float64(n-1)
						if prevF <= d {
							lat, lng := corridorPoint(r.corridor, d, 900+i)
							trail = append(trail, ping{lat, lng, r.startedMinsAgo - (elapsed * d / r.progress) - r.dwellMins/2})
							appliedDwell[d] = true
						}
					}
					if f > d {
						shift += r.dwellMins
					}
				}
				lat, lng := corridorPoint(r.corridor, f, i)
				trail = append(trail, ping{lat, lng, r.startedMinsAgo - elapsed*(f/r.progress) - shift})
				_ = shift
			}
		}
		for _, p := range trail {
			if p.minsAgo < 0 {
				p.minsAgo = 0
			}
			if _, err := pool.Exec(ctx, `INSERT INTO parcel_dispatch_ping ("dispatchId", lat, lng, at)
				VALUES ($1, $2, $3, now() - ($4::float || ' minutes')::interval)`,
				dispatchID, p.lat, p.lng, p.minsAgo); err != nil {
				return fmt.Errorf("ping %s: %w", r.plate, err)
			}
		}
		curLat, curLng := corridorPoint(r.corridor, r.progress, 999)
		switch r.status {
		case "ARRIVED":
			if _, err := pool.Exec(ctx, `UPDATE parcel_dispatch SET status='ARRIVED',
				"currentLat"=$2, "currentLng"=$3, "currentAt"=now() - ($4::float || ' minutes')::interval,
				"arrivedAt"=now() - ($5::float || ' minutes')::interval,
				"receivedBy"=COALESCE("receivedBy", (SELECT string_agg(name, ', ') FROM parcel_dispatch_receiver WHERE "dispatchId"=$1))
				WHERE id=$1`, dispatchID, curLat, curLng, r.lastSeenMinsAgo, r.arrivedMinsAgo); err != nil {
				return fmt.Errorf("arrive %s: %w", r.plate, err)
			}
		case "CANCELLED":
			_, _ = pool.Exec(ctx, `UPDATE parcel_dispatch SET status='CANCELLED', "currentLat"=NULL, "currentLng"=NULL, "currentAt"=NULL WHERE id=$1`, dispatchID)
		default:
			if _, err := pool.Exec(ctx, `UPDATE parcel_dispatch SET status='ACTIVE',
				"currentLat"=$2, "currentLng"=$3, "currentAt"=now() - ($4::float || ' minutes')::interval,
				"arrivedAt"=NULL, "receivedBy"=NULL WHERE id=$1`,
				dispatchID, curLat, curLng, r.lastSeenMinsAgo); err != nil {
				return fmt.Errorf("position %s: %w", r.plate, err)
			}
		}
	}

	fmt.Printf("  dispatch fleet: esoqo-shippers (%d runs)\n", len(eshipFleetRuns))
	return nil
}

func nullableStr(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

func sanitizeCrewRole(role string) (string, *string) {
	switch strings.ToUpper(strings.TrimSpace(role)) {
	case "DRIVER", "TOUT", "LOADER":
		return strings.ToUpper(strings.TrimSpace(role)), nil
	default:
		custom := strings.TrimSpace(role)
		if custom == "" {
			return "OTHER", nil
		}
		return "OTHER", &custom
	}
}
