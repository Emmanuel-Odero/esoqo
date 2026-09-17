// Package dbx (parcel_dispatch.go) — the actual dispatch mechanism: a
// courier's own location, the jobs near them, and the race-safe claim
// that turns "available" into "assigned to me". Complements the admin
// AssignPanel's manual, pre-scheduled path (AssignParcelCollector,
// parcels.go) — that's the fleet/scheduled side of the hybrid model,
// this is the gig/on-demand side, and both funnel into the same
// assignedCollectorPartyId field ScanHandoff already enforces.
package dbx

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostCourierPing — a courier's own location, posted while their
// "Nearby jobs" view is open (see the mobile-side polling loop's own
// comment). Mirrors dbx.PostPing's coordinate validation (fleet.go)
// exactly; requires an ACTIVE courier — a suspended or not-yet-vetted
// account has no business broadcasting a live position for dispatch.
func PostCourierPing(ctx context.Context, pool *pgxpool.Pool, courierPartyID string, lat, lng float64) error {
	active, err := IsActiveCourier(ctx, pool, courierPartyID)
	if err != nil {
		return err
	}
	if !active {
		return &ParcelCourierError{"BAD_INPUT", "Only an active courier can post a location"}
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return &ParcelCourierError{"BAD_INPUT", "Invalid coordinates"}
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO parcel_courier_ping (id, "courierPartyId", lat, lng, at)
		VALUES (gen_random_uuid(), $1, $2, $3, now())`, courierPartyID, lat, lng)
	return err
}

// AvailableJob — one BOOKED, unassigned parcel a courier could claim,
// with the distance from their own last-known position so the mobile
// list can show "2.1 km away" and sort nearest-first.
type AvailableJob struct {
	Code             string
	OriginLabel      string
	DestinationLabel string
	ParcelType       string
	PriceKes         *string
	DistanceKm       *float64
}

// ListAvailableJobs — BOOKED or RECEIVED_AT_COUNTER, unassigned
// parcels, ranked by distance
// from the courier's latest ping when both the courier's position and
// the parcel's origin zone are known; parcels with no origin zone (an
// older or zone-skipped booking) are still listed, just last and
// without a distance figure — same graceful-degradation the pricing
// surcharge already follows, applied here to visibility instead of price.
func ListAvailableJobs(ctx context.Context, pool *pgxpool.Pool, courierPartyID string, radiusKm float64) ([]AvailableJob, error) {
	var courierLat, courierLng *float64
	row := pool.QueryRow(ctx, `
		SELECT lat::float8, lng::float8 FROM parcel_courier_ping
		WHERE "courierPartyId" = $1 ORDER BY at DESC LIMIT 1`, courierPartyID)
	if err := row.Scan(&courierLat, &courierLng); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	rows, err := pool.Query(ctx, `
		SELECT p.code, p."originLabel", p."destinationLabel", p."parcelType"::text, p."priceKes"::text,
		       z.lat::float8, z.lng::float8
		FROM parcel p
		LEFT JOIN parcel_zone z ON z.id = p."originZoneId"
		WHERE p.status IN ('BOOKED', 'RECEIVED_AT_COUNTER') AND p."assignedCollectorPartyId" IS NULL
		ORDER BY p."createdAt" ASC
		LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AvailableJob
	for rows.Next() {
		var j AvailableJob
		var zoneLat, zoneLng *float64
		if err := rows.Scan(&j.Code, &j.OriginLabel, &j.DestinationLabel, &j.ParcelType, &j.PriceKes, &zoneLat, &zoneLng); err != nil {
			return nil, err
		}
		if courierLat != nil && zoneLat != nil {
			d := HaversineKm(*courierLat, *courierLng, *zoneLat, *zoneLng)
			if d > radiusKm {
				continue
			}
			j.DistanceKm = &d
		}
		out = append(out, j)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Nearest-first, unknown-distance jobs last — a plain stable sort
	// over a capped 100-row slice, no need to push this into SQL.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && jobLess(out[j], out[j-1]); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out, nil
}

func jobLess(a, b AvailableJob) bool {
	if a.DistanceKm == nil {
		return false
	}
	if b.DistanceKm == nil {
		return true
	}
	return *a.DistanceKm < *b.DistanceKm
}

// ClaimParcel — the real first-accept-wins primitive: a single UPDATE
// guarded by "assignedCollectorPartyId IS NULL", so two couriers racing
// the same job can never both win — whoever's UPDATE lands first sets
// the column, the second one's WHERE clause simply matches zero rows.
// Requires an ACTIVE courier, same guard PostCourierPing uses.
func ClaimParcel(ctx context.Context, pool *pgxpool.Pool, code, courierPartyID string) error {
	active, err := IsActiveCourier(ctx, pool, courierPartyID)
	if err != nil {
		return err
	}
	if !active {
		return &ParcelCourierError{"BAD_INPUT", "Only an active courier can claim a job"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET "assignedCollectorPartyId" = $1
		WHERE code = $2 AND status IN ('BOOKED', 'RECEIVED_AT_COUNTER') AND "assignedCollectorPartyId" IS NULL`,
		courierPartyID, code)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"ALREADY_DELIVERED", "That job was already claimed or is no longer available"}
	}
	return nil
}

// LiveCourierPosition — one active courier's latest ping, for the
// admin live-dispatch map.
type LiveCourierPosition struct {
	CourierPartyID string
	Name           string
	VehicleType    string
	Lat            string
	Lng            string
	At             time.Time
}

// LiveUnassignedParcel — one BOOKED-unassigned or SLA-overdue parcel's
// zone position, for the same map.
type LiveUnassignedParcel struct {
	Code    string
	Status  string
	Lat     *string
	Lng     *string
	Overdue bool
}

// GetLiveDispatchView — everything the admin live map needs in two
// queries: latest position per active courier (exact DISTINCT ON shape
// dbx.LatestPositions already uses for the fleet vertical), and every
// parcel that either needs a courier or is running late.
func GetLiveDispatchView(ctx context.Context, pool *pgxpool.Pool) ([]LiveCourierPosition, []LiveUnassignedParcel, error) {
	courierRows, err := pool.Query(ctx, `
		SELECT DISTINCT ON (p."courierPartyId")
		       p."courierPartyId", COALESCE(pr."knownAs", pr."officialName"), c."vehicleType"::text,
		       p.lat::text, p.lng::text, p.at
		FROM parcel_courier_ping p
		JOIN parcel_courier c ON c."partyId" = p."courierPartyId"
		JOIN person pr ON pr."partyId" = p."courierPartyId"
		WHERE c.status = 'ACTIVE'
		ORDER BY p."courierPartyId", p.at DESC`)
	if err != nil {
		return nil, nil, err
	}
	defer courierRows.Close()
	var couriers []LiveCourierPosition
	for courierRows.Next() {
		var pos LiveCourierPosition
		if err := courierRows.Scan(&pos.CourierPartyID, &pos.Name, &pos.VehicleType, &pos.Lat, &pos.Lng, &pos.At); err != nil {
			return nil, nil, err
		}
		couriers = append(couriers, pos)
	}
	if err := courierRows.Err(); err != nil {
		return nil, nil, err
	}

	parcelRows, err := pool.Query(ctx, `
		SELECT p.code, p.status::text, z.lat::text, z.lng::text,
		       (p."slaDeadlineAt" IS NOT NULL AND p."slaDeadlineAt" < now())
		FROM parcel p
		LEFT JOIN parcel_zone z ON z.id = p."originZoneId"
		WHERE (p.status IN ('BOOKED', 'RECEIVED_AT_COUNTER') AND p."assignedCollectorPartyId" IS NULL)
		   OR (p.status IN ('PICKED_UP', 'IN_TRANSIT') AND p."slaDeadlineAt" IS NOT NULL AND p."slaDeadlineAt" < now())
		ORDER BY p."createdAt" DESC
		LIMIT 200`)
	if err != nil {
		return nil, nil, err
	}
	defer parcelRows.Close()
	var parcels []LiveUnassignedParcel
	for parcelRows.Next() {
		var p LiveUnassignedParcel
		if err := parcelRows.Scan(&p.Code, &p.Status, &p.Lat, &p.Lng, &p.Overdue); err != nil {
			return nil, nil, err
		}
		parcels = append(parcels, p)
	}
	return couriers, parcels, parcelRows.Err()
}
