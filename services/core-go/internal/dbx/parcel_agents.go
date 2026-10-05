// Package dbx (parcel_agents.go) — the pickup-point network and the
// declared-value coverage rate card.
//
// An agent is a real neighbourhood shop that holds parcels for
// collection. It is deliberately a sibling of ParcelZone rather than an
// extension of it: a zone is a *pricing coordinate* (see
// parcel_zones.go), an agent is a *place custody actually sits* — with a
// person, a phone, opening hours and finite shelf space. Several agents
// share one zone; a zone with no agents still prices fine.
//
// Why it matters commercially: one courier run serving a shop that
// twenty receivers walk to costs a fraction of twenty doorstep runs.
// Agent-to-agent is the only leg cheap enough to compete on price here,
// and doorstep becomes the upsell rather than the only option.
package dbx

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/esoqo/core-go/internal/money"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ParcelAgent is one pickup point. HoldingFeeKes is what the receiver
// pays the shop on collection; it is copied onto the parcel at booking
// time and never read live afterwards, same freeze-the-promise rule
// Parcel.transportMode/slaDeadlineAt already follow.
//
// ParcelsHeld/Capacity travel together so the booking form can grey out
// a full shop instead of the sender discovering it at the door.
type ParcelAgent struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	PartyID      *string `json:"partyId"`
	ZoneID       *string `json:"zoneId"`
	ZoneName     *string `json:"zoneName"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	Msisdn       string  `json:"msisdn"`
	LocationHint string  `json:"locationHint"`
	OpeningHours *string `json:"openingHours"`
	Active       bool    `json:"active"`
	Capacity     int     `json:"capacity"`

	HoldingFeeKes money.Amount `json:"holdingFeeKes"`
	// ParcelsHeld — how many parcels are sitting on this shelf right now
	// (status HELD_AT_AGENT). Counted per row in the list query rather
	// than denormalised onto parcel_agent: the count changes on every
	// drop and every collection, and a stale shelf count is worse than
	// no shelf count.
	ParcelsHeld int `json:"parcelsHeld"`
	// DistanceKm — only set by ListParcelAgentsNear, the "closest shops
	// to where this parcel is going" query the booking form runs.
	DistanceKm *float64 `json:"distanceKm,omitempty"`
}

const parcelAgentColumns = `
	a.id, a.name, a."partyId"::text, a."zoneId"::text, z.name,
	a.lat::text, a.lng::text, a.msisdn, a."locationHint", a."openingHours",
	a.active, a.capacity, a."holdingFeeKes"::text,
	(SELECT count(*) FROM parcel p WHERE p."destinationAgentId" = a.id AND p.status = 'HELD_AT_AGENT')`

func scanParcelAgent(row pgx.Row) (*ParcelAgent, error) {
	var a ParcelAgent
	var latText, lngText, feeText string
	if err := row.Scan(&a.ID, &a.Name, &a.PartyID, &a.ZoneID, &a.ZoneName,
		&latText, &lngText, &a.Msisdn, &a.LocationHint, &a.OpeningHours,
		&a.Active, &a.Capacity, &feeText, &a.ParcelsHeld); err != nil {
		return nil, err
	}
	var err error
	if a.Lat, err = parseFloatOrZero(latText); err != nil {
		return nil, err
	}
	if a.Lng, err = parseFloatOrZero(lngText); err != nil {
		return nil, err
	}
	a.HoldingFeeKes = money.AmountOf(money.MustParseKES(feeText))
	return &a, nil
}

// ListParcelAgents — active-only for the public booking-form picker,
// all rows for the admin editor, same activeOnly split ListParcelZones
// already uses.
func ListParcelAgents(ctx context.Context, pool *pgxpool.Pool, activeOnly bool) ([]ParcelAgent, error) {
	query := `SELECT ` + parcelAgentColumns + `
		FROM parcel_agent a LEFT JOIN parcel_zone z ON z.id = a."zoneId"`
	if activeOnly {
		query += ` WHERE a.active = true`
	}
	query += ` ORDER BY a.name ASC`
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelAgent
	for rows.Next() {
		a, err := scanParcelAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// ListParcelAgentsNear — the booking form's "where can my receiver
// collect this?" list: active agents with shelf space, nearest first.
// Distance is computed in Go over the whole active set rather than
// pushed into SQL, exactly as DistanceSurchargeKes already does — the
// agent list is a small admin-curated table, not a scan worth indexing
// geospatially, and HaversineKm is already the shared formula here.
//
// Agents at capacity are filtered out, not merely flagged: a shop with
// no shelf space isn't a choice, and showing it only invites the sender
// to pick the one option that will fail.
func ListParcelAgentsNear(ctx context.Context, pool *pgxpool.Pool, lat, lng, radiusKm float64, limit int) ([]ParcelAgent, error) {
	all, err := ListParcelAgents(ctx, pool, true)
	if err != nil {
		return nil, err
	}
	var out []ParcelAgent
	for i := range all {
		a := all[i]
		if a.ParcelsHeld >= a.Capacity {
			continue
		}
		d := HaversineKm(lat, lng, a.Lat, a.Lng)
		if radiusKm > 0 && d > radiusKm {
			continue
		}
		a.DistanceKm = &d
		out = append(out, a)
	}
	// Insertion sort by distance — the candidate set here is tens of
	// rows at most (an admin-curated shop list inside one radius), so
	// pulling in sort.Slice for it would cost more in indirection than
	// the loop saves.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && *out[j].DistanceKm < *out[j-1].DistanceKm; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// GetParcelAgent — nil (not an error) when the id is unknown, same
// convention GetParcelZone follows.
func GetParcelAgent(ctx context.Context, pool *pgxpool.Pool, id string) (*ParcelAgent, error) {
	row := pool.QueryRow(ctx, `SELECT `+parcelAgentColumns+`
		FROM parcel_agent a LEFT JOIN parcel_zone z ON z.id = a."zoneId"
		WHERE a.id = $1`, id)
	a, err := scanParcelAgent(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return a, err
}

type ParcelAgentInput struct {
	Name         string
	PartyID      *string
	ZoneID       *string
	Lat          float64
	Lng          float64
	Msisdn       string
	LocationHint string
	OpeningHours *string
	Capacity     int
	HoldingFee   float64
	Active       bool
}

func (in ParcelAgentInput) validate() error {
	if strings.TrimSpace(in.Name) == "" {
		return &ParcelError{"BAD_INPUT", "Give the pickup point a name"}
	}
	if strings.TrimSpace(in.Msisdn) == "" {
		return &ParcelError{"BAD_INPUT", "A pickup point needs a phone number receivers can call"}
	}
	if strings.TrimSpace(in.LocationHint) == "" {
		return &ParcelError{"BAD_INPUT", "Describe how to find the shop — that's what a receiver navigates by"}
	}
	if in.Lat == 0 && in.Lng == 0 {
		return &ParcelError{"BAD_INPUT", "Set the shop's coordinates"}
	}
	// The 0,0 check above only catches the one coordinate nobody meant to
	// type. An agent at lat=900 passes it, and then "nearest pickup point"
	// — which is what decides which shop a receiver is told to walk to —
	// measures to it from anywhere and puts every agent on the map in the
	// wrong order. Same range check as a zone, for the same reason: the
	// number feeds distance maths, so it has to be a real place.
	if e := validateZoneCoords(in.Lat, in.Lng); e != nil {
		return e
	}
	if in.Capacity <= 0 {
		return &ParcelError{"BAD_INPUT", "Shelf capacity must be at least 1"}
	}
	if in.HoldingFee < 0 {
		return &ParcelError{"BAD_INPUT", "Holding fee can't be negative"}
	}
	return nil
}

func CreateParcelAgent(ctx context.Context, pool *pgxpool.Pool, in ParcelAgentInput, staffID *string) (string, error) {
	if err := in.validate(); err != nil {
		return "", err
	}
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO parcel_agent (
			id, name, "partyId", "zoneId", lat, lng, msisdn, "locationHint",
			"openingHours", active, capacity, "holdingFeeKes", "createdAt", "createdByStaffId"
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12
		) RETURNING id`,
		in.Name, in.PartyID, in.ZoneID, in.Lat, in.Lng, in.Msisdn, in.LocationHint,
		in.OpeningHours, in.Active, in.Capacity, in.HoldingFee, staffID).Scan(&id)
	return id, err
}

