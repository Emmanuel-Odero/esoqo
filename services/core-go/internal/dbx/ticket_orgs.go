// Package dbx (ticket_orgs.go) ports the organiser-console slice of
// packages/db/src/dal/ticketing.ts, seat-map.ts and addon.ts — orgs,
// venues/routes, listings, classes, schedules (+seat generation),
// seat maps, staff, org bookings, check-in and cancel. Buyer checkout
// lives in ticketing.go / ticketing_installment.go; fleet in fleet.go.
//
// JSON uses the Prisma camelCase field names so the Next.js console
// keeps rendering the same shapes it got from the DAL. Timestamps are
// RFC3339 (the DAL handed the console Date objects); decimals are
// strings (the console already does Number() on them).
package dbx

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/esoqo/core-go/internal/money"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
)

type OrgError struct {
	Code    string // NOT_FOUND | BAD_INPUT | SLUG_TAKEN | DENIED | SOLD_OUT | SEAT_TAKEN
	Message string
}

func (e *OrgError) Error() string { return e.Message }

// ── shapes ───────────────────────────────────────────────────────

type OrgJSON struct {
	ID                  string  `json:"id"`
	EnterpriseID        string  `json:"enterpriseId"`
	EnterprisePartyID   string  `json:"enterprisePartyId"`
	Name                string  `json:"name"`
	Slug                string  `json:"slug"`
	Vertical            string  `json:"vertical"`
	Status              string  `json:"status"`
	Description         *string `json:"description"`
	ContactPerson       *string `json:"contactPerson"`
	ContactEmail        *string `json:"contactEmail"`
	ContactPhone        *string `json:"contactPhone"`
	LoyaltyEnabled      bool    `json:"loyaltyEnabled"`
	LoyaltyPerKes       int     `json:"loyaltyPerKes"`
	InstallmentsEnabled bool    `json:"installmentsEnabled"`
	MinDepositPercent   int     `json:"minDepositPercent"`
	CreatedAt           string  `json:"createdAt"`
}

type VenueJSON struct {
	ID       string  `json:"id"`
	OrgID    string  `json:"orgId"`
	Name     string  `json:"name"`
	Address  *string `json:"address"`
	County   *string `json:"county"`
	Capacity *int    `json:"capacity"`
}

type RouteJSON struct {
	ID              string `json:"id"`
	OrgID           string `json:"orgId"`
	OriginName      string `json:"originName"`
	DestinationName string `json:"destinationName"`
	DistanceKM      *int   `json:"distanceKm"`
}

type ClassJSON struct {
	ID          string   `json:"id"`
	ListingID   string   `json:"listingId"`
	Name        string   `json:"name"`
	PriceKES    string   `json:"priceKes"`
	Seated      bool     `json:"seated"`
	Capacity    int      `json:"capacity"`
	Amenities   []string `json:"amenities"`
	AmenityNote *string  `json:"amenityNote"`
}

type SchedJSON struct {
	ID                 string  `json:"id"`
	ListingID          string  `json:"listingId"`
	DepartAt           string  `json:"departAt"`
	ArriveAt           *string `json:"arriveAt"`
	GateInfo           *string `json:"gateInfo"`
	VehicleOrHallLabel *string `json:"vehicleOrHallLabel"`
	Status             string  `json:"status"`
	BookingsCount      int     `json:"bookingsCount"`
}

type AddonJSON struct {
	ID        string `json:"id"`
	ListingID string `json:"listingId"`
	Name      string `json:"name"`
	PriceKES  string `json:"priceKes"`
	Active    bool   `json:"active"`
}

type ListingJSON struct {
	ID            string      `json:"id"`
	OrgID         string      `json:"orgId"`
	Title         string      `json:"title"`
	Slug          string      `json:"slug"`
	Description   *string     `json:"description"`
	CoverImageURL *string     `json:"coverImageUrl"`
	Status        string      `json:"status"`
	VenueID       *string     `json:"venueId"`
	RouteID       *string     `json:"routeId"`
	CreatedAt     string      `json:"createdAt"`
	Venue         *VenueJSON  `json:"venue"`
	Route         *RouteJSON  `json:"route"`
	TicketClasses []ClassJSON `json:"ticketClasses"`
	Schedules     []SchedJSON `json:"schedules"`
	Addons        []AddonJSON `json:"addons"`
}

type SeatMapJSON struct {
	Rows    int    `json:"rows"`
	Pattern string `json:"pattern"`
	Seats   []struct {
		Label         string `json:"label"`
		TicketClassID string `json:"ticketClassId"`
	} `json:"seats"`
}

type OrgStaffJSON struct {
	ID           string  `json:"id"`
	OrgID        string  `json:"orgId"`
	Name         string  `json:"name"`
	Role         string  `json:"role"`
	Active       bool    `json:"active"`
	CreatedAt    string  `json:"createdAt"`
	CrewMemberID *string `json:"crewMemberId,omitempty"`
}

type OrgBookingJSON struct {
	ID             string `json:"id"`
	BuyerName      string `json:"buyerName"`
	BuyerMsisdn    string `json:"buyerMsisdn"`
	Status         string `json:"status"`
	PaymentMethod  string `json:"paymentMethod"`
	TotalKES       string `json:"totalKes"`
	CreatedAt      string `json:"createdAt"`
	TicketCount    int    `json:"ticketCount"`
	CheckedInCount int    `json:"checkedInCount"`
	IssuedCount    int    `json:"issuedCount"`
	ListingTitle   string `json:"listingTitle"`
}

// ── helpers ──────────────────────────────────────────────────────

func scanOrg(row pgx.Row) (*OrgJSON, error) {
	var o OrgJSON
	var createdAt string
	err := row.Scan(&o.ID, &o.EnterpriseID, &o.EnterprisePartyID, &o.Name, &o.Slug,
		&o.Vertical, &o.Status, &o.Description, &o.ContactPerson, &o.ContactEmail, &o.ContactPhone,
		&o.LoyaltyEnabled, &o.LoyaltyPerKes, &o.InstallmentsEnabled, &o.MinDepositPercent, &createdAt)
	if err != nil {
		return nil, err
	}
	o.CreatedAt = createdAt
	return &o, nil
}

const orgSelect = `
	SELECT o.id, o."enterpriseId", e."partyId", o.name, o.slug, o.vertical::text, o.status::text,
	       o.description, o."contactPerson", o."contactEmail", o."contactPhone",
	       o."loyaltyEnabled", o."loyaltyPerKes", o."installmentsEnabled", o."minDepositPercent",
	       to_char(o."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
	FROM ticket_org o JOIN enterprise e ON e.id = o."enterpriseId"`

func slugify(name string) string {
	s := strings.ToLower(name)
	var b strings.Builder
	prevDash := true // trim leading dashes the same way (no leading '-')
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevDash = false
		} else if !prevDash {
			b.WriteRune('-')
			prevDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 48 {
		out = out[:48]
	}
	if out == "" {
		out = "listing"
	}
	return out
}

