package seed

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
)

// SeedDemoTicketing ports seed-demo.ts — a transport company, an events
// company, published listings with real future schedules (seats
// generated for every seated class, same as createSchedule's own
// logic), one demo buyer account, and a PIN login per ticketing staff
// role so a walkthrough can sign in as any of them without digging
// through the database. Every name is prefixed "Demo" for the same
// reason the TS version documents: never confusable with a real org.
func SeedDemoTicketing(ctx context.Context, pool *pgxpool.Pool) error {
	organiserPartyID, err := EnsurePersonParty(ctx, pool, "+254700100100", "Demo Organiser", "Demo Organiser", "047", "100100")
	if err != nil {
		return fmt.Errorf("organiser: %w", err)
	}
	enterpriseID, err := EnsureEnterprise(ctx, pool, organiserPartyID, "ticketing")
	if err != nil {
		return fmt.Errorf("organiser enterprise: %w", err)
	}

	transportOrgID, err := ensureTicketOrg(ctx, pool, enterpriseID, "Demo Rapid Coach", "demo-rapid-coach", "TRANSPORT", "+254700100101")
	if err != nil {
		return fmt.Errorf("transport org: %w", err)
	}
	eventsOrgID, err := ensureTicketOrg(ctx, pool, enterpriseID, "Demo Nairobi Live", "demo-nairobi-live", "EVENTS", "+254700100102")
	if err != nil {
		return fmt.Errorf("events org: %w", err)
	}

	for _, s := range []struct{ name, role, pin string }{
		{"Demo Scanner", "SCANNER", "111111"},
		{"Demo Manager", "MANAGER", "222222"},
		{"Demo Admin", "ADMIN", "333333"},
	} {
		if err := ensureTicketOrgStaff(ctx, pool, transportOrgID, s.name, s.role, s.pin); err != nil {
			return fmt.Errorf("transport staff %s: %w", s.name, err)
		}
		if err := ensureTicketOrgStaff(ctx, pool, eventsOrgID, s.name, s.role, s.pin); err != nil {
			return fmt.Errorf("events staff %s: %w", s.name, err)
		}
	}

	routeID, err := ensureRoute(ctx, pool, transportOrgID, "Nairobi", "Mombasa", 480)
	if err != nil {
		return fmt.Errorf("route: %w", err)
	}
	transportListingID, err := ensureListing(ctx, pool, transportOrgID, "Nairobi → Mombasa Express", "demo-nairobi-mombasa",
		"Daily coach service, Nairobi to Mombasa — reclining seats and onboard wifi on the VIP class.", &routeID, nil)
	if err != nil {
		return fmt.Errorf("transport listing: %w", err)
	}
	economyClassID, err := ensureTicketClass(ctx, pool, transportListingID, "Economy", 1500, 40, false, nil, nil)
	if err != nil {
		return fmt.Errorf("economy class: %w", err)
	}
	vipNote := "Extra legroom"
	vipClassID, err := ensureTicketClass(ctx, pool, transportListingID, "VIP", 3000, 10, true,
		[]string{"RECLINING", "WIFI"}, &vipNote)
	if err != nil {
		return fmt.Errorf("vip class: %w", err)
	}
	if err := scheduleOccurrence(ctx, pool, transportListingID, time.Now().Add(48*time.Hour),
		strPtr("KDA 123X"), []ticketClassSeatSpec{{vipClassID, 10}}); err != nil {
		return fmt.Errorf("transport schedule: %w", err)
	}
	if err := scheduleOccurrence(ctx, pool, transportListingID, time.Now().Add(96*time.Hour),
		strPtr("KDB 456Y"), []ticketClassSeatSpec{{vipClassID, 10}}); err != nil {
		return fmt.Errorf("transport schedule 2: %w", err)
	}
	_ = economyClassID

	venueID, err := ensureVenue(ctx, pool, eventsOrgID, "Demo Grounds", "Ngong Road", "047", 500)
	if err != nil {
		return fmt.Errorf("venue: %w", err)
	}
	eventsListingID, err := ensureListing(ctx, pool, eventsOrgID, "Demo Nairobi Live Concert", "demo-nairobi-concert",
		"An evening of live music at Demo Grounds — general admission on the lawns, reserved VVIP seating up front.", nil, &venueID)
	if err != nil {
		return fmt.Errorf("events listing: %w", err)
	}
	regularClassID, err := ensureTicketClass(ctx, pool, eventsListingID, "Regular", 1000, 300, false, nil, nil)
	if err != nil {
		return fmt.Errorf("regular class: %w", err)
	}
	vvipClassID, err := ensureTicketClass(ctx, pool, eventsListingID, "VVIP", 5000, 20, true, []string{"SNACKS"}, nil)
	if err != nil {
		return fmt.Errorf("vvip class: %w", err)
	}
	if err := scheduleOccurrence(ctx, pool, eventsListingID, time.Now().Add(7*24*time.Hour),
		strPtr("Main Stage"), []ticketClassSeatSpec{{vvipClassID, 20}}); err != nil {
		return fmt.Errorf("events schedule: %w", err)
	}
	_ = regularClassID

	// Short-route demo: one vehicle, driver + conductor, a 3-stage town
	// route and an open trip — so the fare-pay / live-map / collections
	// walkthrough works without manual setup.
	if err := ensureDemoFleet(ctx, pool, transportOrgID); err != nil {
		return fmt.Errorf("demo fleet: %w", err)
	}

	// A demo buyer, ready to sign in and book against the listings
	// above from the mobile app — same convenience seed-demo.ts's
	// demo customer gave the web walkthrough.
	if _, err := EnsurePersonParty(ctx, pool, "+254700200200", "Demo Customer", "Demo Customer", "047", "200200"); err != nil {
		return fmt.Errorf("demo customer: %w", err)
	}

	fmt.Println("  ticketing: 2 orgs, 2 listings, 3 schedules, staff logins (Demo Scanner/Manager/Admin, PIN 111111/222222/333333), demo buyer +254700200200 (PIN 200200)")
	fmt.Println("  fleet: 1 vehicle (KDA 123X), driver + conductor, 1 short route (3 stages), 1 open trip")
	return nil
}

