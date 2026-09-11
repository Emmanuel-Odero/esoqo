package seed

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/authsvc"
)

// SeedPilotData plants the one-SACCO pilot kit the pilot-check script
// walks through: owner + SACCO org, vehicle KDP 001A, driver + tout crew
// with CREW PIN logins, a 3-stage route with an open QR-coded trip, one
// loaded FARE voucher + loyalty for the demo passenger, and a scanner
// PIN for the tout's verify screen. All names/numbers are Demo-prefixed;
// rerunnable (upserts, never duplicates).
func SeedPilotData(ctx context.Context, pool *pgxpool.Pool, qrSecret string) error {
	ownerParty, err := EnsurePersonParty(ctx, pool, "+254700300100", "Demo Pilot Owner", "Pilot Owner", "047", "300100")
	if err != nil {
		return fmt.Errorf("pilot owner: %w", err)
	}
	enterpriseID, err := EnsureEnterprise(ctx, pool, ownerParty, "pilot-sacco")
	if err != nil {
		return fmt.Errorf("pilot enterprise: %w", err)
	}
	orgID, err := ensureTicketOrg(ctx, pool, enterpriseID, "Demo Pilot SACCO", "demo-pilot-sacco", "TRANSPORT", "+254700300101")
	if err != nil {
		return fmt.Errorf("pilot org: %w", err)
	}

	// Tout verify needs a SCANNER PIN; crew declare/ping needs CREW bundle.
	for _, s := range []struct{ name, role, pin string }{
		{"Pilot Scanner", "SCANNER", "444444"},
		{"Pilot Manager", "MANAGER", "555555"},
		{"Pilot Admin", "ADMIN", "666666"},
	} {
		if err := ensureTicketOrgStaff(ctx, pool, orgID, s.name, s.role, s.pin); err != nil {
			return fmt.Errorf("pilot staff %s: %w", s.name, err)
		}
	}

	var vehicleID string
	err = pool.QueryRow(ctx, `SELECT id FROM fleet_vehicle WHERE "orgId" = $1 AND "plateNo" = 'KDP 001A'`, orgID).Scan(&vehicleID)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO fleet_vehicle (id, "orgId", "plateNo", capacity, label, status, "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, 'KDP 001A', 33, 'Pilot town bus', 'ACTIVE', now(), now())
			RETURNING id`, orgID).Scan(&vehicleID)
		if err != nil {
			return fmt.Errorf("pilot vehicle: %w", err)
		}
	}

	crewIDs := map[string]string{}
	for _, cm := range []struct{ name, role, msisdn string }{
		{"Pilot Driver", "DRIVER", "+254700300110"},
		{"Pilot Tout", "CONDUCTOR", "+254700300111"},
	} {
		var id string
		err := pool.QueryRow(ctx, `SELECT id FROM crew_member WHERE "orgId" = $1 AND name = $2`, orgID, cm.name).Scan(&id)
		if err != nil {
			err = pool.QueryRow(ctx, `
				INSERT INTO crew_member (id, "orgId", name, msisdn, role, active, "createdAt", "updatedAt")
				VALUES (gen_random_uuid(), $1, $2, $3, $4::"CrewRole", true, now(), now())
				RETURNING id`, orgID, cm.name, cm.msisdn, cm.role).Scan(&id)
			if err != nil {
				return fmt.Errorf("pilot crew %s: %w", cm.name, err)
			}
		}
		crewIDs[cm.role] = id
	}

	var routeID string
	err = pool.QueryRow(ctx, `SELECT id FROM short_route WHERE "orgId" = $1 AND name = 'Pilot Town Loop'`, orgID).Scan(&routeID)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO short_route (id, "orgId", name, active, "createdAt")
			VALUES (gen_random_uuid(), $1, 'Pilot Town Loop', true, now()) RETURNING id`, orgID).Scan(&routeID)
		if err != nil {
			return fmt.Errorf("pilot route: %w", err)
		}
		for i, st := range []struct {
			name string
			fare float64
		}{{"Pilot Stage 1", 50}, {"Pilot Stage 2", 80}, {"Pilot Terminus", 100}} {
			_, err = pool.Exec(ctx, `
				INSERT INTO fare_stage (id, "shortRouteId", name, "order", "fareKes")
				VALUES (gen_random_uuid(), $1, $2, $3, $4)
				ON CONFLICT ("shortRouteId", "order") DO NOTHING`, routeID, st.name, i+1, st.fare)
			if err != nil {
				return fmt.Errorf("pilot stage: %w", err)
			}
		}
	}

	var tripID, shortCode string
	err = pool.QueryRow(ctx, `SELECT id::text, "qrShortCode" FROM trip WHERE "vehicleId" = $1 AND status = 'ACTIVE' LIMIT 1`, vehicleID).Scan(&tripID, &shortCode)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO trip (id, "orgId", "vehicleId", "driverId", "conductorId", "shortRouteId", status, "startedAt", "createdAt", "qrToken", "qrShortCode", "qrRotatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE', now(), now(), 'PILOT-' || substr(gen_random_uuid()::text,1,6), 'BUS-PILOT', now())
			RETURNING id::text, "qrShortCode"`, orgID, vehicleID, crewIDs["DRIVER"], crewIDs["CONDUCTOR"], routeID).Scan(&tripID, &shortCode)
		if err != nil {
			return fmt.Errorf("pilot trip: %w", err)
		}
	}
	// Guarantee a human-typable code even for trips seeded before QR.
	if shortCode == "" {
		_, _ = pool.Exec(ctx, `UPDATE trip SET "qrShortCode" = 'BUS-PILOT', "qrRotatedAt" = now() WHERE id = $1`, tripID)
		shortCode = "BUS-PILOT"
	}

	// Demo passenger with PIN + a pre-loaded FARE voucher (2,000 pts ≈
	// KES 200) + loyalty top-up, so the pilot script can pay by voucher
	// without touching Daraja.
	passengerParty, err := EnsurePersonParty(ctx, pool, "+254700300200", "Demo Pilot Passenger", "Pilot Passenger", "047", "300200")
	if err != nil {
		return fmt.Errorf("pilot passenger: %w", err)
	}
	var voucherID string
	err = pool.QueryRow(ctx, `SELECT id FROM voucher_card WHERE "ownerPartyId" = $1 AND purpose = 'FARE' AND status = 'ACTIVE' LIMIT 1`, passengerParty).Scan(&voucherID)
	if err != nil {
		err = pool.QueryRow(ctx, `
			INSERT INTO voucher_card (id, "ownerPartyId", label, purpose, status, "qrToken", "shortCode", "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, 'Pilot fare card', 'FARE', 'ACTIVE', 'PILOTVCH-' || substr(gen_random_uuid()::text,1,6), 'VCH-PILOT', now(), now())
			RETURNING id`, passengerParty).Scan(&voucherID)
		if err != nil {
			return fmt.Errorf("pilot voucher: %w", err)
		}
	}
	_, _ = pool.Exec(ctx, `INSERT INTO voucher_ledger_entry (id, "voucherId", points, "kesEquiv", kind, "refId", "createdAt")
		SELECT gen_random_uuid(), $1, 2000, 200, 'LOAD_LOYALTY', 'pilot-seed', now()
		WHERE NOT EXISTS (SELECT 1 FROM voucher_ledger_entry WHERE "voucherId" = $1 AND "refId" = 'pilot-seed')`, voucherID)
	_, _ = pool.Exec(ctx, `INSERT INTO party_loyalty_entry (id, "partyId", points, kind, "refId", "createdAt")
		SELECT gen_random_uuid(), $1, 500, 'EARN', 'pilot-seed', now()
		WHERE NOT EXISTS (SELECT 1 FROM party_loyalty_entry WHERE "partyId" = $1 AND "refId" = 'pilot-seed')`, passengerParty)

	_ = qrSecret
	_ = authsvc.DummyPinHash
	fmt.Println("  pilot: Demo Pilot SACCO (demo-pilot-sacco), KDP 001A open trip BUS-PILOT, staff 444444/555555/666666, passenger +254700300200 (PIN 300200), VCH-PILOT loaded 2000 pts")
	return nil
}