func uniqueListingSlug(ctx context.Context, pool *pgxpool.Pool, name string) (string, error) {
	base := slugify(name)
	slug := base
	for n := 1; ; n++ {
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM listing WHERE slug = $1`, slug).Scan(&count); err != nil {
			return "", err
		}
		if count == 0 {
			return slug, nil
		}
		slug = fmt.Sprintf("%s-%d", base, n)
	}
}

func uniqueOrgSlug(ctx context.Context, pool *pgxpool.Pool, name string) (string, error) {
	base := slugify(name)
	slug := base
	for n := 1; ; n++ {
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM ticket_org WHERE slug = $1`, slug).Scan(&count); err != nil {
			return "", err
		}
		if count == 0 {
			return slug, nil
		}
		slug = fmt.Sprintf("%s-%d", base, n)
	}
}

// orgIDForListing resolves the owning org for listing-scoped writes
// (publish/class/schedule/seatmap/addon), mirroring the DAL's
// find-then-assertOwnsOrg shape.
func orgIDForListing(ctx context.Context, pool *pgxpool.Pool, listingID string) (string, error) {
	var orgID string
	err := pool.QueryRow(ctx, `SELECT "orgId" FROM listing WHERE id = $1`, listingID).Scan(&orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &OrgError{"NOT_FOUND", "Listing not found"}
	}
	return orgID, err
}

// ── orgs ─────────────────────────────────────────────────────────

func CreateTicketOrg(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, enterpriseID, name, vertical string, contactPhone, contactEmail *string) (*OrgJSON, error) {
	if c.PartyID == "" {
		return nil, &OrgError{"BAD_INPUT", "Sign in to register an organiser"}
	}
	var partyID string
	err := pool.QueryRow(ctx, `SELECT "partyId" FROM enterprise WHERE id = $1`, enterpriseID).Scan(&partyID)
	if errors.Is(err, pgx.ErrNoRows) || partyID != c.PartyID {
		return nil, &OrgError{"NOT_FOUND", "That business is not on your account"}
	}
	if err != nil {
		return nil, err
	}
	if err := authsvc.RequireCapability(c, "ticketorg.write", map[string]string{"partyId": c.PartyID}); err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		return nil, &OrgError{"BAD_INPUT", "Give the organiser a name"}
	}
	if vertical != "EVENTS" && vertical != "TRANSPORT" {
		return nil, &OrgError{"BAD_INPUT", "Unknown vertical"}
	}
	slug, err := uniqueOrgSlug(ctx, pool, name)
	if err != nil {
		return nil, err
	}
	var id string
	err = pool.QueryRow(ctx, `
		INSERT INTO ticket_org (id, "enterpriseId", name, slug, vertical, status, "contactPhone", "contactEmail",
			"loyaltyEnabled", "loyaltyPerKes", "installmentsEnabled", "minDepositPercent", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4::"TicketVertical", 'ACTIVE', $5, $6, false, 1, false, 20, now(), now())
		RETURNING id`, enterpriseID, name, slug, vertical, contactPhone, contactEmail).Scan(&id)
	if err != nil {
		return nil, err
	}
	return GetTicketOrg(ctx, pool, c, id)
}

func GetTicketOrg(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) (*OrgJSON, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTicketOrgRead); err != nil {
		return nil, err
	}
	o, err := scanOrg(pool.QueryRow(ctx, orgSelect+` WHERE o.id = $1`, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &OrgError{"NOT_FOUND", "Organiser not found"}
	}
	return o, err
}

func GetTicketOrgBySlug(ctx context.Context, pool *pgxpool.Pool, slug string) (*OrgJSON, error) {
	o, err := scanOrg(pool.QueryRow(ctx, orgSelect+` WHERE o.slug = $1 AND o.status = 'ACTIVE'`, slug))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return o, err
}

func SetTicketOrgStatus(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, status string) error {
	if status != "ACTIVE" && status != "SUSPENDED" {
		return &OrgError{"BAD_INPUT", "Unknown status"}
	}
	// Oversight action — plain capability, not the owner branch.
	if err := authsvc.RequireCapability(c, "ticketorg.moderate", nil); err != nil {
		return err
	}
	_, err := pool.Exec(ctx, `UPDATE ticket_org SET status = $1::"TicketOrgStatus", "updatedAt" = now() WHERE id = $2`, status, orgID)
	return err
}

type AdminOrgRow struct {
	OrgJSON
	StaffCount    int     `json:"staffCount"`
	ListingsCount int     `json:"listingsCount"`
	OwnerName     *string `json:"ownerName"`
}

func ListTicketOrgsForStaff(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, status, vertical, search string, take, skip int) ([]AdminOrgRow, int, error) {
	if err := authsvc.RequireCapability(c, "ticketorg.read", nil); err != nil {
		return nil, 0, err
	}
	if take <= 0 || take > 100 {
		take = 25
	}
	where := `WHERE ($1 = '' OR o.status::text = $1) AND ($2 = '' OR o.vertical::text = $2)
	          AND ($3 = '' OR o.name ILIKE '%' || $3 || '%')`
	var total int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ticket_org o `+where, status, vertical, search).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := pool.Query(ctx, `
		SELECT o.id, o."enterpriseId", e."partyId", o.name, o.slug, o.vertical::text, o.status::text,
		       o.description, o."contactEmail", o."contactPhone",
		       o."loyaltyEnabled", o."loyaltyPerKes", o."installmentsEnabled", o."minDepositPercent",
		       to_char(o."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       (SELECT count(*) FROM ticket_org_staff s WHERE s."orgId" = o.id),
		       (SELECT count(*) FROM listing l WHERE l."orgId" = o.id),
		       COALESCE(pe."officialName", or2."officialName")
		FROM ticket_org o JOIN enterprise e ON e.id = o."enterpriseId"
		LEFT JOIN person pe ON pe."partyId" = e."partyId"
		LEFT JOIN organisation or2 ON or2."partyId" = e."partyId"
		`+where+` ORDER BY o."createdAt" DESC LIMIT $4 OFFSET $5`, status, vertical, search, take, skip)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []AdminOrgRow
	for rows.Next() {
		var r AdminOrgRow
		var createdAt string
		if err := rows.Scan(&r.ID, &r.EnterpriseID, &r.EnterprisePartyID, &r.Name, &r.Slug,
			&r.Vertical, &r.Status, &r.Description, &r.ContactEmail, &r.ContactPhone,
			&r.LoyaltyEnabled, &r.LoyaltyPerKes, &r.InstallmentsEnabled, &r.MinDepositPercent,
			&createdAt, &r.StaffCount, &r.ListingsCount, &r.OwnerName); err != nil {
			return nil, 0, err
		}
		r.CreatedAt = createdAt
		out = append(out, r)
	}
	return out, total, rows.Err()
}

func GetTicketOrgCounts(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx) (total, active, transport int, err error) {
	if err = authsvc.RequireCapability(c, "ticketorg.read", nil); err != nil {
		return 0, 0, 0, err
	}
	err = pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE status = 'ACTIVE'), count(*) FILTER (WHERE vertical = 'TRANSPORT')
		FROM ticket_org`).Scan(&total, &active, &transport)
	return total, active, transport, err
}