func ensureDemoFleet(ctx context.Context, pool *pgxpool.Pool, orgID string) error {
	var vehicleID string
	err := pool.QueryRow(ctx, `SELECT id FROM fleet_vehicle WHERE "orgId" = $1 AND "plateNo" = 'KDA 123X'`, orgID).Scan(&vehicleID)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO fleet_vehicle (id, "orgId", "plateNo", capacity, label, status, "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, 'KDA 123X', 33, 'Demo town bus', 'ACTIVE', now(), now())
			RETURNING id`, orgID).Scan(&vehicleID)
		if err != nil {
			return err
		}
	}
	crewIDs := map[string]string{}
	for _, cm := range []struct{ name, role string }{{"Demo Driver", "DRIVER"}, {"Demo Conductor", "CONDUCTOR"}} {
		var id string
		err := pool.QueryRow(ctx, `SELECT id FROM crew_member WHERE "orgId" = $1 AND name = $2`, orgID, cm.name).Scan(&id)
		if err != nil {
			msisdn := "+254700100110"
			err = pool.QueryRow(ctx, `
				INSERT INTO crew_member (id, "orgId", name, msisdn, role, active, "createdAt", "updatedAt")
				VALUES (gen_random_uuid(), $1, $2, $3, $4::"CrewRole", true, now(), now())
				RETURNING id`, orgID, cm.name, msisdn, cm.role).Scan(&id)
			if err != nil {
				return err
			}
		}
		crewIDs[cm.role] = id
	}
	var routeID string
	err = pool.QueryRow(ctx, `SELECT id FROM short_route WHERE "orgId" = $1 AND name = 'Demo Town Loop'`, orgID).Scan(&routeID)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO short_route (id, "orgId", name, active, "createdAt")
			VALUES (gen_random_uuid(), $1, 'Demo Town Loop', true, now()) RETURNING id`, orgID).Scan(&routeID)
		if err != nil {
			return err
		}
		for i, st := range []struct {
			name string
			fare float64
		}{{"Stage 1", 50}, {"Stage 2", 80}, {"Terminus", 100}} {
			_, err = pool.Exec(ctx, `
				INSERT INTO fare_stage (id, "shortRouteId", name, "order", "fareKes")
				VALUES (gen_random_uuid(), $1, $2, $3, $4)
				ON CONFLICT ("shortRouteId", "order") DO NOTHING`, routeID, st.name, i+1, st.fare)
			if err != nil {
				return err
			}
		}
	}
	var open int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM trip WHERE "vehicleId" = $1 AND status = 'ACTIVE'`, vehicleID).Scan(&open); err != nil {
		return err
	}
	if open == 0 {
		_, err = pool.Exec(ctx, `
			INSERT INTO trip (id, "orgId", "vehicleId", "driverId", "conductorId", "shortRouteId", status, "startedAt", "createdAt", "qrToken", "qrShortCode", "qrRotatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE', now(), now(), 'DEMO-' || substr(gen_random_uuid()::text,1,6), 'BUS-DEMO', now())`,
			orgID, vehicleID, crewIDs["DRIVER"], crewIDs["CONDUCTOR"], routeID)
		if err != nil {
			return err
		}
	}
	// Backfill QR for trips seeded before boarding codes existed.
	_, err = pool.Exec(ctx, `UPDATE trip SET "qrToken" = 'DEMO-' || substr(gen_random_uuid()::text,1,6), "qrShortCode" = 'BUS-' || substr(gen_random_uuid()::text,1,6), "qrRotatedAt" = now() WHERE "qrShortCode" IS NULL`)
	return err
}

