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
}

const parcelOrgColumns = `
	id, "enterpriseId", name, slug, status, "contactPerson", "contactPhone",
	"contactEmail", "settlementPhone", "commissionPct"::text,
	"acceptsWalkIn", lat::text, lng::text, "locationHint", "openingHours"`

func scanParcelOrg(row pgx.Row) (*ParcelOrg, error) {
	var o ParcelOrg
	var commissionText string
	var latText, lngText *string
	if err := row.Scan(&o.ID, &o.EnterpriseID, &o.Name, &o.Slug, &o.Status,
		&o.ContactPerson, &o.ContactPhone, &o.ContactEmail, &o.SettlementPhone,
		&commissionText, &o.AcceptsWalkIn, &latText, &lngText, &o.LocationHint, &o.OpeningHours); err != nil {
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
	// PrimaryContactName/Phone — the first MANAGER on the roster (active
	// ones first), not ParcelOrg.contactPerson. A contact is a person and
	// people leave; the company outlives them. Falls back to the legacy
	// contactPerson/contactPhone pair only when no manager exists yet, so
	// data an admin typed before this split is never silently lost.
	PrimaryContactName  *string `json:"primaryContactName"`
	PrimaryContactPhone *string `json:"primaryContactPhone"`
}

const adminParcelOrgColumns = `
	o.id, o."enterpriseId", o.name, o.slug, o.status, o."contactPerson", o."contactPhone",
	o."contactEmail", o."settlementPhone", o."commissionPct"::text,
	o."acceptsWalkIn", o.lat::text, o.lng::text, o."locationHint", o."openingHours",
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
		WHERE st."orgId" = o.id AND st.role = 'MANAGER'
		ORDER BY st.active DESC, st."createdAt" ASC
		LIMIT 1
	) mgr ON true`

func scanAdminParcelOrg(row pgx.Row) (*AdminParcelOrg, error) {
	var o AdminParcelOrg
	var commissionText string
	var latText, lngText *string
	if err := row.Scan(&o.ID, &o.EnterpriseID, &o.Name, &o.Slug, &o.Status,
		&o.ContactPerson, &o.ContactPhone, &o.ContactEmail, &o.SettlementPhone,
		&commissionText, &o.AcceptsWalkIn, &latText, &lngText, &o.LocationHint, &o.OpeningHours,
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
			"createdAt", "updatedAt", "createdByStaffId"
		) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now(), $15)
		RETURNING id`,
		in.EnterpriseID, in.Name, in.Slug, in.Status, in.ContactPerson, in.ContactPhone,
		in.ContactEmail, in.SettlementPhone, in.CommissionPct,
		in.AcceptsWalkIn, in.Lat, in.Lng, in.LocationHint, in.OpeningHours, staffID).Scan(&id)
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
			"updatedAt" = now()
		WHERE id = $14`,
		in.Name, in.Slug, in.Status, in.ContactPerson, in.ContactPhone,
		in.ContactEmail, in.SettlementPhone, in.CommissionPct,
		in.AcceptsWalkIn, in.Lat, in.Lng, in.LocationHint, in.OpeningHours, id)
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
	ID        string  `json:"id"`
	OrgID     string  `json:"orgId"`
	Name      string  `json:"name"`
	Role      string  `json:"role"`
	Active    bool    `json:"active"`
	PartyID   *string `json:"partyId"`
	StationID *string `json:"stationId"`
	// Msisdn / EsoqoID — the phone and the ESK-… handle this person can
	// sign in with, joined out from their Party. Surfaced so an admin can
	// read a login back to someone who forgot it, and so the roster shows
	// a credential actually exists rather than a bare uuid. Both nil for
	// an office-only login that was never linked to a person.
	Msisdn  *string `json:"msisdn"`
	EsoqoID *string `json:"esoqoId"`
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
		SELECT st.id, st."orgId", st.name, st.role, st.active, st."pinHash", st."partyId"::text
		FROM parcel_org_staff st
		JOIN parcel_org o ON o.id = st."orgId"
		WHERE o.slug = $1 AND lower(st.name) = lower($2) AND o.status = 'ACTIVE'`,
		orgSlug, strings.TrimSpace(name)).
		Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.PinHash, &s.PartyID)
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
	err := pool.QueryRow(ctx, `SELECT st.id, st."orgId", st.name, st.role, st.active, st."pinHash", st."partyId"::text FROM parcel_org_staff st JOIN parcel_org o ON o.id = st."orgId" WHERE o.slug = $1 AND st."partyId" = $2 AND o.status = 'ACTIVE'`, orgSlug, partyID).
		Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.PinHash, &s.PartyID)
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

func ListParcelOrgStaff(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]ParcelOrgStaff, error) {
	rows, err := pool.Query(ctx, `
		SELECT st.id, st."orgId", st.name, st.role, st.active, st."partyId"::text, st."stationId"::text,
		       pr.msisdn, epi.code
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
		if err := rows.Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.PartyID, &s.StationID, &s.Msisdn, &s.EsoqoID); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
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
}