// ── venues & routes ──────────────────────────────────────────────

func CreateVenue(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, name string, address, county *string, capacity *int) (*VenueJSON, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "venue.write"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		return nil, &OrgError{"BAD_INPUT", "Give the venue a name"}
	}
	var v VenueJSON
	err := pool.QueryRow(ctx, `
		INSERT INTO venue (id, "orgId", name, address, county, capacity, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
		RETURNING id, "orgId", name, address, county, capacity`, orgID, name, address, county, capacity).
		Scan(&v.ID, &v.OrgID, &v.Name, &v.Address, &v.County, &v.Capacity)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func CreateOrgRoute(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, origin, destination string, distanceKM *int) (*RouteJSON, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "route.write"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(origin) == "" || strings.TrimSpace(destination) == "" {
		return nil, &OrgError{"BAD_INPUT", "Give the route an origin and a destination"}
	}
	var r RouteJSON
	err := pool.QueryRow(ctx, `
		INSERT INTO route (id, "orgId", "originName", "destinationName", "distanceKm", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
		RETURNING id, "orgId", "originName", "destinationName", "distanceKm"`, orgID, origin, destination, distanceKM).
		Scan(&r.ID, &r.OrgID, &r.OriginName, &r.DestinationName, &r.DistanceKM)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func ListOrgVenuesAndRoutes(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) ([]VenueJSON, []RouteJSON, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "listing.write"); err != nil {
		return nil, nil, err
	}
	vrows, err := pool.Query(ctx, `SELECT id, "orgId", name, address, county, capacity FROM venue WHERE "orgId" = $1 ORDER BY name ASC`, orgID)
	if err != nil {
		return nil, nil, err
	}
	defer vrows.Close()
	var venues []VenueJSON
	for vrows.Next() {
		var v VenueJSON
		if err := vrows.Scan(&v.ID, &v.OrgID, &v.Name, &v.Address, &v.County, &v.Capacity); err != nil {
			return nil, nil, err
		}
		venues = append(venues, v)
	}
	if err := vrows.Err(); err != nil {
		return nil, nil, err
	}
	rrows, err := pool.Query(ctx, `SELECT id, "orgId", "originName", "destinationName", "distanceKm" FROM route WHERE "orgId" = $1 ORDER BY "originName" ASC`, orgID)
	if err != nil {
		return nil, nil, err
	}
	defer rrows.Close()
	var routes []RouteJSON
	for rrows.Next() {
		var r RouteJSON
		if err := rrows.Scan(&r.ID, &r.OrgID, &r.OriginName, &r.DestinationName, &r.DistanceKM); err != nil {
			return nil, nil, err
		}
		routes = append(routes, r)
	}
	return venues, routes, rrows.Err()
}

// ── listings ─────────────────────────────────────────────────────

func CreateListing(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, title string, description, coverImageURL, venueID, routeID *string) (*ListingJSON, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "listing.write"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(title) == "" {
		return nil, &OrgError{"BAD_INPUT", "Give the listing a title"}
	}
	slug, err := uniqueListingSlug(ctx, pool, title)
	if err != nil {
		return nil, err
	}
	var id string
	err = pool.QueryRow(ctx, `
		INSERT INTO listing (id, "orgId", title, slug, description, "coverImageUrl", "venueId", "routeId", status, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'DRAFT', now(), now())
		RETURNING id`, orgID, title, slug, description, coverImageURL, venueID, routeID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return GetOrgListing(ctx, pool, c, orgID, id)
}

func listListings(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]ListingJSON, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, "orgId", title, slug, description, "coverImageUrl", status::text, "venueId"::text, "routeId"::text
		FROM listing WHERE "orgId" = $1 ORDER BY "createdAt" DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		var l ListingJSON
		if err := rows.Scan(&id, &l.OrgID, &l.Title, &l.Slug, &l.Description, &l.CoverImageURL, &l.Status, &l.VenueID, &l.RouteID); err != nil {
			return nil, err
		}
		l.ID = id
		ids = append(ids, id)
		_ = l
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]ListingJSON, 0, len(ids))
	for _, id := range ids {
		l, err := hydrateListing(ctx, pool, orgID, id)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, nil
}

func ListOrgListings(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) ([]ListingJSON, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "listing.write"); err != nil {
		return nil, err
	}
	return listListings(ctx, pool, orgID)
}

// hydrateListing loads one listing with venue/route/classes/schedules
// (+bookings counts)/addons — the getOrgListing shape.
func hydrateListing(ctx context.Context, pool *pgxpool.Pool, orgID, listingID string) (*ListingJSON, error) {
	var l ListingJSON
	err := pool.QueryRow(ctx, `
		SELECT id, "orgId", title, slug, description, "coverImageUrl", status::text, "venueId"::text, "routeId"::text,
		       to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM listing WHERE id = $1 AND "orgId" = $2`, listingID, orgID).
		Scan(&l.ID, &l.OrgID, &l.Title, &l.Slug, &l.Description, &l.CoverImageURL, &l.Status, &l.VenueID, &l.RouteID, &l.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &OrgError{"NOT_FOUND", "Listing not found"}
	}
	if err != nil {
		return nil, err
	}
	if l.VenueID != nil && *l.VenueID != "" {
		var v VenueJSON
		if err := pool.QueryRow(ctx, `SELECT id, "orgId", name, address, county, capacity FROM venue WHERE id = $1`,
			*l.VenueID).Scan(&v.ID, &v.OrgID, &v.Name, &v.Address, &v.County, &v.Capacity); err == nil {
			l.Venue = &v
		}
	}
	if l.RouteID != nil && *l.RouteID != "" {
		var r RouteJSON
		if err := pool.QueryRow(ctx, `SELECT id, "orgId", "originName", "destinationName", "distanceKm" FROM route WHERE id = $1`,
			*l.RouteID).Scan(&r.ID, &r.OrgID, &r.OriginName, &r.DestinationName, &r.DistanceKM); err == nil {
			l.Route = &r
		}
	}
	crows, err := pool.Query(ctx, `
		SELECT id, "listingId", name, "priceKes"::text, seated, capacity, amenities, "amenityNote"
		FROM ticket_class WHERE "listingId" = $1`, listingID)
	if err != nil {
		return nil, err
	}
	for crows.Next() {
		var tc ClassJSON
		if err := crows.Scan(&tc.ID, &tc.ListingID, &tc.Name, &tc.PriceKES, &tc.Seated, &tc.Capacity, &tc.Amenities, &tc.AmenityNote); err != nil {
			crows.Close()
			return nil, err
		}
		if tc.Amenities == nil {
			tc.Amenities = []string{}
		}
		l.TicketClasses = append(l.TicketClasses, tc)
	}
	crows.Close()
	if err := crows.Err(); err != nil {
		return nil, err
	}

	srows, err := pool.Query(ctx, `
		SELECT ls.id, ls."listingId", to_char(ls."departAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(ls."arriveAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ls."gateInfo", ls."vehicleOrHallLabel",
		       ls.status::text, (SELECT count(*) FROM booking b WHERE b."scheduleId" = ls.id)
		FROM listing_schedule ls WHERE ls."listingId" = $1 ORDER BY ls."departAt" ASC`, listingID)
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var s SchedJSON
		if err := srows.Scan(&s.ID, &s.ListingID, &s.DepartAt, &s.ArriveAt, &s.GateInfo, &s.VehicleOrHallLabel, &s.Status, &s.BookingsCount); err != nil {
			srows.Close()
			return nil, err
		}
		l.Schedules = append(l.Schedules, s)
	}
	srows.Close()
	if err := srows.Err(); err != nil {
		return nil, err
	}

	arows, err := pool.Query(ctx, `
		SELECT id, "listingId", name, "priceKes"::text, active FROM addon WHERE "listingId" = $1 ORDER BY "createdAt" ASC`, listingID)
	if err != nil {
		return nil, err
	}
	for arows.Next() {
		var a AddonJSON
		if err := arows.Scan(&a.ID, &a.ListingID, &a.Name, &a.PriceKES, &a.Active); err != nil {
			arows.Close()
			return nil, err
		}
		l.Addons = append(l.Addons, a)
	}
	arows.Close()
	if l.TicketClasses == nil {
		l.TicketClasses = []ClassJSON{}
	}
	if l.Schedules == nil {
		l.Schedules = []SchedJSON{}
	}
	if l.Addons == nil {
		l.Addons = []AddonJSON{}
	}
	return &l, arows.Err()
}

