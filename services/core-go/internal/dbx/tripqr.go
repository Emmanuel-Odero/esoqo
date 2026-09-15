package dbx

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/fleetqr"
)

// TripQr holds the scannable boarding identity for an active trip.
type TripQr struct {
	TripID    string
	Payload   string
	ShortCode string
	RotatedAt *string
}

// RotateTripQr mints (or re-mints) a trip's QR after auth. Called on
// CreateTrip and on crew change / manager request.
func RotateTripQr(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, tripID, qrSecret string) (*TripQr, error) {
	orgID, err := tripOrg(ctx, pool, tripID)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTripWrite); err != nil {
		return nil, err
	}
	var rotated *string
	var qrToken, shortCode string
	// Re-roll on a unique collision the same way vouchers do — qrToken
	// and qrShortCode are @unique columns, and rotation happens often
	// enough (every crew change) that birthday odds are worth a retry.
	err = retryUnique(func() error {
		qrToken = fleetqr.ShortCodeChecked(fleetqr.PrefixTrip, 6) + randSuffix()
		shortCode = fleetqr.ShortCodeChecked(fleetqr.PrefixBus, 6)
		rotated = nil
		return pool.QueryRow(ctx, `UPDATE trip SET "qrToken" = $1, "qrShortCode" = $2, "qrRotatedAt" = now() WHERE id = $3 RETURNING "qrRotatedAt"::text`, qrToken, shortCode, tripID).Scan(&rotated)
	})
	if err != nil {
		return nil, err
	}
	return &TripQr{TripID: tripID, Payload: fleetqr.TripPayload(tripID, fleetqr.Sign(qrSecret, "trip", tripID)), ShortCode: shortCode, RotatedAt: rotated}, nil
}

// TripResolve is the passenger-safe projection for scan-to-pay.
type TripResolve struct {
	TripID        string
	OrgID         string
	OrgName       string
	OrgSlug       string
	VehiclePlate  string
	RouteName     *string
	DriverName    *string
	ConductorName *string
	Status        string
	Stages        []FareStageRow
}

// ResolveTripQr verifies the HMAC (or short code) and returns the public
// trip card: org, plate, route, stages+fares, crew first names. No msisdn,
// no GPS — safe for guests.
func ResolveTripQr(ctx context.Context, pool *pgxpool.Pool, payloadOrCode, qrSecret string) (*TripResolve, error) {
	tripID := ""
	if id, sig := fleetqr.ParseTripPayload(payloadOrCode); id != "" {
		if !fleetqr.Verify(qrSecret, "trip", id, sig) {
			return nil, &FleetError{"BAD_QR", "This bus code is not valid"}
		}
		tripID = id
	} else {
		code := payloadOrCode
		if err := pool.QueryRow(ctx, `SELECT id::text FROM trip WHERE "qrShortCode" = $1 OR "qrToken" = $1 LIMIT 1`, code).Scan(&tripID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, &FleetError{"NOT_FOUND", "No bus found for that code"}
			}
			return nil, err
		}
	}
	var r TripResolve
	var routeID *string
	err := pool.QueryRow(ctx, `
		SELECT t.id::text, t."orgId"::text, o.name, o.slug, v."plateNo", sr.name, d.name, co.name, t.status::text, t."shortRouteId"::text
		FROM trip t JOIN ticket_org o ON o.id = t."orgId"
		JOIN fleet_vehicle v ON v.id = t."vehicleId"
		LEFT JOIN short_route sr ON sr.id = t."shortRouteId"
		LEFT JOIN crew_member d ON d.id = t."driverId"
		LEFT JOIN crew_member co ON co.id = t."conductorId"
		WHERE t.id = $1`, tripID).
		Scan(&r.TripID, &r.OrgID, &r.OrgName, &r.OrgSlug, &r.VehiclePlate, &r.RouteName, &r.DriverName, &r.ConductorName, &r.Status, &routeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &FleetError{"NOT_FOUND", "Trip not found"}
	}
	if err != nil {
		return nil, err
	}
	if r.Status != "ACTIVE" {
		return nil, &FleetError{"TRIP_CLOSED", "This trip is closed — ask the crew for the current bus"}
	}
	if routeID != nil && *routeID != "" {
		stages, err := listStages(ctx, pool, *routeID)
		if err != nil {
			return nil, err
		}
		r.Stages = stages
	}
	// First names only on the public card.
	r.DriverName = firstName(r.DriverName)
	r.ConductorName = firstName(r.ConductorName)
	return &r, nil
}

func firstName(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	for i, ch := range *s {
		if ch == ' ' {
			v := (*s)[:i]
			return &v
		}
	}
	return s
}
