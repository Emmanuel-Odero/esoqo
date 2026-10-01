// Package dbx (parcel_orgs.go) — courier companies as real tenants.
//
// Every parcel used to belong to Esoqo-run dispatch: couriers, teams,
// fleets and rate cards all lived under /admin, and a partner courier
// company logged into nothing at all. This file is the operator side —
// the company, its own staff with their own PIN logins, its own rate
// card, and the revenue split that makes carrying a parcel worth
// something to it.
//
// The scoping rule, stated once: a parcel-company AGENT session carries
// ParcelOrgID, and every read and write below is filtered by it. There
// is no "see everything" path for an org session — that's what the
// Esoqo admin console's parcels.* capabilities are for, and mixing the
// two vocabularies is exactly what tenancy exists to prevent.
package dbx

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/esoqo/core-go/internal/fleetqr"
	"github.com/esoqo/core-go/internal/money"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ParcelOrgStatus values. Plain strings for the same reason
// CourierTeamMember.role is — this list grows by a string far more
// often than it needs a migration.
const (
	ParcelOrgDraft     = "DRAFT"
	ParcelOrgActive    = "ACTIVE"
	ParcelOrgSuspended = "SUSPENDED"
)

type ParcelOrg struct {
	ID              string  `json:"id"`
	EnterpriseID    string  `json:"enterpriseId"`
	Name            string  `json:"name"`
	Slug            string  `json:"slug"`
	Status          string  `json:"status"`
	ContactPerson   *string `json:"contactPerson"`
	ContactPhone    *string `json:"contactPhone"`
	ContactEmail    *string `json:"contactEmail"`
	SettlementPhone *string `json:"settlementPhone"`
	CommissionPct   float64 `json:"commissionPct"`
	// AcceptsWalkIn/Lat/Lng/LocationHint/OpeningHours — see
	// ParcelOrg.acceptsWalkIn's own schema comment. Lat/Lng nil when the
	// company hasn't set a desk location yet, same optionality
	// ParcelAgent's own coordinates don't have (an agent is onboarded
	// with a place; a company might not accept walk-ins at all).
	AcceptsWalkIn bool     `json:"acceptsWalkIn"`
	Lat           *float64 `json:"lat"`
	Lng           *float64 `json:"lng"`
	LocationHint  *string  `json:"locationHint"`
	OpeningHours  *string  `json:"openingHours"`
	// Co-branded label assets. LogoUrl prints centered in the label
	// header band (never over QR/barcode); null = Esoqo branding alone.
	LogoStorageKey *string `json:"logoStorageKey"`
	LogoUrl        *string `json:"logoUrl"`
	BrandAccent    *string `json:"brandAccent"`
}

const parcelOrgColumns = `
	id, "enterpriseId", name, slug, status, "contactPerson", "contactPhone",
	"contactEmail", "settlementPhone", "commissionPct"::text,
	"acceptsWalkIn", lat::text, lng::text, "locationHint", "openingHours",
	"logoStorageKey", "logoUrl", "brandAccent"`

func scanParcelOrg(row pgx.Row) (*ParcelOrg, error) {
	var o ParcelOrg
	var commissionText string
	var latText, lngText *string
	if err := row.Scan(&o.ID, &o.EnterpriseID, &o.Name, &o.Slug, &o.Status,
		&o.ContactPerson, &o.ContactPhone, &o.ContactEmail, &o.SettlementPhone,
		&commissionText, &o.AcceptsWalkIn, &latText, &lngText, &o.LocationHint, &o.OpeningHours,
		&o.LogoStorageKey, &o.LogoUrl, &o.BrandAccent); err != nil {
		return nil, err
	}
	var err error
	if o.CommissionPct, err = parseFloatOrZero(commissionText); err != nil {
		return nil, err
	}
	if latText != nil {
		v, perr := parseFloatOrZero(*latText)
		if perr != nil {
			return nil, perr
		}
		o.Lat = &v
	}
	if lngText != nil {
		v, perr := parseFloatOrZero(*lngText)
		if perr != nil {
			return nil, perr
		}
		o.Lng = &v
	}
	return &o, nil
}

// slugPattern — lowercase letters, digits and hyphens. This value ends
// up in a URL staff are given verbally ("go to esoqo slash parcel-co
// slash swift-riders"), so anything that needs escaping or explaining
// out loud is worse than useless.
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type ParcelOrgInput struct {
	EnterpriseID    string
	Name            string
	Slug            string
	ContactPerson   *string
	ContactPhone    *string
	ContactEmail    *string
	SettlementPhone *string
	CommissionPct   float64
	Status          string
	AcceptsWalkIn   bool
	Lat             *float64
	Lng             *float64
	LocationHint    *string
	OpeningHours    *string
	LogoStorageKey  *string
	LogoUrl         *string
	BrandAccent     *string
}