func GetOrgListing(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, listingID string) (*ListingJSON, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "listing.write"); err != nil {
		return nil, err
	}
	return hydrateListing(ctx, pool, orgID, listingID)
}

func PublishListing(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, listingID, status string) error {
	if status != "PUBLISHED" && status != "SUSPENDED" && status != "CANCELLED" {
		return &OrgError{"BAD_INPUT", "Unknown status"}
	}
	orgID, err := orgIDForListing(ctx, pool, listingID)
	if err != nil {
		return err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "listing.publish"); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `UPDATE listing SET status = $1::"ListingStatus", "updatedAt" = now() WHERE id = $2`, status, listingID)
	return err
}

func CreateTicketClass(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, listingID, name string, priceKES float64, capacity int, seated bool, amenities []string, amenityNote *string) (*ClassJSON, error) {
	orgID, err := orgIDForListing(ctx, pool, listingID)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "ticketclass.write"); err != nil {
		return nil, err
	}
	if capacity < 1 {
		return nil, &OrgError{"BAD_INPUT", "Capacity must be at least 1"}
	}
	if strings.TrimSpace(name) == "" {
		return nil, &OrgError{"BAD_INPUT", "Give the class a name"}
	}
	if amenities == nil {
		amenities = []string{}
	}
	var tc ClassJSON
	err = pool.QueryRow(ctx, `
		INSERT INTO ticket_class (id, "listingId", name, "priceKes", seated, capacity, amenities, "amenityNote", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now())
		RETURNING id, "listingId", name, "priceKes"::text, seated, capacity, amenities, "amenityNote"`,
		listingID, name, priceKES, seated, capacity, amenities, amenityNote).
		Scan(&tc.ID, &tc.ListingID, &tc.Name, &tc.PriceKES, &tc.Seated, &tc.Capacity, &tc.Amenities, &tc.AmenityNote)
	if err != nil {
		return nil, err
	}
	if tc.Amenities == nil {
		tc.Amenities = []string{}
	}
	return &tc, nil
}