func ListParcelOrgStations(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]ParcelOrgStation, error) {
	rows, err := pool.Query(ctx, `SELECT id, name, msisdn, "locationHint", "openingHours", lat::text, lng::text, capacity, active FROM parcel_agent WHERE "parcelOrgId" = $1 ORDER BY name`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ParcelOrgStation
	for rows.Next() {
		var s ParcelOrgStation
		var lat, lng string
		if err := rows.Scan(&s.ID, &s.Name, &s.Msisdn, &s.LocationHint, &s.OpeningHours, &lat, &lng, &s.Capacity, &s.Active); err != nil {
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
func UpsertParcelOrgStaff(ctx context.Context, pool *pgxpool.Pool, id *string, orgID, name, role, pinHash string, partyID *string, active bool, stationID *string) error {
	if strings.TrimSpace(name) == "" {
		return &ParcelError{"BAD_INPUT", "Give this person a name"}
	}
	if _, ok := parcelStaffRoleIsKnown(role); !ok {
		return &ParcelError{"BAD_INPUT", "Pick a valid role"}
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
			INSERT INTO parcel_org_staff (id, "orgId", name, "pinHash", role, active, "partyId", "stationId", "createdAt", "updatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now(), now())`,
			orgID, name, pinHash, role, active, partyID, stationID)
		return err
	}
	// Scoped by orgID as well as id: an org session must not be able to
	// edit another company's staff row by guessing a uuid.
	tag, err := pool.Exec(ctx, `
		UPDATE parcel_org_staff SET
			name = $1, role = $2, active = $3, "partyId" = $4, "stationId" = $5,
				"pinHash" = CASE WHEN $6 = '' THEN "pinHash" ELSE $6 END,
				"updatedAt" = now()
		WHERE id = $7 AND "orgId" = $8`,
		name, role, active, partyID, stationID, pinHash, *id, orgID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return &ParcelError{"NOT_FOUND", "That person was not found"}
	}
	return nil
}

func parcelStaffRoleIsKnown(role string) (string, bool) {
	switch role {
	case "RIDER", "DISPATCHER", "MANAGER":
		return role, true
	}
	return "", false
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
			count(*) FILTER (WHERE status = 'BOOKED' AND "originMethod" = 'SELF_DROPOFF')
		FROM parcel
		WHERE "parcelOrgId" = $1 AND status != 'CANCELLED'`, orgID).
		Scan(&s.AwaitingPickup, &s.InTransit, &s.FailedDeliveries, &s.AtAgent,
			&s.DeliveredToday, &s.EarningsTodayKes, &s.EarningsKes, &s.AwaitingDropoff)
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
	// OriginMethod — see Parcel.originMethod's own comment. Lets the
	// front desk's "Awaiting drop-off" tab tell "a sender is bringing
	// this in themselves" apart from "still waiting on our own rider",
	// which today's plain status filter alone can't distinguish.
	OriginMethod string `json:"originMethod"`
}

// ListOrgParcels — this company's parcels, newest first.
//
// orgID is never taken from the request; it comes from the session (see
// handlers_parcel_orgs.go). status/originMethod are optional exact
// filters, combined with AND — "awaiting drop-off" is exactly
// status=BOOKED AND originMethod=SELF_DROPOFF, so the front desk asks
// for both rather than the handler special-casing a pseudo-status.
func ListOrgParcels(ctx context.Context, pool *pgxpool.Pool, orgID string, status, originMethod *string) ([]OrgParcelRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT p.id, p.code, p.status::text, p."receiverName", p."receiverMsisdn",
		       p."originLabel", p."destinationLabel", p."parcelType"::text,
		       p."orgEarningsKes"::text,
		       to_char(p."createdAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       to_char(p."slaDeadlineAt", 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       p."deliveryAttempts", p."lastAttemptReason",
		       COALESCE(pr."knownAs", pr."officialName"), a.name, p."originMethod"::text
		FROM parcel p
		LEFT JOIN person pr ON pr."partyId" = p."currentHolderPartyId"
		LEFT JOIN parcel_agent a ON a.id = p."destinationAgentId"
		WHERE p."parcelOrgId" = $1
		  AND ($2::text IS NULL OR p.status::text = $2)
		  AND ($3::text IS NULL OR p."originMethod"::text = $3)
		ORDER BY p."createdAt" DESC
		LIMIT 200`, orgID, status, originMethod)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrgParcelRow
	for rows.Next() {
		var r OrgParcelRow
		if err := rows.Scan(&r.ID, &r.Code, &r.Status, &r.ReceiverName, &r.ReceiverMsisdn,
			&r.OriginLabel, &r.DestinationLabel, &r.ParcelType, &r.OrgEarningsKes,
			&r.CreatedAt, &r.SlaDeadlineAt, &r.DeliveryAttempts, &r.LastAttemptReason,
			&r.HolderName, &r.AgentName, &r.OriginMethod); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
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
	_, err = pool.Exec(ctx, `UPDATE parcel SET "parcelOrgId" = $1 WHERE id = $2`, orgID, parcelID)
	return err
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