func ensureTicketOrg(ctx context.Context, pool *pgxpool.Pool, enterpriseID, name, slug, vertical, contactPhone string) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO ticket_org (id, "enterpriseId", name, slug, vertical, status, "contactPhone", "contactEmail",
			"loyaltyEnabled", "loyaltyPerKes", "installmentsEnabled", "minDepositPercent", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ACTIVE', $5, $6, true, 1, true, 20, now(), now())
		ON CONFLICT (slug) DO UPDATE SET name = $2, status = 'ACTIVE'
		RETURNING id`, enterpriseID, name, slug, vertical, contactPhone, slug+"@example-demo.esoqo").Scan(&id)
	return id, err
}

func ensureTicketOrgStaff(ctx context.Context, pool *pgxpool.Pool, orgID, name, role, pin string) error {
	pinHash, err := authsvc.HashPin(pin)
	if err != nil {
		return err
	}
	var existing string
	err = pool.QueryRow(ctx, `SELECT id FROM ticket_org_staff WHERE "orgId" = $1 AND name = $2`, orgID, name).Scan(&existing)
	if err == nil {
		_, err = pool.Exec(ctx, `UPDATE ticket_org_staff SET "pinHash" = $1, role = $2, active = true, "updatedAt" = now() WHERE id = $3`,
			pinHash, role, existing)
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO ticket_org_staff (id, "orgId", name, "pinHash", role, active, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, true, now(), now())`, orgID, name, pinHash, role)
	return err
}

func ensureRoute(ctx context.Context, pool *pgxpool.Pool, orgID, origin, destination string, distanceKM int) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		SELECT id FROM route WHERE "orgId" = $1 AND "originName" = $2 AND "destinationName" = $3`,
		orgID, origin, destination).Scan(&id)
	if err == nil {
		return id, nil
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO route (id, "orgId", "originName", "destinationName", "distanceKm", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
		RETURNING id`, orgID, origin, destination, distanceKM).Scan(&id)
	return id, err
}

func ensureVenue(ctx context.Context, pool *pgxpool.Pool, orgID, name, address, county string, capacity int) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `SELECT id FROM venue WHERE "orgId" = $1 AND name = $2`, orgID, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO venue (id, "orgId", name, address, county, capacity, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
		RETURNING id`, orgID, name, address, county, capacity).Scan(&id)
	return id, err
}

func ensureListing(ctx context.Context, pool *pgxpool.Pool, orgID, title, slug, description string, routeID, venueID *string) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO listing (id, "orgId", title, slug, description, "venueId", "routeId", status, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'PUBLISHED', now(), now())
		ON CONFLICT (slug) DO UPDATE SET title = $2, status = 'PUBLISHED'
		RETURNING id`, orgID, title, slug, description, venueID, routeID).Scan(&id)
	return id, err
}