// CreateSchedule mirrors TS createSchedule: seat-map template replay
// when the listing has one, else continuous sequential numbering
// across every seated class (never restarted per class — the
// (scheduleId, label) unique constraint).
func CreateSchedule(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, listingID string, departAt, arriveAt *string, gateInfo, vehicleOrHallLabel *string) (*SchedJSON, error) {
	orgID, err := orgIDForListing(ctx, pool, listingID)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "schedule.write"); err != nil {
		return nil, err
	}
	if departAt == nil || *departAt == "" {
		return nil, &OrgError{"BAD_INPUT", "Give a departure time"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var schedID string
	err = tx.QueryRow(ctx, `
		INSERT INTO listing_schedule (id, "listingId", "departAt", "arriveAt", "gateInfo", "vehicleOrHallLabel", status, "createdAt")
		VALUES (gen_random_uuid(), $1, $2::timestamptz, $3::timestamptz, $4, $5, 'SCHEDULED', now())
		RETURNING id`, listingID, *departAt, arriveAt, gateInfo, vehicleOrHallLabel).Scan(&schedID)
	if err != nil {
		return nil, err
	}

	var mapID string
	err = tx.QueryRow(ctx, `SELECT id FROM seat_map WHERE "listingId" = $1`, listingID).Scan(&mapID)
	if err == nil {
		mrows, err := tx.Query(ctx, `SELECT label, "ticketClassId" FROM seat_map_seat WHERE "seatMapId" = $1`, mapID)
		if err != nil {
			return nil, err
		}
		var count int
		for mrows.Next() {
			var label, classID string
			if err := mrows.Scan(&label, &classID); err != nil {
				mrows.Close()
				return nil, err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO seat (id, "scheduleId", "ticketClassId", label, status)
				VALUES (gen_random_uuid(), $1, $2, $3, 'AVAILABLE')`, schedID, classID, label); err != nil {
				mrows.Close()
				return nil, err
			}
			count++
		}
		mrows.Close()
		if count == 0 {
			return nil, &OrgError{"BAD_INPUT", "Seat map is empty"}
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		crows, err := tx.Query(ctx, `SELECT id, capacity FROM ticket_class WHERE "listingId" = $1 AND seated = true`, listingID)
		if err != nil {
			return nil, err
		}
		nextLabel := 1
		for crows.Next() {
			var classID string
			var capacity int
			if err := crows.Scan(&classID, &capacity); err != nil {
				crows.Close()
				return nil, err
			}
			for i := 0; i < capacity; i++ {
				if _, err := tx.Exec(ctx, `
					INSERT INTO seat (id, "scheduleId", "ticketClassId", label, status)
					VALUES (gen_random_uuid(), $1, $2, $3, 'AVAILABLE')`, schedID, classID, fmt.Sprintf("%d", nextLabel+i)); err != nil {
					crows.Close()
					return nil, err
				}
			}
			nextLabel += capacity
		}
		crows.Close()
	} else {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	var s SchedJSON
	err = pool.QueryRow(ctx, `
		SELECT id, "listingId", to_char("departAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char("arriveAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), "gateInfo", "vehicleOrHallLabel",
		       status::text, 0
		FROM listing_schedule WHERE id = $1`, schedID).
		Scan(&s.ID, &s.ListingID, &s.DepartAt, &s.ArriveAt, &s.GateInfo, &s.VehicleOrHallLabel, &s.Status, &s.BookingsCount)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// ── seat map ─────────────────────────────────────────────────────

type SeatMapSeatInput struct {
	Label         string
	TicketClassID string
}

func SaveSeatMap(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, listingID string, rows int, pattern string, seats []SeatMapSeatInput) error {
	orgID, err := orgIDForListing(ctx, pool, listingID)
	if err != nil {
		return err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "ticketclass.write"); err != nil {
		return err
	}
	if rows < 1 || rows > 60 {
		return &OrgError{"BAD_INPUT", "Rows must be between 1 and 60"}
	}
	if len(seats) == 0 {
		return &OrgError{"BAD_INPUT", "Paint at least one seat"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	allowed := map[string]bool{}
	crows, err := tx.Query(ctx, `SELECT id FROM ticket_class WHERE "listingId" = $1 AND seated = true`, listingID)
	if err != nil {
		return err
	}
	for crows.Next() {
		var id string
		if err := crows.Scan(&id); err != nil {
			crows.Close()
			return err
		}
		allowed[id] = true
	}
	crows.Close()
	for _, s := range seats {
		if !allowed[s.TicketClassID] {
			return &OrgError{"BAD_INPUT", "One of these ticket classes is not a seated class on this listing"}
		}
	}

	var mapID string
	err = tx.QueryRow(ctx, `
		INSERT INTO seat_map (id, "listingId", rows, pattern, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, now(), now())
		ON CONFLICT ("listingId") DO UPDATE SET rows = $2, pattern = $3, "updatedAt" = now()
		RETURNING id`, listingID, rows, pattern).Scan(&mapID)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM seat_map_seat WHERE "seatMapId" = $1`, mapID); err != nil {
		return err
	}
	for _, s := range seats {
		if _, err := tx.Exec(ctx, `
			INSERT INTO seat_map_seat (id, "seatMapId", "ticketClassId", label)
			VALUES (gen_random_uuid(), $1, $2, $3)`, mapID, s.TicketClassID, s.Label); err != nil {
			return err
		}
	}
	countByClass := map[string]int{}
	for _, s := range seats {
		countByClass[s.TicketClassID]++
	}
	for classID, count := range countByClass {
		if _, err := tx.Exec(ctx, `UPDATE ticket_class SET capacity = $1 WHERE id = $2`, count, classID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func GetSeatMap(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, listingID string) (*SeatMapJSON, error) {
	orgID, err := orgIDForListing(ctx, pool, listingID)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "ticketclass.write"); err != nil {
		return nil, err
	}
	var m SeatMapJSON
	var mapID string
	err = pool.QueryRow(ctx, `SELECT id, rows, pattern FROM seat_map WHERE "listingId" = $1`, listingID).Scan(&mapID, &m.Rows, &m.Pattern)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `SELECT label, "ticketClassId" FROM seat_map_seat WHERE "seatMapId" = $1`, mapID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var s struct {
			Label         string `json:"label"`
			TicketClassID string `json:"ticketClassId"`
		}
		if err := rows.Scan(&s.Label, &s.TicketClassID); err != nil {
			return nil, err
		}
		m.Seats = append(m.Seats, s)
	}
	if m.Seats == nil {
		m.Seats = []struct {
			Label         string `json:"label"`
			TicketClassID string `json:"ticketClassId"`
		}{}
	}
	return &m, rows.Err()
}

// ── addons ───────────────────────────────────────────────────────

func CreateAddon(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, listingID, name string, priceKES float64) (*AddonJSON, error) {
	orgID, err := orgIDForListing(ctx, pool, listingID)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "ticketclass.write"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" || priceKES <= 0 {
		return nil, &OrgError{"BAD_INPUT", "Give the extra a name and a price above zero"}
	}
	var a AddonJSON
	err = pool.QueryRow(ctx, `
		INSERT INTO addon (id, "listingId", name, "priceKes", active, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, true, now())
		RETURNING id, "listingId", name, "priceKes"::text, active`,
		listingID, name, priceKES).Scan(&a.ID, &a.ListingID, &a.Name, &a.PriceKES, &a.Active)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func SetAddonActive(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, addonID string, active bool) error {
	var listingID string
	err := pool.QueryRow(ctx, `SELECT "listingId" FROM addon WHERE id = $1`, addonID).Scan(&listingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &OrgError{"NOT_FOUND", "Extra not found"}
	}
	if err != nil {
		return err
	}
	orgID, err := orgIDForListing(ctx, pool, listingID)
	if err != nil {
		return err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "ticketclass.write"); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `UPDATE addon SET active = $1 WHERE id = $2`, active, addonID)
	return err
}

// ── org staff ────────────────────────────────────────────────────

// crewMemberID is only meaningful (and only persisted) for role ==
// "CREW" — a manager links the PIN login to the actual CrewMember
// (driver/conductor) row it's for, which is what lets that login later
// close only the one trip it's driving/conducting (trip.close:own — see
// dbx.CloseTrip). Any other role passing a non-empty crewMemberID is a
// caller mistake, not silently accepted: it's ignored so a MANAGER/ADMIN
// login can never end up impersonating a crew member's trip access.
func CreateTicketOrgStaff(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, name, pinHash, role string, crewMemberID *string) (*OrgStaffJSON, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "ticketorgstaff.write"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		return nil, &OrgError{"BAD_INPUT", "Give the staff member a name"}
	}
	if role != "ADMIN" && role != "MANAGER" && role != "SCANNER" && role != "CREW" {
		role = "SCANNER"
	}
	if role != "CREW" {
		crewMemberID = nil
	}
	if crewMemberID != nil && strings.TrimSpace(*crewMemberID) != "" {
		var crewOrg string
		if err := pool.QueryRow(ctx, `SELECT "orgId" FROM crew_member WHERE id = $1`, *crewMemberID).Scan(&crewOrg); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, &OrgError{"NOT_FOUND", "Crew member not found"}
			}
			return nil, err
		}
		if crewOrg != orgID {
			return nil, &OrgError{"BAD_INPUT", "That crew member belongs to another organiser"}
		}
	} else {
		crewMemberID = nil
	}
	var s OrgStaffJSON
	var createdAt string
	err := pool.QueryRow(ctx, `
		INSERT INTO ticket_org_staff (id, "orgId", name, "pinHash", role, "crewMemberId", active, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, now(), now())
		RETURNING id, "orgId", name, role, active, to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), "crewMemberId"`,
		orgID, strings.TrimSpace(name), pinHash, role, crewMemberID).Scan(
		&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &createdAt, &s.CrewMemberID)
	if err != nil {
		return nil, err
	}
	s.CreatedAt = createdAt
	return &s, nil
}