func (in ParcelOrgInput) validate() error {
	if strings.TrimSpace(in.Name) == "" {
		return &ParcelError{"BAD_INPUT", "Give the company a name"}
	}
	if !slugPattern.MatchString(in.Slug) {
		return &ParcelError{"BAD_INPUT", "The slug can only be lowercase letters, numbers and hyphens"}
	}
	// Above 100% Esoqo would be charging the company to carry a parcel,
	// which is never what anyone meant to type.
	if in.CommissionPct < 0 || in.CommissionPct > 100 {
		return &ParcelError{"BAD_INPUT", "Commission must be between 0 and 100 percent"}
	}
	// A walk-in desk with no location text is a station nobody could
	// actually find — same "don't half-fill a physical place" rule
	// ParcelAgent's own required locationHint already enforces.
	if in.AcceptsWalkIn && (in.LocationHint == nil || strings.TrimSpace(*in.LocationHint) == "") {
		return &ParcelError{"BAD_INPUT", "Give the walk-in desk a location description"}
	}
	// Brand accent is an optional hex colour for the label header — a
	// stray string here must never break printing, so validate loosely.
	if in.BrandAccent != nil && strings.TrimSpace(*in.BrandAccent) != "" {
		trimmed := strings.TrimSpace(*in.BrandAccent)
		matched, _ := regexp.MatchString(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`, trimmed)
		if !matched {
			return &ParcelError{"BAD_INPUT", "Brand accent must be a hex colour like #1a73e8"}
		}
	}
	return nil
}

func ListParcelOrgs(ctx context.Context, pool *pgxpool.Pool) ([]ParcelOrg, error) {
	rows, err := pool.Query(ctx, `SELECT `+parcelOrgColumns+` FROM parcel_org ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelOrg
	for rows.Next() {
		o, err := scanParcelOrg(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// AdminParcelOrg — one row of the operator's courier-company register.
//
// The plain ParcelOrg is the tenant's own view of itself; this is the
// operator's, so it carries the facts an admin page needs to answer
// "who runs this, who works here, and does it actually carry anything"
// without an N+1 of separate calls. The owning business name and the
// primary manager are surfaced explicitly so the company is never
// rendered as if the contact person *were* the company.
type AdminParcelOrg struct {
	ParcelOrg
	EnterpriseName string       `json:"enterpriseName"`
	OwnerPartyID   string       `json:"ownerPartyId"`
	StaffCount     int          `json:"staffCount"`
	ActiveStaff    int          `json:"activeStaff"`
	ParcelCount    int          `json:"parcelCount"`
	DeliveredCount int          `json:"deliveredCount"`
	EarningsKes    money.Amount `json:"earningsKes"`
	// PrimaryContactName/Phone — the first flagged contact person on the
	// roster (active ones first), else the first MANAGER, not
	// ParcelOrg.contactPerson. A contact is a person and people leave; the
	// company outlives them. Falls back to the legacy
	// contactPerson/contactPhone pair only when neither exists, so data an
	// admin typed before this split is never silently lost.
	PrimaryContactName  *string `json:"primaryContactName"`
	PrimaryContactPhone *string `json:"primaryContactPhone"`
}

const adminParcelOrgColumns = `
	o.id, o."enterpriseId", o.name, o.slug, o.status, o."contactPerson", o."contactPhone",
	o."contactEmail", o."settlementPhone", o."commissionPct"::text,
	o."acceptsWalkIn", o.lat::text, o.lng::text, o."locationHint", o."openingHours",
	o."logoStorageKey", o."logoUrl", o."brandAccent",
	COALESCE(org."knownAs", org."officialName", pr."knownAs", pr."officialName", e."workRaw", o.name),
	e."partyId"::text,
	(SELECT count(*) FROM parcel_org_staff st WHERE st."orgId" = o.id),
	(SELECT count(*) FROM parcel_org_staff st WHERE st."orgId" = o.id AND st.active),
	(SELECT count(*) FROM parcel p WHERE p."parcelOrgId" = o.id AND p.status <> 'CANCELLED'),
	(SELECT count(*) FROM parcel p WHERE p."parcelOrgId" = o.id AND p.status = 'DELIVERED'),
	COALESCE((SELECT sum(p."orgEarningsKes") FROM parcel p WHERE p."parcelOrgId" = o.id), 0)::float8,
	COALESCE(mgr.name, o."contactPerson"), COALESCE(mgr.msisdn, o."contactPhone")`

const adminParcelOrgJoins = `
	FROM parcel_org o
	JOIN enterprise e ON e.id = o."enterpriseId"
	LEFT JOIN organisation org ON org."partyId" = e."partyId"
	LEFT JOIN person pr ON pr."partyId" = e."partyId"
	LEFT JOIN LATERAL (
		SELECT st.name, pr2.msisdn
		FROM parcel_org_staff st
		LEFT JOIN person pr2 ON pr2."partyId" = st."partyId"
		WHERE st."orgId" = o.id AND (st."isContact" OR st.role = 'MANAGER')
		ORDER BY st."isContact" DESC, st.active DESC, st."createdAt" ASC
		LIMIT 1
	) mgr ON true`

func scanAdminParcelOrg(row pgx.Row) (*AdminParcelOrg, error) {
	var o AdminParcelOrg
	var commissionText string
	var latText, lngText *string
	if err := row.Scan(&o.ID, &o.EnterpriseID, &o.Name, &o.Slug, &o.Status,
		&o.ContactPerson, &o.ContactPhone, &o.ContactEmail, &o.SettlementPhone,
		&commissionText, &o.AcceptsWalkIn, &latText, &lngText, &o.LocationHint, &o.OpeningHours,
		&o.LogoStorageKey, &o.LogoUrl, &o.BrandAccent,
		&o.EnterpriseName, &o.OwnerPartyID,
		&o.StaffCount, &o.ActiveStaff, &o.ParcelCount, &o.DeliveredCount, &o.EarningsKes,
		&o.PrimaryContactName, &o.PrimaryContactPhone); err != nil {
		return nil, err
	}
	var err error
	if o.CommissionPct, err = parseFloatOrZero(commissionText); err != nil {
		return nil, err
	}
	if latText != nil {
		v, perr := parseFloatOrZero(*latText)
		if perr != nil {
			return nil, perr
		}
		o.Lat = &v
	}
	if lngText != nil {
		v, perr := parseFloatOrZero(*lngText)
		if perr != nil {
			return nil, perr
		}
		o.Lng = &v
	}
	return &o, nil
}

// ListAdminParcelOrgs — the whole register, with per-company counts and
// earnings for the admin page's table and KPIs.
func ListAdminParcelOrgs(ctx context.Context, pool *pgxpool.Pool) ([]AdminParcelOrg, error) {
	rows, err := pool.Query(ctx, `SELECT `+adminParcelOrgColumns+adminParcelOrgJoins+` ORDER BY o.name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminParcelOrg
	for rows.Next() {
		o, err := scanAdminParcelOrg(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// GetAdminParcelOrg — one company for the admin detail view.
func GetAdminParcelOrg(ctx context.Context, pool *pgxpool.Pool, id string) (*AdminParcelOrg, error) {
	o, err := scanAdminParcelOrg(pool.QueryRow(ctx, `SELECT `+adminParcelOrgColumns+adminParcelOrgJoins+` WHERE o.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return o, err
}

// ParcelOrgActivity — one line of a company's own audit trail. The
// audit_event feed is append-only and already hash-chained, which is why
// the admin page reads it rather than keeping a second changelog.
type ParcelOrgActivity struct {
	OccurredAt string      `json:"occurredAt"`
	ActorType  string      `json:"actorType"`
	ActorID    *string     `json:"actorId"`
	Action     string      `json:"action"`
	Payload    interface{} `json:"payload"`
}

// ListParcelOrgActivity reads the audit_event rows written against this
// company (targetType "parcel_org"), newest first.
func ListParcelOrgActivity(ctx context.Context, pool *pgxpool.Pool, orgID string, limit int) ([]ParcelOrgActivity, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := pool.Query(ctx, `
		SELECT to_char("occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       "actorType", "actorId", action, payload
		FROM audit_event
		WHERE "targetType" = 'parcel_org' AND "targetId" = $1
		ORDER BY id DESC
		LIMIT $2`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelOrgActivity
	for rows.Next() {
		var a ParcelOrgActivity
		var payloadRaw []byte
		if err := rows.Scan(&a.OccurredAt, &a.ActorType, &a.ActorID, &a.Action, &payloadRaw); err != nil {
			return nil, err
		}
		var payload interface{}
		if len(payloadRaw) > 0 {
			_ = json.Unmarshal(payloadRaw, &payload) // malformed payload → nil, rendered as no-detail
		}
		a.Payload = payload
		out = append(out, a)
	}
	return out, rows.Err()
}

func GetParcelOrg(ctx context.Context, pool *pgxpool.Pool, id string) (*ParcelOrg, error) {
	o, err := scanParcelOrg(pool.QueryRow(ctx, `SELECT `+parcelOrgColumns+` FROM parcel_org WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return o, err
}

// GetParcelOrgNameSlug — the two fields an admin-invite SMS needs to
// compose (the company's display name, and the slug the sign-in link
// points at), for an org id an admin session already has from the
// path. Unlike GetParcelOrgBySlug this doesn't filter out DRAFT: an
// admin onboarding a company's first manager before flipping it ACTIVE
// still needs to be able to invite that manager.
func GetParcelOrgNameSlug(ctx context.Context, pool *pgxpool.Pool, orgID string) (name, slug string, err error) {
	err = pool.QueryRow(ctx, `SELECT name, slug FROM parcel_org WHERE id = $1`, orgID).Scan(&name, &slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", &ParcelError{"NOT_FOUND", "That company was not found"}
	}
	return name, slug, err
}

// GetParcelOrgBySlug backs the public staff sign-in page, which needs
// to show the company's name before anyone has authenticated. Returns
// only what that page renders — never the commission or the settlement
// phone, both of which are commercial terms and neither of which a
// sign-in screen has any reason to know.
func GetParcelOrgBySlug(ctx context.Context, pool *pgxpool.Pool, slug string) (*ParcelOrg, error) {
	o, err := scanParcelOrg(pool.QueryRow(ctx,
		`SELECT `+parcelOrgColumns+` FROM parcel_org WHERE slug = $1 AND status != 'DRAFT'`, slug))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return o, err
}

func CreateParcelOrg(ctx context.Context, pool *pgxpool.Pool, in ParcelOrgInput, staffID *string) (string, error) {
	if err := in.validate(); err != nil {
		return "", err
	}
	if in.Status == "" {
		in.Status = ParcelOrgDraft
	}
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO parcel_org (
			id, "enterpriseId", name, slug, status, "contactPerson", "contactPhone",
			"contactEmail", "settlementPhone", "commissionPct",
			"acceptsWalkIn", lat, lng, "locationHint", "openingHours",
			"logoStorageKey", "logoUrl", "brandAccent",
			"createdAt", "updatedAt", "createdByStaffId"
		) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), now(), $18)
		RETURNING id`,
		in.EnterpriseID, in.Name, in.Slug, in.Status, in.ContactPerson, in.ContactPhone,
		in.ContactEmail, in.SettlementPhone, in.CommissionPct,
		in.AcceptsWalkIn, in.Lat, in.Lng, in.LocationHint, in.OpeningHours,
		in.LogoStorageKey, in.LogoUrl, in.BrandAccent, staffID).Scan(&id)
	if isUniqueViolation(err) {
		return "", &ParcelError{"BAD_INPUT", "That slug is already taken"}
	}
	return id, err
}

func UpdateParcelOrg(ctx context.Context, pool *pgxpool.Pool, id string, in ParcelOrgInput) error {
	if err := in.validate(); err != nil {
		return err
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_org SET
			name = $1, slug = $2, status = $3, "contactPerson" = $4, "contactPhone" = $5,
			"contactEmail" = $6, "settlementPhone" = $7, "commissionPct" = $8,
			"acceptsWalkIn" = $9, lat = $10, lng = $11, "locationHint" = $12, "openingHours" = $13,
			"logoStorageKey" = $14, "logoUrl" = $15, "brandAccent" = $16,
			"updatedAt" = now()
		WHERE id = $17`,
		in.Name, in.Slug, in.Status, in.ContactPerson, in.ContactPhone,
		in.ContactEmail, in.SettlementPhone, in.CommissionPct,
		in.AcceptsWalkIn, in.Lat, in.Lng, in.LocationHint, in.OpeningHours,
		in.LogoStorageKey, in.LogoUrl, in.BrandAccent, id)
	if isUniqueViolation(err) {
		return &ParcelError{"BAD_INPUT", "That slug is already taken"}
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That company was not found"}
	}
	return nil
}

// WalkInStation is the public, customer-facing projection of a
// walk-in-capable ParcelOrg — the booking form's "pick where you're
// standing" list. Deliberately not the full ParcelOrg: no slug, no
// contact/settlement details, no commission — a sender choosing a
// drop-off point has no more business seeing those than a receiver
// picking a ParcelAgent pickup point does.
type WalkInStation struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	LocationHint string   `json:"locationHint"`
	OpeningHours *string  `json:"openingHours"`
	Lat          *float64 `json:"lat"`
	Lng          *float64 `json:"lng"`
}

// ListWalkInStations — active, walk-in-capable companies a sender can
// physically hand a parcel to, same "active-only for the public picker"
// convention ListParcelAgents already follows. Esoqo's own counters are
// not modelled here at all yet (see CounterForm, which staff already
// use without needing this list); this is only the partner-company
// half of "somewhere to drop it off in person".
func ListWalkInStations(ctx context.Context, pool *pgxpool.Pool) ([]WalkInStation, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, name, "locationHint", "openingHours", lat::text, lng::text
		FROM parcel_org
		WHERE "acceptsWalkIn" = true AND status = 'ACTIVE'
		ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WalkInStation
	for rows.Next() {
		var s WalkInStation
		var hint *string
		var latText, lngText *string
		if err := rows.Scan(&s.ID, &s.Name, &hint, &s.OpeningHours, &latText, &lngText); err != nil {
			return nil, err
		}
		if hint != nil {
			s.LocationHint = *hint
		}
		if latText != nil {
			v, perr := parseFloatOrZero(*latText)
			if perr != nil {
				return nil, perr
			}
			s.Lat = &v
		}
		if lngText != nil {
			v, perr := parseFloatOrZero(*lngText)
			if perr != nil {
				return nil, perr
			}
			s.Lng = &v
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// EnterpriseLite — a candidate owner for a new courier company, for the
// admin's picker. Deliberately a search rather than a full list: the
// enterprise table is every business on the platform, and an
// onboarding form does not need to render all of them.
type EnterpriseLite struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	PartyID string  `json:"partyId"`
	Msisdn  *string `json:"msisdn"`
}

// SearchEnterprises — was querying e.name, a column that has never
// existed on "enterprise" (it only ever had workRaw — the free-text
// occupation someone typed at registration, like "carpentry", never a
// business name). Every call errored, which is why this search always
// came back empty regardless of what was typed. The display name a
// courier-company onboarding admin actually wants is the owning
// party's real name: the org's knownAs/officialName when the party is
// an Organisation, the person's knownAs/officialName when it's an
// individual proprietor — workRaw only as a last-resort fallback if
// somehow neither is set.
func SearchEnterprises(ctx context.Context, pool *pgxpool.Pool, q string) ([]EnterpriseLite, error) {
	rows, err := pool.Query(ctx, `
		SELECT e.id, COALESCE(org."knownAs", org."officialName", pr."knownAs", pr."officialName", e."workRaw"),
		       e."partyId", pr.msisdn
		FROM enterprise e
		LEFT JOIN organisation org ON org."partyId" = e."partyId"
		LEFT JOIN person pr ON pr."partyId" = e."partyId"
		WHERE COALESCE(org."knownAs", org."officialName", pr."knownAs", pr."officialName", e."workRaw") ILIKE '%'||$1||'%'
		ORDER BY 2 ASC
		LIMIT 20`, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EnterpriseLite
	for rows.Next() {
		var e EnterpriseLite
		if err := rows.Scan(&e.ID, &e.Name, &e.PartyID, &e.Msisdn); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// CreateEnterpriseForCourierOrg — an admin onboarding a courier company
// creates the owning business record directly, no OTP.
//
// Every other path into `enterprise` runs through completeRegistration
// (packages/db/src/dal/registration.ts), gated on the registrant
// verifying their own phone via /join — appropriate for a self-serve
// signup, but the admin console had no way to satisfy it at all: the
// "Which business runs it?" picker could only ever find a business
// that had separately, successfully self-registered first, with
// nothing surfaced when (as is the common case for a courier company's
// first onboarding) none has. This is staff vouching for a real
// business they're onboarding in person — the same trust boundary
// FindOrCreatePersonWithName already uses for admin-invited courier
// staff, mirrored here: party, then the typed record, in one
// transaction. isRegistered/hasKraPin are left at their honest
// false/default — nobody has actually verified paperwork here, unlike
// the seed's EnsureEnterprise, which is fake data and can claim both.
func CreateEnterpriseForCourierOrg(ctx context.Context, pool *pgxpool.Pool, businessName string) (enterpriseID string, err error) {
	name := strings.TrimSpace(businessName)
	if name == "" {
		return "", &ParcelError{"BAD_INPUT", "Give the business a name"}
	}
	tx, terr := pool.Begin(ctx)
	if terr != nil {
		return "", terr
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var partyID string
	if qerr := tx.QueryRow(ctx, `
		INSERT INTO party (id, kind, county, "sourceSystem", "updatedAt")
		VALUES (gen_random_uuid(), 'ORGANISATION', 'Unknown', 'ESOKO', now())
		RETURNING id`).Scan(&partyID); qerr != nil {
		return "", qerr
	}
	if _, ierr := tx.Exec(ctx, `
		INSERT INTO organisation ("partyId", kind, "officialName")
		VALUES ($1, 'BUSINESS', $2)`, partyID, name); ierr != nil {
		return "", ierr
	}
	if qerr := tx.QueryRow(ctx, `
		INSERT INTO enterprise (id, "partyId", "workRaw", "createdAt")
		VALUES (gen_random_uuid(), $1, 'Courier / parcel delivery', now())
		RETURNING id`, partyID).Scan(&enterpriseID); qerr != nil {
		return "", qerr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return "", cerr
	}
	return enterpriseID, nil
}

// ── Staff ────────────────────────────────────────────────────────────

type ParcelOrgStaff struct {
	ID     string `json:"id"`
	OrgID  string `json:"orgId"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Active bool   `json:"active"`
	// IsContact — one of the company's contact people (multiple allowed).
	// The register's primary-contact projection prefers these over the
	// first manager and the legacy parcel_org.contactPerson fallback.
	IsContact bool    `json:"isContact"`
	PartyID   *string `json:"partyId"`
	StationID *string `json:"stationId"`
	// Msisdn / EsoqoID — the phone and the ESK-… handle this person can
	// sign in with, joined out from their Party. Surfaced so an admin can
	// read a login back to someone who forgot it, and so the roster shows
	// a credential actually exists rather than a bare uuid. Both nil for
	// an office-only login that was never linked to a person.
	Msisdn  *string `json:"msisdn"`
	EsoqoID *string `json:"esoqoId"`
	// Capabilities — a custom ("Other…") role's explicit permission set.
	// Empty for a preset role, whose bundle is resolved from Role instead
	// (see authsvc.ParcelStaffCapabilitiesForRole). Surfaced so the admin
	// and company team screens can show and edit what a custom role
	// actually grants.
	Capabilities []string `json:"capabilities"`
}

// ParcelStaffForSignIn carries the hash, so it is never the type
// returned to a client — the same split FindTicketStaffForSignIn keeps.
type ParcelStaffForSignIn struct {
	ID      string
	OrgID   string
	Name    string
	Role    string
	Active  bool
	PinHash string
	PartyID *string
	// Capabilities — a custom role's explicit permission set. Empty for
	// a preset role, whose bundle is resolved from Role at sign-in.
	Capabilities []string
}

// FindParcelStaffForSignIn resolves an org slug plus a free-typed name.
//
// Free text rather than a staff picker, for the same anti-enumeration
// reason cashier and organiser-staff sign-in both use one: a dropdown
// of "who works here" is a roster anyone with the public slug can read.
// Returns nil (not an error) on a miss so the caller can still verify
// against a dummy hash and keep the timing of a wrong name and a wrong
// PIN indistinguishable.
func FindParcelStaffForSignIn(ctx context.Context, pool *pgxpool.Pool, orgSlug, name string) (*ParcelStaffForSignIn, error) {
	var s ParcelStaffForSignIn
	err := pool.QueryRow(ctx, `
		SELECT st.id, st."orgId", st.name, st.role, st.active, st."pinHash", st."partyId"::text, st.capabilities
		FROM parcel_org_staff st
		JOIN parcel_org o ON o.id = st."orgId"
		WHERE o.slug = $1 AND lower(st.name) = lower($2) AND o.status = 'ACTIVE'`,
		orgSlug, strings.TrimSpace(name)).
		Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.PinHash, &s.PartyID, &s.Capabilities)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func FindParcelStaffForSignInByPartyID(ctx context.Context, pool *pgxpool.Pool, orgSlug, partyID string) (*ParcelStaffForSignIn, error) {
	var s ParcelStaffForSignIn
	err := pool.QueryRow(ctx, `SELECT st.id, st."orgId", st.name, st.role, st.active, st."pinHash", st."partyId"::text, st.capabilities FROM parcel_org_staff st JOIN parcel_org o ON o.id = st."orgId" WHERE o.slug = $1 AND st."partyId" = $2 AND o.status = 'ACTIVE'`, orgSlug, partyID).
		Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.PinHash, &s.PartyID, &s.Capabilities)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// ParcelStaffMsisdn resolves the phone number an OTP-based sign-in
// would text — the staffer's own partyId, joined out to person.msisdn,
// never a number the caller supplies. Empty when the staff row has no
// partyId at all (an office-only MANAGER login, by design — see the
// seed data's own comment on why a manager never carries one) or when
// that party has no msisdn on file; either way OTP sign-in simply isn't
// available for that row, and the caller must fall back to the
// name+PIN flow instead.
func ParcelStaffMsisdn(ctx context.Context, pool *pgxpool.Pool, orgSlug, name string) (msisdn string, err error) {
	err = pool.QueryRow(ctx, `
		SELECT pr.msisdn
		FROM parcel_org_staff st
		JOIN parcel_org o ON o.id = st."orgId"
		JOIN person pr ON pr."partyId" = st."partyId"
		WHERE o.slug = $1 AND lower(st.name) = lower($2) AND o.status = 'ACTIVE' AND st.active`,
		orgSlug, strings.TrimSpace(name)).Scan(&msisdn)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return msisdn, err
}

// FindParcelStaffForSignInByOrgAndParty — the one-click entry's
// authorization check: does this signed-in Person hold an active staff
// row on THIS company, and if so what role. Keyed by org id (not slug)
// because the dashboard already has the id from /v1/me/parcel-orgs.
//
// Requires the company to be ACTIVE, same as every other sign-in path
// (FindParcelStaffForSignIn's own WHERE clause) — a DRAFT or suspended
// tenant is not somewhere a click should drop someone into. Returns nil
// (not an error) on a miss so the handler can answer a flat 403.
func FindParcelStaffForSignInByOrgAndParty(ctx context.Context, pool *pgxpool.Pool, orgID, partyID string) (*ParcelStaffForSignIn, error) {
	var s ParcelStaffForSignIn
	err := pool.QueryRow(ctx, `
		SELECT st.id, st."orgId", st.name, st.role, st.active, st."pinHash", st."partyId"::text, st.capabilities
		FROM parcel_org_staff st
		JOIN parcel_org o ON o.id = st."orgId"
		WHERE st."orgId" = $1 AND st."partyId" = $2 AND st.active AND o.status = 'ACTIVE'`,
		orgID, partyID).
		Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.PinHash, &s.PartyID, &s.Capabilities)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func ListParcelOrgStaff(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]ParcelOrgStaff, error) {
	rows, err := pool.Query(ctx, `
		SELECT st.id, st."orgId", st.name, st.role, st.active, st."isContact", st."partyId"::text, st."stationId"::text,
		       pr.msisdn, epi.code, st.capabilities
		FROM parcel_org_staff st
		LEFT JOIN person pr ON pr."partyId" = st."partyId"
		LEFT JOIN esoko_payment_id epi ON epi."partyId" = st."partyId"
		WHERE st."orgId" = $1 ORDER BY st.name ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelOrgStaff
	for rows.Next() {
		var s ParcelOrgStaff
		if err := rows.Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.IsContact, &s.PartyID, &s.StationID, &s.Msisdn, &s.EsoqoID, &s.Capabilities); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// MyParcelOrg — one courier company the signed-in person is on the
// books of. The subject-side mirror of ParcelOrgStaff: where that lists
// a company's people to a manager, this answers "which companies am I
// staff of", which nothing else exposes. A person can hold a
// parcel_org_staff row linked by partyId and still carry only a plain
// SUBJECT session, so the dashboard has no other way to learn the
// company exists.
type MyParcelOrg struct {
	OrgID  string `json:"orgId"`
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Status string `json:"status"`
	Role   string `json:"role"`
}

// ListMyParcelOrgs — self-scoped by partyID, which the caller must take
// from the session (ctx.PartyID), never a request param; there is
// nothing to authorise beyond "this is you". Only active staff rows are
// returned, so a removed member stops seeing the company immediately.
// A suspended/ draft company is still listed, with its status, because
// the person is genuinely on its books — it is the UI's job to say the
// company isn't trading yet.
func ListMyParcelOrgs(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]MyParcelOrg, error) {
	rows, err := pool.Query(ctx, `
		SELECT o.id, o.name, o.slug, o.status, st.role
		FROM parcel_org_staff st
		JOIN parcel_org o ON o.id = st."orgId"
		WHERE st."partyId" = $1 AND st.active
		ORDER BY o.name ASC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MyParcelOrg
	for rows.Next() {
		var o MyParcelOrg
		if err := rows.Scan(&o.OrgID, &o.Name, &o.Slug, &o.Status, &o.Role); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// ── Live dispatch ────────────────────────────────────────────────

// OrgLiveRider — one roster member's latest position. Company riders
// ping through the same parcel_courier_ping feed platform couriers do
// when they run the mobile app (there is only one ping table); the join
// to parcel_org_staff is what scopes someone else's dots out of this
// company's map. Only the last hour — a dot older than that says where
// somebody was, not where they are.
type OrgLiveRider struct {
	PartyID string `json:"partyId"`
	Name    string `json:"name"`
	Role    string `json:"role"`
	Lat     string `json:"lat"`
	Lng     string `json:"lng"`
	At      string `json:"at"`
}

// OrgLiveParcel — one parcel that either needs a rider or is running
// late, positioned by its origin zone. Same "needs work" set the admin
// live map shows, scoped to this company's own parcels.
type OrgLiveParcel struct {
	Code     string  `json:"code"`
	Status   string  `json:"status"`
	Lat      *string `json:"lat"`
	Lng      *string `json:"lng"`
	Overdue  bool    `json:"overdue"`
	Receiver string  `json:"receiverName"`
}

// OrgLiveView — everything the company's live dispatch map needs in one
// round trip, plus the stations that anchor it.
type OrgLiveView struct {
	Riders   []OrgLiveRider    `json:"riders"`
	Parcels  []OrgLiveParcel   `json:"parcels"`
	Stations []ParcelOrgStation `json:"stations"`
}

// GetOrgLiveView — the company's own live dispatch: rider dots, parcels
// needing a rider or running late, and stations. Read capability: every
// role on the roster holds parcelorg.read, so a rider sees the same map
// as the dispatcher — the data is operational, not privileged.
func GetOrgLiveView(ctx context.Context, pool *pgxpool.Pool, orgID string) (*OrgLiveView, error) {
	view := &OrgLiveView{}

	riderRows, err := pool.Query(ctx, `
		SELECT DISTINCT ON (st."partyId")
		       st."partyId"::text, st.name, st.role, p.lat::text, p.lng::text, p.at::text
		FROM parcel_courier_ping p
		JOIN parcel_org_staff st ON st."partyId" = p."courierPartyId"
		WHERE st."orgId" = $1 AND st.active AND p.at > now() - interval '1 hour'
		ORDER BY st."partyId", p.at DESC`, orgID)
	if err != nil {
		return nil, err
	}
	for riderRows.Next() {
		var r OrgLiveRider
		if err := riderRows.Scan(&r.PartyID, &r.Name, &r.Role, &r.Lat, &r.Lng, &r.At); err != nil {
			riderRows.Close()
			return nil, err
		}
		view.Riders = append(view.Riders, r)
	}
	riderRows.Close()
	if err := riderRows.Err(); err != nil {
		return nil, err
	}

	parcelRows, err := pool.Query(ctx, `
		SELECT p.code, p.status::text, z.lat::text, z.lng::text,
		       (p."slaDeadlineAt" IS NOT NULL AND p."slaDeadlineAt" < now()),
		       p."receiverName"
		FROM parcel p
		LEFT JOIN parcel_zone z ON z.id = p."originZoneId"
		WHERE p."parcelOrgId" = $1
		  AND ((p.status IN ('BOOKED', 'RECEIVED_AT_COUNTER') AND p."assignedCollectorPartyId" IS NULL)
		    OR (p.status IN ('PICKED_UP', 'IN_TRANSIT') AND p."slaDeadlineAt" IS NOT NULL AND p."slaDeadlineAt" < now()))
		ORDER BY p."createdAt" DESC
		LIMIT 100`, orgID)
	if err != nil {
		return nil, err
	}
	for parcelRows.Next() {
		var p OrgLiveParcel
		if err := parcelRows.Scan(&p.Code, &p.Status, &p.Lat, &p.Lng, &p.Overdue, &p.Receiver); err != nil {
			parcelRows.Close()
			return nil, err
		}
		view.Parcels = append(view.Parcels, p)
	}
	parcelRows.Close()
	if err := parcelRows.Err(); err != nil {
		return nil, err
	}

	stations, err := ListParcelOrgStations(ctx, pool, orgID)
	if err != nil {
		return nil, err
	}
	for _, s := range stations {
		if s.Active {
			view.Stations = append(view.Stations, s)
		}
	}
	if view.Riders == nil {
		view.Riders = []OrgLiveRider{}
	}
	if view.Parcels == nil {
		view.Parcels = []OrgLiveParcel{}
	}
	if view.Stations == nil {
		view.Stations = []ParcelOrgStation{}
	}
	return view, nil
}

// ── Label scan & attach (org-scoped) ─────────────────────────────

// OrgParcelLabel — one of the company's labels as a scanner sees it:
// the stock row, whatever field notes have been attached, and the
// parcel it was spent on, if any.
type OrgParcelLabel struct {
	Code            string  `json:"code"`
	State           string  `json:"state"`
	ItemDescription *string `json:"itemDescription"`
	Destination     *string `json:"destination"`
	SenderName      *string `json:"senderName"`
	SenderMsisdn    *string `json:"senderMsisdn"`
	ReceiverName    *string `json:"receiverName"`
	ReceiverMsisdn  *string `json:"receiverMsisdn"`
	// What the field handler recorded beyond names: the eyeballed item
	// type and any tape-measure readings. Carried into a counter
	// booking rather than re-asked — same contract as the admin
	// label-info read, so the company counter resumes exactly where
	// the field left off.
	ItemType      *string  `json:"itemType"`
	WeightRangeKg *string  `json:"weightRangeKg"`
	LengthCm      *float64 `json:"lengthCm"`
	WidthCm       *float64 `json:"widthCm"`
	HeightCm      *float64 `json:"heightCm"`
	UsedAt          *string `json:"usedAt"`
	VoidedAt        *string `json:"voidedAt"`
	VoidedReason    *string `json:"voidedReason"`
	ParcelID        *string `json:"parcelId"`
	ParcelCode      *string `json:"parcelCode"`
	ParcelStatus    *string `json:"parcelStatus"`
	// Batch run + QR signature, so a resolved label reprints genuine
	// without a second fetch. Signed by the handler (secret owner).
	BatchID *string `json:"batchId"`
	Sig     string  `json:"sig"`
}

// GetOrgParcelLabel resolves a scanned or typed code against this
// company's OWN stock only — a code printed for another company (or the
// shared pool) resolves exactly like a code that doesn't exist, so this
// endpoint can never become an oracle for anyone else's labels. Returns
// nil, nil on a miss; the handler answers the uniform "not found".
func GetOrgParcelLabel(ctx context.Context, pool *pgxpool.Pool, orgID, code string) (*OrgParcelLabel, error) {
	var l OrgParcelLabel
	err := pool.QueryRow(ctx, `
		SELECT s.code,
		       CASE WHEN s."voidedAt" IS NOT NULL THEN 'voided'
		            WHEN s."usedAt" IS NOT NULL THEN 'spent'
		            WHEN s."infoAttachedAt" IS NOT NULL THEN 'filled'
		            ELSE 'blank' END,
	       s."itemDescription", s.destination, s."senderName", s."senderMsisdn",
	       s."receiverName", s."receiverMsisdn",
	       s."itemType", s."weightRangeKg",
	       s."lengthCm"::float8, s."widthCm"::float8, s."heightCm"::float8,
	       to_char(s."usedAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
	       to_char(s."voidedAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
	       s."voidedReason",
	       p.id::text, p.code, p.status::text,
	       s."batchId"::text
		FROM parcel_label_stock s
		LEFT JOIN parcel p ON p.id = s."usedByParcelId"
		WHERE upper(s.code) = upper($1) AND s."parcelOrgId" = $2`, code, orgID).
		Scan(&l.Code, &l.State, &l.ItemDescription, &l.Destination,
			&l.SenderName, &l.SenderMsisdn, &l.ReceiverName, &l.ReceiverMsisdn,
			&l.ItemType, &l.WeightRangeKg, &l.LengthCm, &l.WidthCm, &l.HeightCm,
			&l.UsedAt, &l.VoidedAt, &l.VoidedReason,
			&l.ParcelID, &l.ParcelCode, &l.ParcelStatus, &l.BatchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// OrgLabelSearchRow — one spendable sticker, as the custom-parcel
// label picker lists it. Only the code and when it was printed: the
// picker matches on the code's tail, nothing else matters.
type OrgLabelSearchRow struct {
	Code      string `json:"code"`
	CreatedAt string `json:"createdAt"`
}

// SearchOrgLabels — find the company's own unused labels by ANY
// consecutive run of characters in the code. A desk holds a physical
// sticker and types whatever fragment is readable ("YZN", "PKG-7Q",
// "4K9Z"); typing the whole PKG- code from a sticker held at arm's
// length is the slow path, and the fragment is what disambiguates.
// Substring (not suffix-only): a middle fragment must match too, so
// results appear live from the second keystroke. Blank stock only
// (never used, never filled in, never withdrawn): attaching a label
// spends it, so anything already spoken for is not offered.
func SearchOrgLabels(ctx context.Context, pool *pgxpool.Pool, orgID, tail string, limit int) ([]OrgLabelSearchRow, error) {
	tail = strings.ToUpper(strings.TrimSpace(tail))
	if tail == "" {
		return []OrgLabelSearchRow{}, nil
	}
	if limit <= 0 || limit > 20 {
		limit = 15
	}
	rows, err := pool.Query(ctx, `
		SELECT s.code, to_char(s."createdAt", 'YYYY-MM-DD"T"HH24:MI:SSZ')
		FROM parcel_label_stock s
		WHERE s."parcelOrgId" = $1
		  AND s."voidedAt" IS NULL AND s."usedAt" IS NULL AND s."infoAttachedAt" IS NULL
		  AND upper(s.code) LIKE '%' || $2 || '%'
		ORDER BY s."createdAt" DESC LIMIT $3`, orgID, tail, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OrgLabelSearchRow{}
	for rows.Next() {
		var r OrgLabelSearchRow
		if err := rows.Scan(&r.Code, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SearchOrgCounterParties — the company counter's address book: people
// THIS company has shipped to or from before, most-frequent first.
//
// Same query shape as the platform-wide SearchCounterParties (past
// parcels, not a hand-maintained table, so it starts full and cannot
// disagree with the record), scoped to the session's org. A desk must
// never complete a regular's name from another company's customers —
// that list is someone else's business, and showing it would leak
// names paired with phone numbers across tenants.
func SearchOrgCounterParties(
	ctx context.Context, pool *pgxpool.Pool, orgID, q string, limit int,
) ([]CounterParty, error) {
	if len([]rune(q)) < 3 {
		// Two letters matches half the country. Making the caller commit
		// to three keeps this a lookup rather than a table scan dressed
		// as one — same floor as the platform-wide search.
		return nil, nil
	}
	if limit <= 0 || limit > 25 {
		limit = 8
	}
	rows, err := pool.Query(ctx, `
		WITH parties AS (
			SELECT "senderName" AS name, "senderMsisdn" AS msisdn,
			       "originLabel" AS label, "createdAt"
			FROM parcel WHERE "senderMsisdn" <> '' AND "parcelOrgId" = $2::uuid
			UNION ALL
			SELECT "receiverName", "receiverMsisdn", "destinationLabel", "createdAt"
			FROM parcel WHERE "receiverMsisdn" <> '' AND "parcelOrgId" = $2::uuid
		)
		SELECT name, msisdn, label, "createdAt", shipments FROM (
			SELECT DISTINCT ON (msisdn)
			       name, msisdn, label, "createdAt",
			       count(*) OVER (PARTITION BY msisdn) AS shipments
			FROM parties
			WHERE name ILIKE '%'||$1||'%' OR msisdn ILIKE '%'||$1||'%'
			-- Newest row per number wins, so a name correction or a
			-- change of shop supersedes what was recorded a year ago.
			ORDER BY msisdn, "createdAt" DESC
		) latest
		ORDER BY shipments DESC, "createdAt" DESC
		LIMIT $3`, q, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CounterParty
	for rows.Next() {
		var p CounterParty
		if err := rows.Scan(&p.Name, &p.Msisdn, &p.LastLabel, &p.LastSeen, &p.Shipments); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// AttachOrgParcelLabelInfo — the company's own version of
// AttachParcelLabelInfo: write field notes (what the box is, where it's
// going, who it's for) onto a pre-printed label, well before booking.
// Same overwrite semantics and the same spent/voided refusals as the
// admin path, plus one more: the code must belong to THIS company's
// stock, or a desk could annotate — and so appear to own — a pad that
// was printed for a competitor.
func AttachOrgParcelLabelInfo(ctx context.Context, pool *pgxpool.Pool, orgID, code string, in ParcelLabelInfoInput, staffID *string) error {
	if in.ItemDescription == "" {
		return &ParcelError{"BAD_INPUT", "A short item description is required"}
	}
	// Strict PKG-only: a company self-print is retired — re-print on the
	// Esoqo pad instead. Flat message (no oracle on anyone else's stock).
	if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(code)), "PKG-") {
		return &ParcelError{"FOREIGN_LABEL", "That looks like a label printed outside Esoqo. Only Esoqo PKG-… labels scan now — re-print on your Esoqo pad"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_label_stock
		SET "itemDescription" = $1, "destination" = $2, "senderName" = $3, "senderMsisdn" = $4,
		    "receiverName" = $5, "receiverMsisdn" = $6, "itemType" = $7, "weightRangeKg" = $8,
		    "lengthCm" = $12, "widthCm" = $13, "heightCm" = $14,
		    "infoAttachedAt" = now(), "infoAttachedByStaffId" = $9
		WHERE upper(code) = upper($10) AND "parcelOrgId" = $11 AND "usedAt" IS NULL AND "voidedAt" IS NULL`,
		in.ItemDescription, in.Destination, in.SenderName, in.SenderMsisdn,
		in.ReceiverName, in.ReceiverMsisdn, in.ItemType, in.WeightRangeKg, staffID, code, orgID,
		in.LengthCm, in.WidthCm, in.HeightCm)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists, used, voided bool
		_ = pool.QueryRow(ctx, `SELECT true, "usedAt" IS NOT NULL, "voidedAt" IS NOT NULL FROM parcel_label_stock WHERE upper(code) = upper($1) AND "parcelOrgId" = $2`, code, orgID).Scan(&exists, &used, &voided)
		if used {
			return &ParcelError{"BAD_INPUT", "That label is already bound to a booked parcel — info can't be attached to it anymore"}
		}
		if voided {
			return &ParcelError{"BAD_INPUT", "That label was withdrawn — info can't be attached to it anymore"}
		}
		return &ParcelError{"NOT_FOUND", "That label code isn't one of your company's labels"}
	}
	return nil
}

// ParcelOrgStaffParty resolves the Party and phone behind one staff
// row, scoped by org so an admin session can't read another company's
// roster by guessing an id. Empty strings when the row has no linked
// person (an office-only PIN login) — the caller then has nothing to
// mint an Esoqo ID against.
func ParcelOrgStaffParty(ctx context.Context, pool *pgxpool.Pool, orgID, staffID string) (partyID, msisdn string, err error) {
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(st."partyId"::text, ''), COALESCE(pr.msisdn, '')
		FROM parcel_org_staff st
		LEFT JOIN person pr ON pr."partyId" = st."partyId"
		WHERE st.id = $1 AND st."orgId" = $2`, staffID, orgID).Scan(&partyID, &msisdn)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", &ParcelError{"NOT_FOUND", "That team member was not found"}
	}
	return partyID, msisdn, err
}

type ParcelOrgStation struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Msisdn       string  `json:"msisdn"`
	LocationHint string  `json:"locationHint"`
	OpeningHours *string `json:"openingHours"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	Capacity     int     `json:"capacity"`
	Active       bool    `json:"active"`
	// ManagerStaffID — the parcel_org_staff member who runs this station
	// (see the schema's own comment). Null until a manager names one.
	ManagerStaffID *string `json:"managerStaffId"`
	// MemberCount — how many team members are currently posted here, so
	// the register can show "3 people" without a per-row detail fetch.
	MemberCount int `json:"memberCount"`
}

func ListParcelOrgStations(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]ParcelOrgStation, error) {
	rows, err := pool.Query(ctx, `
		SELECT s.id, s.name, s.msisdn, s."locationHint", s."openingHours", s.lat::text, s.lng::text,
		       s.capacity, s.active, s."managerStaffId"::text,
		       (SELECT count(*) FROM parcel_org_staff st WHERE st."stationId" = s.id AND st."orgId" = s."parcelOrgId")
		FROM parcel_agent s WHERE s."parcelOrgId" = $1 ORDER BY s.name`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelOrgStation
	for rows.Next() {
		var s ParcelOrgStation
		var lat, lng string
		if err := rows.Scan(&s.ID, &s.Name, &s.Msisdn, &s.LocationHint, &s.OpeningHours, &lat, &lng, &s.Capacity, &s.Active, &s.ManagerStaffID, &s.MemberCount); err != nil {
			return nil, err
		}
		if s.Lat, err = parseFloatOrZero(lat); err != nil {
			return nil, err
		}
		if s.Lng, err = parseFloatOrZero(lng); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetParcelOrgStation — one station, scoped by org so a detail fetch
// can't read a competitor's location by guessing an id.
func GetParcelOrgStation(ctx context.Context, pool *pgxpool.Pool, orgID, stationID string) (*ParcelOrgStation, error) {
	var s ParcelOrgStation
	var lat, lng string
	err := pool.QueryRow(ctx, `
		SELECT s.id, s.name, s.msisdn, s."locationHint", s."openingHours", s.lat::text, s.lng::text,
		       s.capacity, s.active, s."managerStaffId"::text,
		       (SELECT count(*) FROM parcel_org_staff st WHERE st."stationId" = s.id AND st."orgId" = s."parcelOrgId")
		FROM parcel_agent s WHERE s.id = $1 AND s."parcelOrgId" = $2`, stationID, orgID).
		Scan(&s.ID, &s.Name, &s.Msisdn, &s.LocationHint, &s.OpeningHours, &lat, &lng, &s.Capacity, &s.Active, &s.ManagerStaffID, &s.MemberCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if s.Lat, err = parseFloatOrZero(lat); err != nil {
		return nil, err
	}
	if s.Lng, err = parseFloatOrZero(lng); err != nil {
		return nil, err
	}
	return &s, nil
}

// ListParcelOrgStationMembers — the team members currently posted to a
// station, resolved from parcel_org_staff.stationId. The manager is a
// member like any other; ManagerStaffID only marks which one.
func ListParcelOrgStationMembers(ctx context.Context, pool *pgxpool.Pool, orgID, stationID string) ([]ParcelOrgStaff, error) {
	rows, err := pool.Query(ctx, `
		SELECT st.id, st."orgId", st.name, st.role, st.active, st."isContact", st."partyId"::text, st."stationId"::text,
		       pr.msisdn, epi.code, st.capabilities
		FROM parcel_org_staff st
		LEFT JOIN person pr ON pr."partyId" = st."partyId"
		LEFT JOIN esoko_payment_id epi ON epi."partyId" = st."partyId"
		WHERE st."orgId" = $1 AND st."stationId" = $2
		ORDER BY st.name`, orgID, stationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelOrgStaff
	for rows.Next() {
		var s ParcelOrgStaff
		if err := rows.Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.IsContact, &s.PartyID, &s.StationID, &s.Msisdn, &s.EsoqoID, &s.Capabilities); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// SetParcelOrgStationManager names (or clears) the staff member who runs
// a station. The staff row must be on this company's roster; a null or
// empty staffID clears the manager.
func SetParcelOrgStationManager(ctx context.Context, pool *pgxpool.Pool, orgID, stationID string, staffID *string) error {
	manager := ""
	if staffID != nil {
		manager = *staffID
	}
	if manager != "" {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM parcel_org_staff WHERE id = $1 AND "orgId" = $2)`, manager, orgID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return &ParcelError{"NOT_FOUND", "That team member is not on your roster"}
		}
	}
	// NULLIF so an empty id clears the manager instead of storing "" in
	// a uuid column.
	tag, err := pool.Exec(ctx, `UPDATE parcel_agent SET "managerStaffId" = NULLIF($1, '')::uuid WHERE id = $2 AND "parcelOrgId" = $3`, manager, stationID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That station was not found in your company"}
	}
	return nil
}

func CreateParcelOrgStation(ctx context.Context, pool *pgxpool.Pool, orgID string, in ParcelAgentInput, staffID *string) (string, error) {
	if err := in.validate(); err != nil {
		return "", err
	}
	var id string
	err := pool.QueryRow(ctx, `INSERT INTO parcel_agent (id, name, "parcelOrgId", "partyId", "zoneId", lat, lng, msisdn, "locationHint", "openingHours", active, capacity, "holdingFeeKes", "createdAt", "createdByStaffId") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13) RETURNING id`, in.Name, orgID, in.PartyID, in.ZoneID, in.Lat, in.Lng, in.Msisdn, in.LocationHint, in.OpeningHours, in.Active, in.Capacity, in.HoldingFee, staffID).Scan(&id)
	return id, err
}

func UpdateParcelOrgStation(ctx context.Context, pool *pgxpool.Pool, orgID, stationID string, in ParcelAgentInput) error {
	if err := in.validate(); err != nil {
		return err
	}
	tag, err := pool.Exec(ctx, `UPDATE parcel_agent SET name = $1, msisdn = $2, "locationHint" = $3, "openingHours" = $4, lat = $5, lng = $6, capacity = $7, active = $8 WHERE id = $9 AND "parcelOrgId" = $10`, in.Name, in.Msisdn, in.LocationHint, in.OpeningHours, in.Lat, in.Lng, in.Capacity, in.Active, stationID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That station was not found in your company"}
	}
	return nil
}

func AssignParcelOrgStaffStation(ctx context.Context, pool *pgxpool.Pool, orgID, staffID string, stationID *string) error {
	if stationID != nil && *stationID != "" {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM parcel_agent WHERE id = $1 AND "parcelOrgId" = $2)`, *stationID, orgID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return &ParcelError{"NOT_FOUND", "That station is not part of your company"}
		}
	}
	tag, err := pool.Exec(ctx, `UPDATE parcel_org_staff SET "stationId" = $1 WHERE id = $2 AND "orgId" = $3`, stationID, staffID, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That staff member was not found"}
	}
	return nil
}

// UpsertParcelOrgStaff creates or updates one PIN login. pinHash empty
// on an update means "leave the PIN alone" — re-typing a PIN to change
// somebody's role is the kind of friction that ends with every rider
// sharing one login.
//
// capabilities is a custom role's explicit permission set (already
// sanitized by the handler against authsvc.AllParcelOrgCapabilities).
// setCapabilities is false to leave the stored permissions alone — so
// toggling a suspension or renaming someone doesn't silently wipe a
// custom role's permissions — and true to replace them, with an empty
// slice clearing them (a custom role switched back to a preset).
func UpsertParcelOrgStaff(ctx context.Context, pool *pgxpool.Pool, id *string, orgID, name, role, pinHash string, partyID *string, active bool, isContact *bool, capabilities []string, setCapabilities bool, stationID *string) error {
	if strings.TrimSpace(name) == "" {
		return &ParcelError{"BAD_INPUT", "Give this person a name"}
	}
	// Role is a free label, not an enum: a company can call the job what it
	// likes (Supervisor, Loader, Depot Lead). A preset role name resolves to
	// a capability bundle at sign-in; a custom role carries its own explicit
	// capabilities, and one that carries none of either floors at RIDER —
	// the narrowest set. See authsvc.ParcelStaffCapabilitiesForRole.
	role = strings.TrimSpace(role)
	if role == "" {
		return &ParcelError{"BAD_INPUT", "Give this person a role"}
	}
	if len([]rune(role)) > 40 {
		return &ParcelError{"BAD_INPUT", "That role name is too long"}
	}
	if id == nil || *id == "" {
		// A PIN and a partyID are the two ways this row ever gets a
		// credential: a PIN for the dedicated company portal, a partyID
		// (joined out to person.msisdn — see ParcelStaffMsisdn) for the
		// OTP-invited path this function's caller resolves before ever
		// getting here. Neither present means signing this person in
		// would never be possible, on either path.
		if pinHash == "" && (partyID == nil || *partyID == "") {
			return &ParcelError{"BAD_INPUT", "Set a PIN, or invite this person by phone number"}
		}
		_, err := pool.Exec(ctx, `
			INSERT INTO parcel_org_staff (id, "orgId", name, "pinHash", role, active, "isContact", "partyId", "stationId", capabilities, "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, COALESCE($6::boolean, false), $7, $8, COALESCE($9::text[], '{}'), now(), now())`,
			orgID, name, pinHash, role, active, isContact, partyID, stationID, capabilities)
		return err
	}
	// Scoped by orgID as well as id: an org session must not be able to
	// edit another company's staff row by guessing a uuid. isContact is
	// COALESCEd, and capabilities only overwritten when setCapabilities
	// is true, so an edit that doesn't mention either (a suspend, a role
	// change) leaves them alone.
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_org_staff SET
			name = $1, role = $2, active = $3, "partyId" = $4, "stationId" = $5,
				"pinHash" = CASE WHEN $6 = '' THEN "pinHash" ELSE $6 END,
				"isContact" = COALESCE($7::boolean, "isContact"),
				capabilities = CASE WHEN $9::boolean THEN COALESCE($8::text[], '{}') ELSE capabilities END,
				"updatedAt" = now()
		WHERE id = $10 AND "orgId" = $11`,
		name, role, active, partyID, stationID, pinHash, isContact, capabilities, setCapabilities, *id, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That person was not found"}
	}
	return nil
}

// ParcelOrgStaffCredential is the minimum a staffer needs to change
// their own portal PIN: the stored hash to verify the current PIN
// against, and the linked party (if any) whose Esoqo credential must
// move with it so /signin keeps working on the same PIN.
type ParcelOrgStaffCredential struct {
	PinHash string
	PartyID *string
}

// GetParcelOrgStaffCredential reads a staffer's own login back for a
// PIN change — scoped by org like every other org read, and
// active-only: a suspended row's PIN is not something its holder gets
// to rotate back into use. Nil, nil when there is nothing to change.
func GetParcelOrgStaffCredential(ctx context.Context, pool *pgxpool.Pool, orgID, staffID string) (*ParcelOrgStaffCredential, error) {
	var c ParcelOrgStaffCredential
	err := pool.QueryRow(ctx, `
		SELECT "pinHash", "partyId"::text FROM parcel_org_staff
		WHERE id = $1 AND "orgId" = $2 AND active`, staffID, orgID).
		Scan(&c.PinHash, &c.PartyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ChangeParcelOrgStaffPin sets a staffer's own portal PIN — the "temp
// PIN in, chosen PIN out" half of the invite flow. One transaction
// covers the staff row and, when the row links a Person, that Person's
// Esoqo credential too: the invite established one PIN for both doors
// (company portal name+PIN, /signin phone+PIN), and a change must keep
// that invariant rather than silently splitting them.
func ChangeParcelOrgStaffPin(ctx context.Context, pool *pgxpool.Pool, orgID, staffID, newHash string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var partyID *string
	if err := tx.QueryRow(ctx, `
		UPDATE parcel_org_staff SET "pinHash" = $1, "updatedAt" = now()
		WHERE id = $2 AND "orgId" = $3 AND active
		RETURNING "partyId"::text`, newHash, staffID, orgID).Scan(&partyID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &ParcelError{"NOT_FOUND", "Your login is no longer active — sign in again"}
		}
		return err
	}
	if partyID != nil && *partyID != "" {
		// Same shape as dbx.UpsertPin, inside this transaction rather
		// than through it — a PIN change that updated one door and not
		// the other would be worse than one that failed cleanly.
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_credential ("personId", "pinHash", "pinSetAt", "failedAttempts", "lockedUntil", "updatedAt")
			VALUES ($1, $2, now(), 0, NULL, now())
			ON CONFLICT ("personId") DO UPDATE
			SET "pinHash" = EXCLUDED."pinHash", "pinSetAt" = now(), "failedAttempts" = 0, "lockedUntil" = NULL, "updatedAt" = now()`,
			*partyID, newHash); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ── Org-scoped reads ─────────────────────────────────────────────────

// ParcelOrgStats is the operator dashboard's "what needs me today".
// Deliberately the company's own numbers only — a courier firm has no
// business seeing platform-wide totals, and EarningsKes is what they
// invoice against, not what the customer paid.
type ParcelOrgStats struct {
	AwaitingPickup   int          `json:"awaitingPickup"`
	InTransit        int          `json:"inTransit"`
	FailedDeliveries int          `json:"failedDeliveries"`
	AtAgent          int          `json:"atAgent"`
	DeliveredToday   int          `json:"deliveredToday"`
	EarningsTodayKes money.Amount `json:"earningsTodayKes"`
	EarningsKes      money.Amount `json:"earningsKes"`
	// AwaitingDropoff — booked, self-drop-off parcels nobody at this
	// company has scanned into custody yet. A subset of AwaitingPickup
	// (both count BOOKED), broken out separately because the front desk
	// needs to know a sender is walking in, not waiting for a rider —
	// the exact fact a plain status count can't tell it.
	AwaitingDropoff int `json:"awaitingDropoff"`
	// Overdue — active parcels past their SLA deadline. Powers the
	// register's "Overdue only" toggle and the attention band.
	Overdue int `json:"overdue"`
}

func GetParcelOrgStats(ctx context.Context, pool *pgxpool.Pool, orgID string) (*ParcelOrgStats, error) {
	var s ParcelOrgStats
	err := pool.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE status IN ('BOOKED', 'RECEIVED_AT_COUNTER')),
			count(*) FILTER (WHERE status IN ('PICKED_UP', 'IN_TRANSIT')),
			count(*) FILTER (WHERE status = 'FAILED_DELIVERY'),
			count(*) FILTER (WHERE status = 'HELD_AT_AGENT'),
			count(*) FILTER (WHERE status = 'DELIVERED' AND "deliveredAt" >= date_trunc('day', now())),
			COALESCE(SUM("orgEarningsKes") FILTER (WHERE "paidAt" >= date_trunc('day', now())), 0)::float8,
			COALESCE(SUM("orgEarningsKes"), 0)::float8,
			count(*) FILTER (WHERE status = 'BOOKED' AND "originMethod" = 'SELF_DROPOFF'),
			count(*) FILTER (WHERE "slaDeadlineAt" IS NOT NULL AND "slaDeadlineAt" < now()
				AND status IN ('RECEIVED_AT_COUNTER', 'PICKED_UP', 'IN_TRANSIT'))
		FROM parcel
		WHERE "parcelOrgId" = $1 AND status != 'CANCELLED'`, orgID).
		Scan(&s.AwaitingPickup, &s.InTransit, &s.FailedDeliveries, &s.AtAgent,
			&s.DeliveredToday, &s.EarningsTodayKes, &s.EarningsKes, &s.AwaitingDropoff,
			&s.Overdue)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// OrgParcelRow — one line on the operator portal's parcel list.
//
// Carries the receiver's name and phone (a rider has to call the door)
// but never the sender's phone or the price the customer paid: the
// company is paid its own EarningsKes, and what Esoqo charged on top is
// not theirs to see. OrgEarningsKes is nil until payment confirms.
type OrgParcelRow struct {
	ID                string  `json:"id"`
	Code              string  `json:"code"`
	Status            string  `json:"status"`
	ReceiverName      string  `json:"receiverName"`
	ReceiverMsisdn    string  `json:"receiverMsisdn"`
	OriginLabel       string  `json:"originLabel"`
	DestinationLabel  string  `json:"destinationLabel"`
	ParcelType        string  `json:"parcelType"`
	OrgEarningsKes    *string `json:"orgEarningsKes"`
	CreatedAt         string  `json:"createdAt"`
	SlaDeadlineAt     *string `json:"slaDeadlineAt"`
	DeliveryAttempts  int     `json:"deliveryAttempts"`
	LastAttemptReason *string `json:"lastAttemptReason"`
	HolderName        *string `json:"holderName"`
	AgentName         *string `json:"agentName"`
	// ExternalRef / ExternalSource — the company's own number from the
	// system it imported this parcel from, when it brought one. Shown in
	// the console beside Esoqo's code so staff can search by whichever
	// they have in hand.
	ExternalRef    *string `json:"externalRef"`
	ExternalSource *string `json:"externalSource"`
	// OriginMethod — see Parcel.originMethod's own comment. Lets the
	// front desk's "Awaiting drop-off" tab tell "a sender is bringing
	// this in themselves" apart from "still waiting on our own rider",
	// which today's plain status filter alone can't distinguish.
	OriginMethod string `json:"originMethod"`

	// Receiver self-authentication, for the console's escalation queue
	// (see dbx/parcel_receiver_auth.go). Carried on the list row rather
	// than fetched per parcel because the whole point is a filter — "show
	// me the ones that are stuck" — and a queue that needs one request
	// per row to know whether a row belongs in it is not a queue.
	//
	// No delivery code here, current or otherwise. The console shows
	// that something is locked and offers the two verbs; the code itself
	// reaches only the two people entitled to it, by SMS.
	ReceiverAuthAttempts     int     `json:"receiverAuthAttempts"`
	ReceiverAuthLockedAt     *string `json:"receiverAuthLockedAt"`
	ReceiverAuthHardLockedAt *string `json:"receiverAuthHardLockedAt"`
	DeliveryCodeVersion      int     `json:"deliveryCodeVersion"`
	// CourierEarningsHeldUntil — set on a self-confirmed collection, the
	// other verb this queue offers. See DeliverParcel's tail.
	CourierEarningsHeldUntil *string `json:"courierEarningsHeldUntil"`
}

// ListOrgParcelsFilter — every knob the operator register can turn.
// All fields optional; zero values mean "no constraint". Kept as a
// struct (not positional *string args) so new filters don't reshuffle
// every caller.
type ListOrgParcelsFilter struct {
	Status       *string
	OriginMethod *string
	Q            *string
	// ParcelType — SMALL / MEDIUM / LARGE / DOCUMENT…, exact match.
	ParcelType *string
	// OverdueOnly — only rows past their SLA deadline and still active.
	OverdueOnly bool
	// LockedOnly — only rows where a receiver has locked themselves out
	// of the delivery code, soft or hard. The console's escalation
	// queue: these are the parcels that stop moving until somebody at a
	// desk grants a retry or issues a new code.
	LockedOnly bool
	// Sort — created | code | status | earnings. Anything else falls
	// back to created. Order — asc | desc (default desc for created,
	// asc otherwise is still honoured explicitly).
	Sort  string
	Order string
	// Limit / Offset — page window. Clamped by the caller-facing
	// helper, never by SQL alone.
	Limit  int
	Offset int
}

// ListOrgParcelsResult — one page plus the total behind the filter,
// so the portal can render "page 2 of 14" without a second query.
type ListOrgParcelsResult struct {
	Parcels []OrgParcelRow `json:"parcels"`
	Total   int            `json:"total"`
}

// DailyBucket — one day of the trailing-7-day operations trend.
type DailyBucket struct {
	Day       string `json:"day"`
	Delivered int    `json:"delivered"`
	Booked    int    `json:"booked"`
}

// GetParcelOrgTrends — trailing 7 days (incl. today) of bookings vs
// deliveries, in Africa/Nairobi days. One query, seven rows, so the
// dashboard's analytics strip never fans out per day.
func GetParcelOrgTrends(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]DailyBucket, error) {
	rows, err := pool.Query(ctx, `
		SELECT to_char(d, 'Dy DD Mon'),
		       COALESCE(b.booked, 0)::int,
		       COALESCE(dlv.delivered, 0)::int
		FROM (
			SELECT (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') - (s || ' days')::interval) AS d
			FROM generate_series(6, 0, -1) AS s
		) days
		LEFT JOIN (
			SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Africa/Nairobi') AS d, count(*) AS booked
			FROM parcel WHERE "parcelOrgId" = $1
			  AND "createdAt" >= date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') - interval '6 days'
			GROUP BY 1
		) b ON b.d = (days.d AT TIME ZONE 'Africa/Nairobi')
		LEFT JOIN (
			SELECT date_trunc('day', "deliveredAt" AT TIME ZONE 'Africa/Nairobi') AS d, count(*) AS delivered
			FROM parcel WHERE "parcelOrgId" = $1 AND status = 'DELIVERED'
			  AND "deliveredAt" >= date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') - interval '6 days'
			GROUP BY 1
		) dlv ON dlv.d = (days.d AT TIME ZONE 'Africa/Nairobi')
		ORDER BY days.d`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DailyBucket, 0, 7)
	for rows.Next() {
		var b DailyBucket
		if err := rows.Scan(&b.Day, &b.Booked, &b.Delivered); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ListOrgParcels — this company's parcels, newest first.
//
// orgID is never taken from the request; it comes from the session (see
// handlers_parcel_orgs.go). status/originMethod are optional filters,
// combined with AND — "awaiting drop-off" is exactly status=BOOKED AND
// originMethod=SELF_DROPOFF, so the front desk asks for both rather
// than the handler special-casing a pseudo-status.
//
// status accepts a comma-separated list, which is how the operator
// dashboard's KPI tiles became real filters: two of them count more
// than one status ("on the road" is PICKED_UP + IN_TRANSIT, "ready to
// collect" is BOOKED + RECEIVED_AT_COUNTER, both per
// GetParcelOrgStats above), so a single-value filter could never show
// the rows behind the number it was sitting under. A value with no
// comma still matches exactly one status, so every existing caller —
// and the dashboard's own status dropdown — is unaffected. q is
// an optional free-text search over Esoqo's code AND the company's own
// externalRef, so a company migrating from another system can find a
// parcel by whichever number is in hand.
func ListOrgParcels(ctx context.Context, pool *pgxpool.Pool, orgID string, status, originMethod, q *string) ([]OrgParcelRow, error) {
	res, err := ListOrgParcelsPage(ctx, pool, orgID, ListOrgParcelsFilter{
		Status: status, OriginMethod: originMethod, Q: q, Limit: 200,
	})
	if err != nil {
		return nil, err
	}
	return res.Parcels, nil
}

// ListOrgParcelsPage — paginated, sortable ListOrgParcels.
//
// Same WHERE semantics, plus parcelType / overdueOnly, ORDER BY on a
// whitelisted column, and LIMIT/OFFSET with a COUNT(*) OVER() total so
// the portal paginates against the filter, not the page. Limit is
// clamped to 1..100 (default 25); offset floors at 0.
func ListOrgParcelsPage(ctx context.Context, pool *pgxpool.Pool, orgID string, f ListOrgParcelsFilter) (ListOrgParcelsResult, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		limit = 100
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}
	order := "DESC"
	if f.Order == "asc" {
		order = "ASC"
	} else if f.Order == "desc" {
		order = "DESC"
	} else if f.Sort == "code" || f.Sort == "status" {
		order = "ASC"
	}
	orderBy := `p."createdAt"`
	switch f.Sort {
	case "code":
		orderBy = "p.code"
	case "status":
		orderBy = "p.status::text, p.\"createdAt\""
	case "earnings":
		orderBy = `p."orgEarningsKes"`
	}
	rows, err := pool.Query(ctx, `
		SELECT p.id, p.code, p.status::text, p."receiverName", p."receiverMsisdn",
		       p."originLabel", p."destinationLabel", p."parcelType"::text,
		       p."orgEarningsKes"::text,
		       to_char(p."createdAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       to_char(p."slaDeadlineAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       p."deliveryAttempts", p."lastAttemptReason",
		       COALESCE(pr."knownAs", pr."officialName"), a.name, p."originMethod"::text,
		       p."externalRef", p."externalSource",
		       p."receiverAuthAttempts",
		       to_char(p."receiverAuthLockedAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       to_char(p."receiverAuthHardLockedAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       p."deliveryCodeVersion",
		       to_char(p."courierEarningsHeldUntil", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       count(*) OVER() AS total
		FROM parcel p
		LEFT JOIN person pr ON pr."partyId" = p."currentHolderPartyId"
		LEFT JOIN parcel_agent a ON a.id = p."destinationAgentId"
		WHERE p."parcelOrgId" = $1
		  AND ($2::text IS NULL OR p.status::text = ANY(string_to_array($2, ',')))
		  AND ($3::text IS NULL OR p."originMethod"::text = $3)
		  AND ($4::text IS NULL OR p.code ILIKE '%' || $4 || '%' OR p."externalRef" ILIKE '%' || $4 || '%'
		       OR p."receiverName" ILIKE '%' || $4 || '%' OR p."receiverMsisdn" ILIKE '%' || $4 || '%')
		  AND ($5::text IS NULL OR p."parcelType"::text = $5)
		  AND (NOT $6::bool OR (p."slaDeadlineAt" IS NOT NULL AND p."slaDeadlineAt" < now()
		       AND p.status IN ('RECEIVED_AT_COUNTER', 'PICKED_UP', 'IN_TRANSIT')))
		  AND (NOT $7::bool OR p."receiverAuthLockedAt" IS NOT NULL
		       OR p."receiverAuthHardLockedAt" IS NOT NULL)
		ORDER BY `+orderBy+` `+order+`
		LIMIT $8 OFFSET $9`, orgID, f.Status, f.OriginMethod, f.Q, f.ParcelType, f.OverdueOnly,
		f.LockedOnly, limit, offset)
	if err != nil {
		return ListOrgParcelsResult{}, err
	}
	defer rows.Close()
	out := make([]OrgParcelRow, 0, limit)
	total := 0
	for rows.Next() {
		var r OrgParcelRow
		if err := rows.Scan(&r.ID, &r.Code, &r.Status, &r.ReceiverName, &r.ReceiverMsisdn,
			&r.OriginLabel, &r.DestinationLabel, &r.ParcelType, &r.OrgEarningsKes,
			&r.CreatedAt, &r.SlaDeadlineAt, &r.DeliveryAttempts, &r.LastAttemptReason,
			&r.HolderName, &r.AgentName, &r.OriginMethod, &r.ExternalRef, &r.ExternalSource,
			&r.ReceiverAuthAttempts, &r.ReceiverAuthLockedAt, &r.ReceiverAuthHardLockedAt,
			&r.DeliveryCodeVersion, &r.CourierEarningsHeldUntil,
			&total); err != nil {
			return ListOrgParcelsResult{}, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return ListOrgParcelsResult{}, err
	}
	return ListOrgParcelsResult{Parcels: out, Total: total}, nil
}

// ImportParcelInput — a parcel a courier company already tracks in
// another system, registered into Esoqo so it can be managed and tracked
// here too. No pricing/payment: the company priced and collected it
// already; Esoqo is the operations and tracking layer for it.
type ImportParcelInput struct {
	ExternalRef      string
	ExternalSource   *string
	SenderName       string
	SenderMsisdn     string
	ReceiverName     string
	ReceiverMsisdn   string
	OriginLabel      string
	DestinationLabel string
	ParcelType       string
	WeightKg         *float64
	Fragile          bool
	Notes            *string
	// LabelCode — one of the company's own pre-printed labels to stick
	// on this parcel. The label's code BECOMES the parcel's tracking
	// code (same as BookParcel's ExistingCode path): the physical
	// sticker and the system record are one identity from this moment.
	// Nil means Esoqo mints a fresh code instead.
	LabelCode *string
}

// ImportOrgParcel registers an externally-created parcel under [orgID].
// It lands in RECEIVED_AT_COUNTER — the box is in the company's hands
// already, which is the truth for anything they're migrating in — and
// from there flows through the exact same handoff/delivery/tracking
// machinery as a parcel booked on Esoqo. Without a label Esoqo mints
// its own `code` (the tracking credential); the caller's number is
// kept in externalRef and searched, never used as the public code.
// With one, the pre-printed label's code is the tracking code.
func ImportOrgParcel(ctx context.Context, pool *pgxpool.Pool, orgID string, in ImportParcelInput) (id, code string, err error) {
	if strings.TrimSpace(in.SenderName) == "" || strings.TrimSpace(in.SenderMsisdn) == "" {
		return "", "", &ParcelError{"BAD_INPUT", "Sender name and phone are required"}
	}
	if strings.TrimSpace(in.ReceiverName) == "" || strings.TrimSpace(in.ReceiverMsisdn) == "" {
		return "", "", &ParcelError{"BAD_INPUT", "Receiver name and phone are required"}
	}
	if strings.TrimSpace(in.OriginLabel) == "" || strings.TrimSpace(in.DestinationLabel) == "" {
		return "", "", &ParcelError{"BAD_INPUT", "Origin and destination are required"}
	}
	if !isValidParcelType(in.ParcelType) {
		return "", "", &ParcelError{"BAD_INPUT", "Choose a valid parcel type"}
	}

	deliveryCode, err := generateDeliveryCode()
	if err != nil {
		return "", "", err
	}
	serviceTicketNumber := fleetqr.ShortCodeChecked(fleetqr.PrefixServiceTicket, 6)
	ref := strings.TrimSpace(in.ExternalRef)
	var externalRef *string
	if ref != "" {
		externalRef = &ref
	}

	if in.LabelCode != nil && strings.TrimSpace(*in.LabelCode) != "" {
		return importOrgParcelWithLabel(ctx, pool, orgID, in, externalRef, deliveryCode, serviceTicketNumber)
	}

	// A PKG- code is 6 chars from a 32-symbol alphabet — collisions are
	// vanishingly rare but not impossible, and a unique-violation here is
	// the normal "mint again" case, not a real failure.
	for attempt := 0; attempt < 5; attempt++ {
		code = fleetqr.ShortCodeChecked(fleetqr.PrefixParcel, 6)
		err = pool.QueryRow(ctx, `
			INSERT INTO parcel (
				id, code, "deliveryCode", "serviceTicketNumber",
				"senderName", "senderMsisdn", "receiverName", "receiverMsisdn",
				"originLabel", "destinationLabel", notes,
				"parcelType", "weightKg", fragile,
				"parcelOrgId", "externalRef", "externalSource",
				"originMethod", status, "createdAt"
			) VALUES (
				gen_random_uuid(), $1, $2, $3,
				$4, $5, $6, $7,
				$8, $9, $10,
				$11::"ParcelType", $12, $13,
				$14, $15, $16,
				'SCHEDULED_PICKUP'::"ParcelOriginMethod", 'RECEIVED_AT_COUNTER', now()
			) RETURNING id`,
			code, deliveryCode, serviceTicketNumber,
			strings.TrimSpace(in.SenderName), strings.TrimSpace(in.SenderMsisdn),
			strings.TrimSpace(in.ReceiverName), strings.TrimSpace(in.ReceiverMsisdn),
			strings.TrimSpace(in.OriginLabel), strings.TrimSpace(in.DestinationLabel), in.Notes,
			in.ParcelType, in.WeightKg, in.Fragile,
			orgID, externalRef, in.ExternalSource).Scan(&id)
		if err == nil {
			return id, code, nil
		}
		if !isUniqueViolation(err) {
			return "", "", err
		}
	}
	return "", "", &ParcelError{"CONFLICT", "Could not allocate a tracking code — try again"}
}

// importOrgParcelWithLabel — the sticker-first variant: claim one of
// the company's own pre-printed labels and register the parcel under
// its code. Claiming the stock row and inserting the parcel happen in
// one transaction so two desks sticking the same physical label at
// once can't both win it — the same shape BookParcel's ExistingCode
// path already uses, including the org-induction check (a pad printed
// for one company is spendable only by it; unowned shared-pool stock
// stays bindable by anyone).
func importOrgParcelWithLabel(ctx context.Context, pool *pgxpool.Pool, orgID string, in ImportParcelInput, externalRef *string, deliveryCode, serviceTicketNumber string) (id, code string, err error) {
	code = strings.ToUpper(strings.TrimSpace(*in.LabelCode))
	tx, terr := pool.Begin(ctx)
	if terr != nil {
		return "", "", terr
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var stockID string
	var stockOrgID *string
	var voidedAt *time.Time
	var voidedReason *string
	lockErr := tx.QueryRow(ctx, `
		SELECT id, "parcelOrgId"::text, "voidedAt", "voidedReason"
		FROM parcel_label_stock WHERE upper(code) = $1 AND "usedAt" IS NULL FOR UPDATE`,
		code).Scan(&stockID, &stockOrgID, &voidedAt, &voidedReason)
	if errors.Is(lockErr, pgx.ErrNoRows) {
		// Same LABEL_ALREADY_SPENT contract as BookParcel's ExistingCode
		// path — see the long comment there. This is the path a courier
		// company's own counter books through, so it is the one the
		// offline queue replays against most; it previously returned
		// BAD_INPUT and matched the client's regex only because "unused
		// pre-printed label" happens to be a substring of "unused
		// pre-printed labels". That is not a contract, it is a
		// coincidence one pluralisation away from stranding parcels.
		return "", "", &ParcelError{"LABEL_ALREADY_SPENT", "That label isn't one of your unused pre-printed labels"}
	}
	if lockErr != nil {
		return "", "", lockErr
	}
	if voidedAt != nil {
		msg := "That label has been withdrawn and can't be used"
		if voidedReason != nil && *voidedReason != "" {
			msg += " — " + *voidedReason
		}
		return "", "", &ParcelError{"BAD_INPUT", msg}
	}
	// Deliberately doesn't name the owning company on a miss — whoever
	// is holding this sticker isn't entitled to learn which of our
	// partners it was printed for.
	if stockOrgID != nil && *stockOrgID != orgID {
		return "", "", &ParcelError{"FORBIDDEN", "That label was issued to another company — use one of your own"}
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO parcel (
			id, code, "deliveryCode", "serviceTicketNumber",
			"senderName", "senderMsisdn", "receiverName", "receiverMsisdn",
			"originLabel", "destinationLabel", notes,
			"parcelType", "weightKg", fragile,
			"parcelOrgId", "externalRef", "externalSource",
			"originMethod", status, "createdAt"
		) VALUES (
			gen_random_uuid(), $1, $2, $3,
			$4, $5, $6, $7,
			$8, $9, $10,
			$11::"ParcelType", $12, $13,
			$14, $15, $16,
			'SCHEDULED_PICKUP'::"ParcelOriginMethod", 'RECEIVED_AT_COUNTER', now()
		) RETURNING id`,
		code, deliveryCode, serviceTicketNumber,
		strings.TrimSpace(in.SenderName), strings.TrimSpace(in.SenderMsisdn),
		strings.TrimSpace(in.ReceiverName), strings.TrimSpace(in.ReceiverMsisdn),
		strings.TrimSpace(in.OriginLabel), strings.TrimSpace(in.DestinationLabel), in.Notes,
		in.ParcelType, in.WeightKg, in.Fragile,
		orgID, externalRef, in.ExternalSource).Scan(&id)
	if err != nil {
		return "", "", err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE parcel_label_stock SET "usedAt" = now(), "usedByParcelId" = $2 WHERE id = $1`,
		stockID, id); err != nil {
		return "", "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}
	return id, code, nil
}

// ParcelBelongsToOrg is the scoping check every org-scoped write runs
// before touching a parcel by code.
//
// Its own function rather than an extra AND in each query because the
// failure has to be a deliberate, uniform "not yours" — a dispatcher at
// one firm probing codes must get the same answer for a code that
// doesn't exist and one that belongs to a competitor, or the endpoint
// becomes an oracle for "is this a real Esoqo parcel".
func ParcelBelongsToOrg(ctx context.Context, pool *pgxpool.Pool, code, orgID string) (bool, error) {
	var owner *string
	err := pool.QueryRow(ctx, `SELECT "parcelOrgId"::text FROM parcel WHERE code = $1`, code).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return owner != nil && *owner == orgID, nil
}

// AssignParcelToOrg hands a parcel to a courier company, or (orgID nil)
// takes it back to Esoqo-operated dispatch.
//
// Refused once the parcel is paid for. The revenue split is frozen at
// payment against a specific company (see SplitParcelRevenue), so
// moving it afterwards would leave one company's earnings recorded
// against another's parcel — and every settlement report reads those
// two columns. Refused once it's in a courier's hands for the plainer
// reason that it is physically already in motion.
func AssignParcelToOrg(ctx context.Context, pool *pgxpool.Pool, parcelID string, orgID *string) error {
	var status string
	var paidAt *string
	err := pool.QueryRow(ctx, `SELECT status::text, "paidAt"::text FROM parcel WHERE id = $1`, parcelID).
		Scan(&status, &paidAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if paidAt != nil {
		return &ParcelError{"BAD_INPUT", "This parcel is already paid for — its earnings are settled against whoever was carrying it"}
	}
	if status != "DRAFT_PENDING_PAYMENT" && status != "BOOKED" {
		return &ParcelError{"BAD_INPUT", "This parcel is already on its way"}
	}
	// The statuses this checked are carried into the UPDATE rather than
	// checked and then forgotten. Two dispatchers tapping "assign" at the
	// same moment both read a DRAFT, both write, and the parcel ends up on
	// whichever courier's write landed last — with the losing dispatch
	// having been told it worked, and a rider dispatched to a counter that
	// has already been told the box belongs to somebody else. The
	// predicate turns the loser into a refusal instead of a silent
	// overwrite.
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET "parcelOrgId" = $1
		WHERE id = $2 AND ("paidAt" IS NULL) AND status::text = ANY($3)`,
		orgID, parcelID, []string{"DRAFT_PENDING_PAYMENT", "BOOKED"})
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"CONFLICT", "That parcel moved on before it could be assigned — reload and try again"}
	}
	return nil
}

// AssignOrgParcel — a dispatcher handing one of their own parcels to
// one of their own riders. Both halves are checked against orgID: the
// parcel by ParcelBelongsToOrg at the handler, the rider here, so a
// dispatcher can't route a parcel to somebody else's courier.
func AssignOrgParcel(ctx context.Context, pool *pgxpool.Pool, code, orgID, riderPartyID string) error {
	var isMember bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM parcel_org_staff
			WHERE "orgId" = $1 AND "partyId" = $2 AND active = true
			UNION ALL
			SELECT 1 FROM parcel_courier
			WHERE "parcelOrgId" = $1 AND "partyId" = $2 AND status = 'ACTIVE'
		)`, orgID, riderPartyID).Scan(&isMember); err != nil {
		return err
	}
	if !isMember {
		return &ParcelError{"BAD_INPUT", "That rider isn't on your team"}
	}
	tag, err := pool.Exec(ctx, `
		UPDATE parcel SET "assignedCollectorPartyId" = $1
		WHERE code = $2 AND "parcelOrgId" = $3 AND status IN ('BOOKED', 'RECEIVED_AT_COUNTER')`,
		riderPartyID, code, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"BAD_INPUT", "That parcel can no longer be assigned"}
	}
	return nil
}