func ensureTicketClass(ctx context.Context, pool *pgxpool.Pool, listingID, name string, priceKES float64, capacity int, seated bool, amenities []string, amenityNote *string) (string, error) {
	if amenities == nil {
		// pgx encodes a nil Go slice as SQL NULL, not an empty array —
		// amenities is NOT NULL DEFAULT '{}' in the schema.
		amenities = []string{}
	}
	var id string
	err := pool.QueryRow(ctx, `SELECT id FROM ticket_class WHERE "listingId" = $1 AND name = $2`, listingID, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO ticket_class (id, "listingId", name, "priceKes", seated, capacity, amenities, "amenityNote", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now())
		RETURNING id`, listingID, name, priceKES, seated, capacity, amenities, amenityNote).Scan(&id)
	return id, err
}

type ticketClassSeatSpec struct {
	ticketClassID string
	seatCount     int
}

// seatColumnLetters/columnsForPattern port packages/domain/src/ticketing.ts's
// own columnsForPattern exactly — "2+2" is left=[A,B], right=[C,D],
// column letters running continuously left to right so "3B" always
// means row 3, second seat from the left. A seat's label is
// "{row}{column}", e.g. "3B" — never "{column}{row}"; getting that
// backwards is what the seed data originally shipped with, before seat
// position mattered to the booking UI.
const seatColumnLetters = "ABCDEFG"

func columnsForPattern(pattern string) (left, right []string) {
	var l, r int
	_, _ = fmt.Sscanf(pattern, "%d+%d", &l, &r)
	if l > len(seatColumnLetters) {
		l = len(seatColumnLetters)
	}
	left = strings.Split(seatColumnLetters[:l], "")
	end := l + r
	if end > len(seatColumnLetters) {
		end = len(seatColumnLetters)
	}
	right = strings.Split(seatColumnLetters[l:end], "")
	return left, right
}

// scheduleOccurrence mirrors createSchedule/scheduleOccurrence:
// generates one ListingSchedule and, for every seated ticket class
// given, its numbered Seat rows laid out on a real "2+2" bus pattern —
// two rows of seats either side of an aisle, so the booking UI can
// render actual seat positions instead of a flat undifferentiated list.
func scheduleOccurrence(ctx context.Context, pool *pgxpool.Pool, listingID string, departAt time.Time, vehicleOrHallLabel *string, seatedClasses []ticketClassSeatSpec) error {
	// Natural key is (listingId, vehicleOrHallLabel), not departAt —
	// departAt is computed relative to time.Now() so it's never the same
	// value twice; matching on it would insert a fresh duplicate
	// schedule (and duplicate seats) every time the seeder runs on a
	// different day. vehicleOrHallLabel is the stable identity across
	// runs; a re-run just refreshes the date back into the future.
	var scheduleID string
	existed := false
	err := pool.QueryRow(ctx, `
		SELECT id FROM listing_schedule WHERE "listingId" = $1 AND "vehicleOrHallLabel" = $2`,
		listingID, vehicleOrHallLabel).Scan(&scheduleID)
	if err == nil {
		existed = true
		if _, err = pool.Exec(ctx, `
			UPDATE listing_schedule SET "departAt" = $1, status = 'SCHEDULED' WHERE id = $2`, departAt, scheduleID); err != nil {
			return err
		}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if !existed {
		if err = tx.QueryRow(ctx, `
			INSERT INTO listing_schedule (id, "listingId", "departAt", "vehicleOrHallLabel", status, "createdAt")
			VALUES (gen_random_uuid(), $1, $2, $3, 'SCHEDULED', now())
			RETURNING id`, listingID, departAt, vehicleOrHallLabel).Scan(&scheduleID); err != nil {
			return err
		}
	}

	// Seats are regenerated whenever a schedule has none yet — not just
	// on first creation — so a re-run after a seat-layout change (or
	// after the seats were cleared for any other reason) heals itself
	// instead of silently leaving the schedule seatless forever.
	var existingSeatCount int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM seat WHERE "scheduleId" = $1`, scheduleID).Scan(&existingSeatCount); err != nil {
		return err
	}
	if existingSeatCount > 0 {
		return tx.Commit(ctx)
	}

	left, right := columnsForPattern("2+2")
	columns := append(append([]string{}, left...), right...)
	perRow := len(columns)

	for _, sc := range seatedClasses {
		row, col := 1, 0
		for i := 0; i < sc.seatCount; i++ {
			if col == perRow {
				col = 0
				row++
			}
			label := fmt.Sprintf("%d%s", row, columns[col])
			col++
			_, err = tx.Exec(ctx, `
				INSERT INTO seat (id, "scheduleId", "ticketClassId", label, status)
				VALUES (gen_random_uuid(), $1, $2, $3, 'AVAILABLE')`, scheduleID, sc.ticketClassID, label)
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit(ctx)
}

func strPtr(s string) *string { return &s }