func ListTicketOrgStaff(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) ([]OrgStaffJSON, error) {
	// Readers need the staff list too (roster page, crew picker) — the
	// DAL gates on ticketorgstaff.write; the console's roster and the
	// mobile declare form both run under MANAGER/ADMIN-equivalent caps.
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "ticketorgstaff.write"); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT id, "orgId", name, role, active, to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), "crewMemberId"
		FROM ticket_org_staff WHERE "orgId" = $1 ORDER BY name ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrgStaffJSON
	for rows.Next() {
		var s OrgStaffJSON
		if err := rows.Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.CreatedAt, &s.CrewMemberID); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func SetTicketOrgStaffActive(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, staffID string, active bool) error {
	var orgID string
	err := pool.QueryRow(ctx, `SELECT "orgId" FROM ticket_org_staff WHERE id = $1`, staffID).Scan(&orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &OrgError{"NOT_FOUND", "Staff member not found"}
	}
	if err != nil {
		return err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "ticketorgstaff.write"); err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `UPDATE ticket_org_staff SET active = $1, "updatedAt" = now() WHERE id = $2`, active, staffID)
	return err
}

// ── org bookings / check-in / cancel ─────────────────────────────

func ListOrgBookings(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) ([]OrgBookingJSON, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "booking.read"); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT b.id, b."buyerName", b."buyerMsisdn", b.status::text, b."paymentMethod"::text, b."totalKes"::text,
		       to_char(b."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       (SELECT count(*) FROM ticket t WHERE t."bookingId" = b.id),
		       (SELECT count(*) FROM ticket t WHERE t."bookingId" = b.id AND t.status = 'USED'),
		       (SELECT count(*) FROM ticket t WHERE t."bookingId" = b.id AND t.status IN ('VALID', 'USED')),
		       l.title
		FROM booking b
		JOIN listing_schedule ls ON ls.id = b."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		WHERE l."orgId" = $1
		ORDER BY b."createdAt" DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrgBookingJSON
	for rows.Next() {
		var b OrgBookingJSON
		if err := rows.Scan(&b.ID, &b.BuyerName, &b.BuyerMsisdn, &b.Status, &b.PaymentMethod, &b.TotalKES, &b.CreatedAt, &b.TicketCount, &b.CheckedInCount, &b.IssuedCount, &b.ListingTitle); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

type CheckInResult struct {
	TicketID string `json:"ticketId"`
}

func CheckInTicket(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, code string) (*CheckInResult, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, "ticket.checkin"); err != nil {
		return nil, err
	}
	var ticketID, ticketStatus, ticketOrgID string
	err := pool.QueryRow(ctx, `
		SELECT t.id, t.status::text, l."orgId"
		FROM ticket t
		JOIN booking b ON b.id = t."bookingId"
		JOIN listing_schedule ls ON ls.id = b."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		WHERE t.code = $1`, code).Scan(&ticketID, &ticketStatus, &ticketOrgID)
	if errors.Is(err, pgx.ErrNoRows) || ticketOrgID != orgID {
		return nil, &OrgError{"NOT_FOUND", "Ticket not found for this organiser"}
	}
	if err != nil {
		return nil, err
	}
	if ticketStatus == "USED" {
		return nil, &OrgError{"BAD_INPUT", "Already checked in"}
	}
	if ticketStatus != "VALID" {
		return nil, &OrgError{"BAD_INPUT", "Ticket is not valid"}
	}
	var staffID *string
	if c.ActorType == authsvc.ActorAgent && c.ActorID != "" {
		staffID = &c.ActorID
	}
	_, err = pool.Exec(ctx, `UPDATE ticket SET status = 'USED', "checkedInAt" = now(), "checkedInById" = $1 WHERE id = $2`, staffID, ticketID)
	if err != nil {
		return nil, err
	}
	return &CheckInResult{TicketID: ticketID}, nil
}

// CancelBooking mirrors TS cancelBooking: the buyer (bearer match) or
// org staff on the organiser's schedule. Seats go back to AVAILABLE.
func CancelBooking(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, bookingID string) error {
	var buyerPartyID *string
	var listingOrgID, scheduleID string
	err := pool.QueryRow(ctx, `
		SELECT b."buyerPartyId"::text, l."orgId", b."scheduleId"
		FROM booking b
		JOIN listing_schedule ls ON ls.id = b."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		WHERE b.id = $1`, bookingID).Scan(&buyerPartyID, &listingOrgID, &scheduleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &OrgError{"NOT_FOUND", "Booking not found"}
	}
	if err != nil {
		return err
	}
	owned := buyerPartyID != nil && *buyerPartyID != "" && *buyerPartyID == c.PartyID
	if owned {
		if err := authsvc.RequireCapability(c, "booking.cancel", map[string]string{"partyId": c.PartyID}); err != nil {
			return err
		}
	} else if _, err := AssertOwnsOrg(ctx, pool, c, listingOrgID, "booking.cancel"); err != nil {
		return err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE booking SET status = 'CANCELLED' WHERE id = $1`, bookingID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE ticket SET status = 'CANCELLED' WHERE "bookingId" = $1`, bookingID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		UPDATE seat SET status = 'AVAILABLE' WHERE id IN (SELECT "seatId" FROM ticket WHERE "bookingId" = $1 AND "seatId" IS NOT NULL)`, bookingID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RetryBookingPayment re-sends the M-Pesa prompt for a plain booking
// still PENDING_PAYMENT — prompt timed out, wrong PIN, app closed
// before approval — without losing claimed seats/GA slots. Buyer-only
// (bearer must match); installment plans pay down via balance top-ups,
// never a full-total re-push (which would confirm PAID without issuing
// planned tickets).
func RetryBookingPayment(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, bookingID string) (msisdn, totalKES string, err error) {
	var buyerPartyID *string
	var status, method string
	var isInstallment bool
	err = pool.QueryRow(ctx, `
		SELECT "buyerPartyId"::text, status::text, "paymentMethod"::text, "isInstallment", "buyerMsisdn", "totalKes"::text
		FROM booking WHERE id = $1`, bookingID).
		Scan(&buyerPartyID, &status, &method, &isInstallment, &msisdn, &totalKES)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", &OrgError{"NOT_FOUND", "Booking not found"}
	}
	if err != nil {
		return "", "", err
	}
	if buyerPartyID == nil || *buyerPartyID == "" || *buyerPartyID != c.PartyID {
		return "", "", &OrgError{"NOT_FOUND", "Booking not found"}
	}
	if err := authsvc.RequireCapability(c, "booking.read", map[string]string{"partyId": c.PartyID}); err != nil {
		return "", "", err
	}
	if isInstallment || status != "PENDING_PAYMENT" || method != "MPESA_STK" {
		return "", "", &OrgError{"BAD_INPUT", "This booking is not awaiting payment"}
	}
	return msisdn, totalKES, nil
}

// ── buyer reads (rich) ───────────────────────────────────────────

type MyTicketJSON struct {
	ID         string  `json:"id"`
	Code       string  `json:"code"`
	HolderName *string `json:"holderName"`
	Status     string  `json:"status"`
	PriceKES   string  `json:"priceKes"`
}

type MyBookingPaymentJSON struct {
	AmountKES   string  `json:"amountKes"`
	Kind        string  `json:"kind"`
	Status      string  `json:"status"`
	ConfirmedAt *string `json:"confirmedAt"`
}

type MyBookingJSON struct {
	ID            string                 `json:"id"`
	Status        string                 `json:"status"`
	TotalKES      string                 `json:"totalKes"`
	AmountPaidKES string                 `json:"amountPaidKes"`
	IsInstallment bool                   `json:"isInstallment"`
	PaymentMethod string                 `json:"paymentMethod"`
	BalanceDueBy  *string                `json:"balanceDueBy"`
	BuyerName     string                 `json:"buyerName"`
	BuyerMsisdn   string                 `json:"buyerMsisdn"`
	ListingTitle  string                 `json:"listingTitle"`
	OrgName       string                 `json:"orgName"`
	Vertical      string                 `json:"vertical"`
	DepartAt      string                 `json:"departAt"`
	VenueName     *string                `json:"venueName"`
	RouteFrom     *string                `json:"routeFrom"`
	RouteTo       *string                `json:"routeTo"`
	Tickets       []MyTicketJSON         `json:"tickets"`
	Payments      []MyBookingPaymentJSON `json:"payments"`
}

// ListMyBookingsRich ports TS getMyBookings: the buyer's full history
// with schedule/listing/org context, tickets and plan payments.
func ListMyBookingsRich(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx) ([]MyBookingJSON, error) {
	if err := authsvc.RequireCapability(c, "booking.read", map[string]string{"partyId": c.PartyID}); err != nil {
		return nil, err
	}
	if c.PartyID == "" {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT b.id, b.status::text, b."totalKes"::text, b."amountPaidKes"::text,
		       b."isInstallment", b."paymentMethod"::text,
		       to_char(b."balanceDueBy", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       b."buyerName", b."buyerMsisdn", l.title, o.name, o.vertical::text,
		       to_char(ls."departAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       v.name, r."originName", r."destinationName"
		FROM booking b
		JOIN listing_schedule ls ON ls.id = b."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		JOIN ticket_org o ON o.id = l."orgId"
		LEFT JOIN venue v ON v.id = l."venueId"
		LEFT JOIN route r ON r.id = l."routeId"
		WHERE b."buyerPartyId" = $1
		ORDER BY b."createdAt" DESC`, c.PartyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MyBookingJSON
	for rows.Next() {
		var b MyBookingJSON
		if err := rows.Scan(&b.ID, &b.Status, &b.TotalKES, &b.AmountPaidKES, &b.IsInstallment,
			&b.PaymentMethod, &b.BalanceDueBy, &b.BuyerName, &b.BuyerMsisdn, &b.ListingTitle, &b.OrgName, &b.Vertical,
			&b.DepartAt, &b.VenueName, &b.RouteFrom, &b.RouteTo); err != nil {
			return nil, err
		}
		tickets, err := myBookingTickets(ctx, pool, b.ID)
		if err != nil {
			return nil, err
		}
		b.Tickets = tickets
		payments, err := myBookingPayments(ctx, pool, b.ID)
		if err != nil {
			return nil, err
		}
		b.Payments = payments
		out = append(out, b)
	}
	return out, rows.Err()
}

func myBookingTickets(ctx context.Context, pool *pgxpool.Pool, bookingID string) ([]MyTicketJSON, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, code, "holderName", status::text, "priceKes"::text
		FROM ticket WHERE "bookingId" = $1`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MyTicketJSON
	for rows.Next() {
		var t MyTicketJSON
		if err := rows.Scan(&t.ID, &t.Code, &t.HolderName, &t.Status, &t.PriceKES); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if out == nil {
		out = []MyTicketJSON{}
	}
	return out, rows.Err()
}

func myBookingPayments(ctx context.Context, pool *pgxpool.Pool, bookingID string) ([]MyBookingPaymentJSON, error) {
	rows, err := pool.Query(ctx, `
		SELECT "amountKes"::text, kind, status, to_char("confirmedAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM booking_payment WHERE "bookingId" = $1 ORDER BY "createdAt" ASC`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MyBookingPaymentJSON
	for rows.Next() {
		var p MyBookingPaymentJSON
		if err := rows.Scan(&p.AmountKES, &p.Kind, &p.Status, &p.ConfirmedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if out == nil {
		out = []MyBookingPaymentJSON{}
	}
	return out, rows.Err()
}

type BookingStatusJSON struct {
	ID            string                 `json:"id"`
	Status        string                 `json:"status"`
	Points        *int                   `json:"points"`
	IsInstallment bool                   `json:"isInstallment"`
	TotalKES      string                 `json:"totalKes"`
	AmountPaidKES string                 `json:"amountPaidKes"`
	BalanceKES    string                 `json:"balanceKes"`
	BalanceDueBy  *string                `json:"balanceDueBy"`
	Payments      []MyBookingPaymentJSON `json:"payments"`
}

// GetBookingStatus ports TS getBookingStatus: buyer-only for
// party-owned bookings, id-as-secret for guest ones.
func GetBookingStatus(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, bookingID string) (*BookingStatusJSON, error) {
	var st BookingStatusJSON
	var buyerPartyID *string
	var ticketCustomerID *string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "buyerPartyId"::text, "ticketCustomerId"::text,
		       "isInstallment", "totalKes"::text, "amountPaidKes"::text,
		       ("totalKes" - "amountPaidKes")::text,
		       to_char("balanceDueBy", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM booking WHERE id = $1`, bookingID).
		Scan(&st.ID, &st.Status, &buyerPartyID, &ticketCustomerID, &st.IsInstallment,
			&st.TotalKES, &st.AmountPaidKES, &st.BalanceKES, &st.BalanceDueBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &OrgError{"NOT_FOUND", "Booking not found"}
	}
	if err != nil {
		return nil, err
	}
	if buyerPartyID != nil && *buyerPartyID != "" {
		if c.PartyID != *buyerPartyID {
			return nil, &OrgError{"NOT_FOUND", "Booking not found"}
		}
		if err := authsvc.RequireCapability(c, "booking.read", map[string]string{"partyId": c.PartyID}); err != nil {
			return nil, err
		}
	}
	if ticketCustomerID != nil && *ticketCustomerID != "" {
		pts, err := ticketCustomerPoints(ctx, pool, *ticketCustomerID)
		if err != nil {
			return nil, err
		}
		st.Points = &pts
	}
	payments, err := myBookingPayments(ctx, pool, bookingID)
	if err != nil {
		return nil, err
	}
	st.Payments = payments
	return &st, nil
}

func ticketCustomerPoints(ctx context.Context, pool *pgxpool.Pool, customerID string) (int, error) {
	var pts *int
	err := pool.QueryRow(ctx, `SELECT SUM(points)::int FROM ticket_loyalty_entry WHERE "customerId" = $1`, customerID).Scan(&pts)
	if err != nil {
		return 0, err
	}
	if pts == nil {
		return 0, nil
	}
	return *pts, nil
}

type BalanceViewJSON struct {
	ID            string               `json:"id"`
	Status        string               `json:"status"`
	BuyerName     string               `json:"buyerName"`
	BuyerMsisdn   string               `json:"buyerMsisdn"`
	TotalKES      money.Amount         `json:"totalKes"`
	AmountPaidKES money.Amount         `json:"amountPaidKes"`
	BalanceKES    money.Amount         `json:"balanceKes"`
	BalanceDueBy  *string              `json:"balanceDueBy"`
	DepartAt      string               `json:"departAt"`
	ListingTitle  string               `json:"listingTitle"`
	ListingSlug   string               `json:"listingSlug"`
	OrgName       string               `json:"orgName"`
	Where         *string              `json:"where"`
	Payments      []BalancePaymentJSON `json:"payments"`
}

type BalancePaymentJSON struct {
	AmountKES   money.Amount `json:"amountKes"`
	Kind        string       `json:"kind"`
	Status      string       `json:"status"`
	ConfirmedAt *string      `json:"confirmedAt"`
}

// GetBookingBalanceView ports TS getBookingForBalancePayment — public,
// id-as-secret, installment plans only.
func GetBookingBalanceView(ctx context.Context, pool *pgxpool.Pool, bookingID string) (*BalanceViewJSON, error) {
	var v BalanceViewJSON
	var isInstallment bool
	var totalText, paidText string
	var venueName, routeFrom, routeTo *string
	err := pool.QueryRow(ctx, `
		SELECT b.id, b.status::text, b."buyerName", b."buyerMsisdn", b."isInstallment",
		       b."totalKes"::text, b."amountPaidKes"::text,
		       to_char(b."balanceDueBy", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(ls."departAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       l.title, l.slug, o.name, v.name, r."originName", r."destinationName"
		FROM booking b
		JOIN listing_schedule ls ON ls.id = b."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		JOIN ticket_org o ON o.id = l."orgId"
		LEFT JOIN venue v ON v.id = l."venueId"
		LEFT JOIN route r ON r.id = l."routeId"
		WHERE b.id = $1`, bookingID).
		Scan(&v.ID, &v.Status, &v.BuyerName, &v.BuyerMsisdn, &isInstallment,
			&totalText, &paidText, &v.BalanceDueBy, &v.DepartAt,
			&v.ListingTitle, &v.ListingSlug, &v.OrgName, &venueName, &routeFrom, &routeTo)
	if errors.Is(err, pgx.ErrNoRows) || !isInstallment {
		return nil, &OrgError{"NOT_FOUND", "Booking not found"}
	}
	if err != nil {
		return nil, err
	}
	// Exact cents: the balance is what a buyer is asked to pay, and
	// `total - paid` in float is the subtraction that leaves a plan a
	// hundredth of a cent short of settled.
	total := money.MustParseKES(totalText)
	paid := money.MustParseKES(paidText)
	v.TotalKES = money.AmountOf(total)
	v.AmountPaidKES = money.AmountOf(paid)
	balance := total - paid
	if balance < 0 {
		balance = money.Zero
	}
	v.BalanceKES = money.AmountOf(balance)
	if venueName != nil && *venueName != "" {
		v.Where = venueName
	} else if routeFrom != nil && *routeFrom != "" {
		where := *routeFrom + " → " + derefStr(routeTo)
		v.Where = &where
	}
	prows, err := pool.Query(ctx, `
		SELECT "amountKes"::text, kind, status, to_char("confirmedAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM booking_payment WHERE "bookingId" = $1 ORDER BY "createdAt" ASC`, bookingID)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var p BalancePaymentJSON
		var amountText string
		if err := prows.Scan(&amountText, &p.Kind, &p.Status, &p.ConfirmedAt); err != nil {
			return nil, err
		}
		p.AmountKES = money.AmountOf(money.MustParseKES(amountText))
		v.Payments = append(v.Payments, p)
	}
	if v.Payments == nil {
		v.Payments = []BalancePaymentJSON{}
	}
	return &v, prows.Err()
}

func parseFloat(s string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(s), 64)
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ── my orgs + public trips ───────────────────────────────────────

// TicketOrgSummary is the switcher row for "companies I run" —
// mirrors TS listMyTicketOrgs: scoped to the subject's own enterprises,
// oldest first.
type TicketOrgSummary struct {
	ID       string
	Name     string
	Slug     string
	Vertical string
	Status   string
}

func ListMyTicketOrgs(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx) ([]TicketOrgSummary, error) {
	if err := authsvc.RequireCapability(c, "ticketorg.write", map[string]string{"partyId": c.PartyID}); err != nil {
		// Owners hold ticketorg.write:own; anyone else has no orgs here.
		// Return empty (not denied) so the client renders "no companies"
		// instead of an error state — same spirit as TS listMyTicketOrgs
		// returning [] when signed out.
		if _, ok := err.(*authsvc.AuthorisationError); ok {
			return nil, nil
		}
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT o.id, o.name, o.slug, o.vertical::text, o.status::text
		FROM ticket_org o
		JOIN enterprise e ON e.id = o."enterpriseId"
		WHERE e."partyId" = $1
		ORDER BY o."createdAt" ASC`, c.PartyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TicketOrgSummary
	for rows.Next() {
		var o TicketOrgSummary
		if err := rows.Scan(&o.ID, &o.Name, &o.Slug, &o.Vertical, &o.Status); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// PublicActiveTrip is the passenger-facing projection of an open duty
// trip: plate + route + fare stages, deliberately WITHOUT crew names
// (staff PII has no business on a public screen) and without GPS.
type PublicActiveTrip struct {
	TripID       string
	VehiclePlate string
	RouteName    *string
	Stages       []FareStageRow
}

func ListPublicActiveTrips(ctx context.Context, pool *pgxpool.Pool, orgSlug string) ([]PublicActiveTrip, error) {
	var orgID string
	var orgStatus string
	if err := pool.QueryRow(ctx, `SELECT id, status::text FROM ticket_org WHERE slug = $1`, orgSlug).Scan(&orgID, &orgStatus); err != nil {
		return nil, nil // unknown slug — empty, not an error (public screen)
	}
	if orgStatus != "ACTIVE" {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT t.id, v."plateNo", r.name
		FROM trip t
		JOIN fleet_vehicle v ON v.id = t."vehicleId"
		LEFT JOIN short_route r ON r.id = t."shortRouteId"
		WHERE t."orgId" = $1 AND t.status = 'ACTIVE'
		ORDER BY t."startedAt" DESC LIMIT 50`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PublicActiveTrip
	for rows.Next() {
		var tripID, plate string
		var routeName *string
		if err := rows.Scan(&tripID, &plate, &routeName); err != nil {
			return nil, err
		}
		var routeID *string
		_ = pool.QueryRow(ctx, `SELECT "shortRouteId"::text FROM trip WHERE id = $1`, tripID).Scan(&routeID)
		var stages []FareStageRow
		if routeID != nil && *routeID != "" {
			stages, err = listStages(ctx, pool, *routeID)
			if err != nil {
				return nil, err
			}
		}
		out = append(out, PublicActiveTrip{TripID: tripID, VehiclePlate: plate, RouteName: routeName, Stages: stages})
	}
	return out, rows.Err()
}