func UpdateParcelAgent(ctx context.Context, pool *pgxpool.Pool, id string, in ParcelAgentInput) error {
	if err := in.validate(); err != nil {
		return err
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_agent SET
			name = $1, "partyId" = $2, "zoneId" = $3, lat = $4, lng = $5, msisdn = $6,
			"locationHint" = $7, "openingHours" = $8, active = $9, capacity = $10, "holdingFeeKes" = $11
		WHERE id = $12`,
		in.Name, in.PartyID, in.ZoneID, in.Lat, in.Lng, in.Msisdn,
		in.LocationHint, in.OpeningHours, in.Active, in.Capacity, in.HoldingFee, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That pickup point was not found"}
	}
	return nil
}

// ── Coverage tiers ───────────────────────────────────────────────────

// ParcelCoverageTier is one admin-editable cover level. The fee is
// FeeKes + declaredValue × FeePct/100, and MaxCoverKes caps what a claim
// can ever pay regardless of what was declared — a sender declaring a
// million shillings on a boda parcel buys the tier's ceiling, not their
// own number.
type ParcelCoverageTier struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	MaxCoverKes money.Amount `json:"maxCoverKes"`
	FeeKes      money.Amount `json:"feeKes"`
	// FeePct stays float64 deliberately: it is a rate, not an amount.
	// Percentages have no smallest unit to be exact about, and money.Cents
	// would imply one.
	FeePct    float64 `json:"feePct"`
	Active    bool    `json:"active"`
	SortOrder int     `json:"sortOrder"`
}

// CoverageFeeKes — what this tier costs for [declaredValueKes]. Kept a
// pure method rather than a query so both the quote endpoint and
// BookParcel's own freeze-it-in write derive the number identically,
// and so it's testable without a DB fixture (same reasoning
// nextHandoffStatus is pure).
// Exact end to end: the declared value arrives as cents, the tier's own
// figures are cents, and the result is frozen onto the parcel and
// written into a Decimal(12,2) column. There is no float in the path at
// all now — the earlier version converted in and out of float64 at the
// signature, which meant the boundary could still round differently from
// the arithmetic inside it.
func (t ParcelCoverageTier) CoverageFee(declared money.Cents) money.Cents {
	covered := declared.Min(t.MaxCoverKes.Cents())
	return t.FeeKes.Cents() + covered.Percent(t.FeePct)
}

// CoveredAmountKes — what a claim on this tier would actually pay out
// for [declaredValueKes]: the declared amount, capped at the tier
// ceiling. The sender-facing half of the same rule CoverageFeeKes
// prices against, surfaced so "covered up to KES X" is never a
// different number from what the fee was charged on.
func (t ParcelCoverageTier) CoveredAmount(declared money.Cents) money.Cents {
	return declared.Min(t.MaxCoverKes.Cents())
}

const coverageTierColumns = `id, name, "maxCoverKes"::text, "feeKes"::text, "feePct"::text, active, "sortOrder"`

func scanCoverageTier(row pgx.Row) (*ParcelCoverageTier, error) {
	var t ParcelCoverageTier
	var pctText string
	// The money columns scan straight into money.Amount via its
	// sql.Scanner — no intermediate string, no parseFloatOrZero. FeePct
	// still goes through a string because it is a rate, not an amount.
	if err := row.Scan(&t.ID, &t.Name, &t.MaxCoverKes, &t.FeeKes, &pctText, &t.Active, &t.SortOrder); err != nil {
		return nil, err
	}
	var err error
	if t.FeePct, err = parseFloatOrZero(pctText); err != nil {
		return nil, err
	}
	return &t, nil
}

func ListCoverageTiers(ctx context.Context, pool *pgxpool.Pool, activeOnly bool) ([]ParcelCoverageTier, error) {
	query := `SELECT ` + coverageTierColumns + ` FROM parcel_coverage_tier`
	if activeOnly {
		query += ` WHERE active = true`
	}
	query += ` ORDER BY "sortOrder" ASC, name ASC`
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelCoverageTier
	for rows.Next() {
		t, err := scanCoverageTier(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func GetCoverageTier(ctx context.Context, pool *pgxpool.Pool, id string) (*ParcelCoverageTier, error) {
	row := pool.QueryRow(ctx, `SELECT `+coverageTierColumns+` FROM parcel_coverage_tier WHERE id = $1`, id)
	t, err := scanCoverageTier(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

// UpsertCoverageTier — admin editing the rate card. Matched by name
// (its unique key) so the seeded Basic/Standard/Premium rows are edited
// in place rather than duplicated, same "one row per named thing"
// shape SetParcelDistanceRate keeps.
func UpsertCoverageTier(ctx context.Context, pool *pgxpool.Pool, t ParcelCoverageTier, staffID string) error {
	if strings.TrimSpace(t.Name) == "" {
		return &ParcelError{"BAD_INPUT", "A cover level needs a name"}
	}
	if !t.MaxCoverKes.Cents().IsPositive() {
		return &ParcelError{"BAD_INPUT", "Maximum cover must be more than zero"}
	}
	if t.FeeKes.Cents() < 0 || t.FeePct < 0 {
		return &ParcelError{"BAD_INPUT", "Fees can't be negative"}
	}
	// ::numeric on the money params: money.Amount's driver.Valuer hands
	// pgx an exact decimal string, and the cast is what lets a numeric
	// column take it without a float round-trip.
	_, err := pool.Exec(ctx, `
		INSERT INTO parcel_coverage_tier (id, name, "maxCoverKes", "feeKes", "feePct", active, "sortOrder", "updatedAt", "updatedById")
		VALUES (gen_random_uuid(), $1, $2::numeric, $3::numeric, $4, $5, $6, now(), $7)
		ON CONFLICT (name) DO UPDATE SET
			"maxCoverKes" = EXCLUDED."maxCoverKes", "feeKes" = EXCLUDED."feeKes",
			"feePct" = EXCLUDED."feePct", active = EXCLUDED.active,
			"sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now(), "updatedById" = EXCLUDED."updatedById"`,
		t.Name, t.MaxCoverKes, t.FeeKes, t.FeePct, t.Active, t.SortOrder, staffID)
	return err
}

// parseAgentFee is the one place a *string money column coming back
// from a parcel row turns into a float for arithmetic — kept here
// rather than inline so the "null means zero, not an error" rule is
// stated once.
func parseAgentFee(s *string) (float64, error) {
	if s == nil || *s == "" {
		return 0, nil
	}
	return strconv.ParseFloat(*s, 64)
}
