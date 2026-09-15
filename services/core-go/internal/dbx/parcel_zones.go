// Package dbx (parcel_zones.go) — admin-curated hubs with coordinates,
// the pricing/dispatch signal Parcel.originLabel/destinationLabel free
// text was never meant to be a distance-based fare could rely on.
// HaversineKm is the one piece of real geo-distance math a parcel now
// shares with dbx.ListStoresNearby (store.go) — same formula, ported to
// Go since both endpoints are already in hand here rather than a
// row per candidate the way store discovery needs.
package dbx

import (
	"context"
	"errors"
	"math"
	"strconv"

	"github.com/esoqo/core-go/internal/money"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HaversineKm — great-circle distance between two lat/lng points, same
// formula dbx.ListStoresNearby's raw SQL already uses (store.go), ported
// to Go here since both zones' coordinates are already loaded in memory
// rather than sitting in a table a query can push the math into.
func HaversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLng := toRad(lng2 - lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusKm * c
}

type ParcelZone struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Active bool    `json:"active"`
}

func scanParcelZone(row pgx.Row) (*ParcelZone, error) {
	var z ParcelZone
	var latText, lngText string
	if err := row.Scan(&z.ID, &z.Name, &latText, &lngText, &z.Active); err != nil {
		return nil, err
	}
	var err error
	if z.Lat, err = parseFloatOrZero(latText); err != nil {
		return nil, err
	}
	if z.Lng, err = parseFloatOrZero(lngText); err != nil {
		return nil, err
	}
	return &z, nil
}

func parseFloatOrZero(s string) (float64, error) {
	if s == "" {
		return 0, nil
	}
	return strconv.ParseFloat(s, 64)
}

// ListParcelZones — active-only by default (activeOnly=true is what the
// public booking-form zone picker and price estimation both want);
// admin's zone editor passes false to also see deactivated zones.
func ListParcelZones(ctx context.Context, pool *pgxpool.Pool, activeOnly bool) ([]ParcelZone, error) {
	query := `SELECT id, name, lat::text, lng::text, active FROM parcel_zone`
	if activeOnly {
		query += ` WHERE active = true`
	}
	query += ` ORDER BY name ASC`
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelZone
	for rows.Next() {
		z, err := scanParcelZone(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *z)
	}
	return out, rows.Err()
}

func GetParcelZone(ctx context.Context, pool *pgxpool.Pool, id string) (*ParcelZone, error) {
	row := pool.QueryRow(ctx, `SELECT id, name, lat::text, lng::text, active FROM parcel_zone WHERE id = $1`, id)
	z, err := scanParcelZone(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return z, err
}

func CreateParcelZone(ctx context.Context, pool *pgxpool.Pool, name string, lat, lng float64) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO parcel_zone (id, name, lat, lng, active, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, true, now()) RETURNING id`, name, lat, lng).Scan(&id)
	return id, err
}

func UpdateParcelZone(ctx context.Context, pool *pgxpool.Pool, id, name string, lat, lng float64, active bool) error {
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_zone SET name = $1, lat = $2, lng = $3, active = $4 WHERE id = $5`,
		name, lat, lng, active, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That zone was not found"}
	}
	return nil
}

// ParcelDistanceRateView — the one global admin-editable per-km rate
// (see model ParcelDistanceRate's own comment on why it's not a
// per-zone-pair matrix).
type ParcelDistanceRateView struct {
	PerKmKes        money.Amount `json:"perKmKes"`
	MinChargeableKm float64      `json:"minChargeableKm"`
}

// GetParcelDistanceRate — nil when no admin has configured one yet,
// same "unconfigured means opt-out" convention ParcelPricingRule.slaHours
// follows: callers must treat a nil rate as "no distance surcharge",
// not an error.
func GetParcelDistanceRate(ctx context.Context, pool *pgxpool.Pool) (*ParcelDistanceRateView, error) {
	var v ParcelDistanceRateView
	var perKmText, minKmText string
	err := pool.QueryRow(ctx, `SELECT "perKmKes"::text, "minChargeableKm"::text FROM parcel_distance_rate ORDER BY "updatedAt" DESC LIMIT 1`).
		Scan(&perKmText, &minKmText)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v.PerKmKes = money.AmountOf(money.MustParseKES(perKmText))
	if v.MinChargeableKm, err = parseFloatOrZero(minKmText); err != nil {
		return nil, err
	}
	return &v, nil
}

// SetParcelDistanceRate — admin editing the single global rate. Only
// one row is ever meant to exist; this upserts it rather than growing a
// history table nothing reads.
func SetParcelDistanceRate(ctx context.Context, pool *pgxpool.Pool, perKmKes, minChargeableKm float64, staffID string) error {
	_, err := pool.Exec(ctx, `
		DELETE FROM parcel_distance_rate;
		INSERT INTO parcel_distance_rate (id, "perKmKes", "minChargeableKm", "updatedAt", "updatedById")
		VALUES (gen_random_uuid(), $1, $2, now(), $3)`, perKmKes, minChargeableKm, staffID)
	return err
}

// DistanceSurchargeKes — the additive amount HaversineKm(zones) *
// perKmKes contributes on top of a weight bracket's flat price, floored
// at minChargeableKm so a same-zone delivery is never priced as free.
// Returns (0, 0, nil) whenever either zone or the rate itself isn't
// configured — the graceful-degradation path Parcel.originZoneId's own
// comment describes.
func DistanceSurchargeKes(ctx context.Context, pool *pgxpool.Pool, originZoneID, destinationZoneID *string) (surchargeKes, distanceKm float64, err error) {
	if originZoneID == nil || destinationZoneID == nil {
		return 0, 0, nil
	}
	rate, err := GetParcelDistanceRate(ctx, pool)
	if err != nil || rate == nil {
		return 0, 0, err
	}
	origin, err := GetParcelZone(ctx, pool, *originZoneID)
	if err != nil || origin == nil {
		return 0, 0, err
	}
	destination, err := GetParcelZone(ctx, pool, *destinationZoneID)
	if err != nil || destination == nil {
		return 0, 0, err
	}
	distanceKm = HaversineKm(origin.Lat, origin.Lng, destination.Lat, destination.Lng)
	chargeableKm := distanceKm
	if chargeableKm < rate.MinChargeableKm {
		chargeableKm = rate.MinChargeableKm
	}
	// Rate x distance in exact cents — see money.Cents.Scale. The result
	// is a surcharge that lands in a Decimal(12,2) column, so the cent it
	// rounds to is decided here rather than by the float product.
	return rate.PerKmKes.Cents().Scale(chargeableKm).KES(), distanceKm, nil
}
