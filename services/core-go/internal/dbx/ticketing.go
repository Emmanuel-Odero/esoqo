// Package dbx (ticketing.go) ports the buyer-facing slice of
// packages/db/src/dal/ticketing.ts and ticket-customer.ts — public
// browse + book only. Organiser console (create listings, check-in
// scanning), installment plans and TicketOrgStaff auth stay
// TypeScript-only for mobile v1 (see the plan's own scope note).
package dbx

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/fleetqr"
	"github.com/esoko/core-go/internal/ledger"
	"github.com/esoko/core-go/internal/loyalty"
)

func earnUnifiedLoyaltyTicket(ctx context.Context, pool *pgxpool.Pool, partyID string, kes float64, ref string) error {
	if partyID == "" {
		return nil
	}
	return loyalty.EarnForSpend(ctx, pool, partyID, kes, ref, true)
}

type ListingSummary struct {
	ID                string
	Slug              string
	Title             string
	CoverURL          *string
	Vertical          string // EVENTS | TRANSPORT
	VenueOrRouteLabel *string
	FromPriceKES      *string
	// Enriched for the web directory (mobile ignores extras): split
	// venue/route/county, next departure and schedule count.
	OrgName       *string `json:"OrgName"`
	VenueName     *string `json:"VenueName"`
	VenueCounty   *string `json:"VenueCounty"`
	RouteOrigin   *string `json:"RouteOrigin"`
	RouteDest     *string `json:"RouteDest"`
	NextDepartAt  *string `json:"NextDepartAt"`
	ScheduleCount int     `json:"ScheduleCount"`
}

// ListPublicListings mirrors listPublicListings — only PUBLISHED
// listings of ACTIVE orgs, cheapest ticket class shown as the "from"
// price the same way a storefront shows its cheapest variant.
func ListPublicListings(ctx context.Context, pool *pgxpool.Pool, vertical string, limit, offset int) ([]ListingSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT l.id, l.slug, l.title, l."coverImageUrl", o.vertical,
		       COALESCE(v.name, r."originName" || ' → ' || r."destinationName"),
		       (SELECT MIN(tc."priceKes")::text FROM ticket_class tc WHERE tc."listingId" = l.id),
		       o.name, v.name, v.county, r."originName", r."destinationName",
		       (SELECT to_char(MIN(ls."departAt"), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM listing_schedule ls
		         WHERE ls."listingId" = l.id AND ls.status = 'SCHEDULED'),
		       (SELECT count(*) FROM listing_schedule ls
		         WHERE ls."listingId" = l.id AND ls.status = 'SCHEDULED')
		FROM listing l
		JOIN ticket_org o ON o.id = l."orgId"
		LEFT JOIN venue v ON v.id = l."venueId"
		LEFT JOIN route r ON r.id = l."routeId"
		WHERE l.status = 'PUBLISHED' AND o.status = 'ACTIVE'
		  AND ($1 = '' OR o.vertical::text = $1)
		ORDER BY l."createdAt" DESC
		LIMIT $2 OFFSET $3`, vertical, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ListingSummary
	for rows.Next() {
		var s ListingSummary
		if err := rows.Scan(&s.ID, &s.Slug, &s.Title, &s.CoverURL, &s.Vertical, &s.VenueOrRouteLabel, &s.FromPriceKES,
			&s.OrgName, &s.VenueName, &s.VenueCounty, &s.RouteOrigin, &s.RouteDest, &s.NextDepartAt, &s.ScheduleCount); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

type ScheduleSummary struct {
	ID                 string
	DepartAt           string
	ArriveAt           *string
	GateInfo           *string
	VehicleOrHallLabel *string
	Status             string
}

type TicketClassSummary struct {
	ID          string
	Name        string
	PriceKES    string
	Seated      bool
	Capacity    int
	Amenities   []string
	AmenityNote *string
}

type DetailOrg struct {
	Name                string `json:"Name"`
	Vertical            string `json:"Vertical"`
	InstallmentsEnabled bool   `json:"InstallmentsEnabled"`
	MinDepositPercent   int    `json:"MinDepositPercent"`
}

type DetailVenue struct {
	Name   string  `json:"Name"`
	County *string `json:"County"`
}

type DetailRoute struct {
	OriginName      string `json:"OriginName"`
	DestinationName string `json:"DestinationName"`
}

type DetailSeat struct {
	Label         string `json:"Label"`
	TicketClassID string `json:"TicketClassID"`
}

type DetailSeatMap struct {
	Rows    int          `json:"Rows"`
	Pattern string       `json:"Pattern"`
	Seats   []DetailSeat `json:"Seats"`
}

type DetailAddon struct {
	ID       string `json:"ID"`
	Name     string `json:"Name"`
	PriceKES string `json:"PriceKES"`
}

type ListingDetail struct {
	ListingSummary
	Description   *string
	Org           *DetailOrg   `json:"Org"`
	Venue         *DetailVenue `json:"Venue"`
	Route         *DetailRoute `json:"Route"`
	TicketClasses []TicketClassSummary
	Schedules     []ScheduleSummary
	SeatMap       *DetailSeatMap `json:"SeatMap"`
	Addons        []DetailAddon  `json:"Addons"`
}

// GetPublicListing mirrors TS getPublicListing — PUBLISHED listings of
// ACTIVE orgs, addressable by slug (storefront) or id. Enriched
// additively over the mobile shape: org flags, venue/route splits,
// amenity notes, hall labels, seat-map template and active addons.
func GetPublicListing(ctx context.Context, pool *pgxpool.Pool, idOrSlug string) (*ListingDetail, error) {
	var d ListingDetail
	var org DetailOrg
	var venueName, venueCounty, routeOrigin, routeDest *string
	err := pool.QueryRow(ctx, `
		SELECT l.id, l.slug, l.title, l.description, l."coverImageUrl", o.vertical,
		       COALESCE(v.name, r."originName" || ' → ' || r."destinationName"),
		       o.name, o.vertical::text, o."installmentsEnabled", o."minDepositPercent",
		       v.name, v.county, r."originName", r."destinationName"
		FROM listing l
		JOIN ticket_org o ON o.id = l."orgId"
		LEFT JOIN venue v ON v.id = l."venueId"
		LEFT JOIN route r ON r.id = l."routeId"
		WHERE (l.slug = $1 OR l.id::text = $1) AND l.status = 'PUBLISHED' AND o.status = 'ACTIVE'`, idOrSlug).
		Scan(&d.ID, &d.Slug, &d.Title, &d.Description, &d.CoverURL, &d.Vertical, &d.VenueOrRouteLabel,
			&org.Name, &org.Vertical, &org.InstallmentsEnabled, &org.MinDepositPercent,
			&venueName, &venueCounty, &routeOrigin, &routeDest)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.Org = &org
	if venueName != nil {
		d.Venue = &DetailVenue{Name: *venueName, County: venueCounty}
	} else if routeOrigin != nil {
		d.Route = &DetailRoute{OriginName: *routeOrigin, DestinationName: derefStr(routeDest)}
	}

	tcRows, err := pool.Query(ctx, `
		SELECT id, name, "priceKes"::text, seated, capacity, amenities, "amenityNote"
		FROM ticket_class WHERE "listingId" = $1`, d.ID)
	if err != nil {
		return nil, err
	}
	defer tcRows.Close()
	for tcRows.Next() {
		var tc TicketClassSummary
		if err := tcRows.Scan(&tc.ID, &tc.Name, &tc.PriceKES, &tc.Seated, &tc.Capacity, &tc.Amenities, &tc.AmenityNote); err != nil {
			return nil, err
		}
		if tc.Amenities == nil {
			tc.Amenities = []string{}
		}
		d.TicketClasses = append(d.TicketClasses, tc)
	}

	schRows, err := pool.Query(ctx, `
		SELECT id, to_char("departAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char("arriveAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), "gateInfo", "vehicleOrHallLabel", status::text
		FROM listing_schedule
		WHERE "listingId" = $1 AND status = 'SCHEDULED' AND "departAt" > now()
		ORDER BY "departAt" ASC`, d.ID)
	if err != nil {
		return nil, err
	}
	defer schRows.Close()
	for schRows.Next() {
		var s ScheduleSummary
		if err := schRows.Scan(&s.ID, &s.DepartAt, &s.ArriveAt, &s.GateInfo, &s.VehicleOrHallLabel, &s.Status); err != nil {
			return nil, err
		}
		d.Schedules = append(d.Schedules, s)
	}
	if err := schRows.Err(); err != nil {
		return nil, err
	}

	var mapID, pattern string
	var mapRows int
	err = pool.QueryRow(ctx, `SELECT id, rows, pattern FROM seat_map WHERE "listingId" = $1`, d.ID).Scan(&mapID, &mapRows, &pattern)
	if err == nil {
		sm := &DetailSeatMap{Rows: mapRows, Pattern: pattern}
		mrows, err := pool.Query(ctx, `SELECT label, "ticketClassId" FROM seat_map_seat WHERE "seatMapId" = $1`, mapID)
		if err != nil {
			return nil, err
		}
		for mrows.Next() {
			var s DetailSeat
			if err := mrows.Scan(&s.Label, &s.TicketClassID); err != nil {
				mrows.Close()
				return nil, err
			}
			sm.Seats = append(sm.Seats, s)
		}
		mrows.Close()
		if err := mrows.Err(); err != nil {
			return nil, err
		}
		d.SeatMap = sm
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	arows, err := pool.Query(ctx, `
		SELECT id, name, "priceKes"::text FROM addon
		WHERE "listingId" = $1 AND active = true ORDER BY "createdAt" ASC`, d.ID)
	if err != nil {
		return nil, err
	}
	defer arows.Close()
	for arows.Next() {
		var a DetailAddon
		if err := arows.Scan(&a.ID, &a.Name, &a.PriceKES); err != nil {
			return nil, err
		}
		d.Addons = append(d.Addons, a)
	}
	return &d, arows.Err()
}

type SeatRow struct {
	ID            string
	Label         string
	Status        string
	TicketClassID string
}

func ListScheduleSeats(ctx context.Context, pool *pgxpool.Pool, scheduleID string) ([]SeatRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, label, status::text, "ticketClassId"
		FROM seat WHERE "scheduleId" = $1
		ORDER BY label`, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SeatRow
	for rows.Next() {
		var s SeatRow
		if err := rows.Scan(&s.ID, &s.Label, &s.Status, &s.TicketClassID); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── booking ────────────────────────────────────────────────────────

type BookingLineInput struct {
	TicketClassID string
	// SeatID is set for a seated class (buyer picked a specific seat);
	// nil for a GA class, where Quantity tickets are issued unseated.
	SeatID   *string
	Quantity int
	// Optional per-ticket holder — falls back to the buyer at insert.
	HolderName   *string
	HolderMsisdn *string
}

type CreateBookingInput struct {
	ScheduleID   string
	BuyerPartyID *string
	BuyerName    string
	BuyerMsisdn  string
	BuyerEmail   *string
	// PaymentMethod is MPESA_STK (default when empty), CASH or VOUCHER.
	// CASH books straight to PAID with loyalty earned inline — the TS
	// createBooking parity for till/walk-in sales. VOUCHER debits a
	// GENERAL purpose card the same way.
	PaymentMethod string
	VoucherID     *string
	Lines         []BookingLineInput
}

type BookingError struct {
	Code    string // SCHEDULE_NOT_FOUND | SEAT_TAKEN | CAPACITY_EXCEEDED | EMPTY_BOOKING
	Message string
}

func (e *BookingError) Error() string { return e.Message }

// CreateBooking mirrors createBooking's transactional seat-claim / GA
// capacity check, without the installment branch (see this file's own
// header). Auto-captures a TicketCustomer by (orgId, msisdn), same as
// findOrCreateTicketCustomer.
func CreateBooking(ctx context.Context, pool *pgxpool.Pool, in CreateBookingInput) (bookingID, totalKES string, err error) {
	if len(in.Lines) == 0 {
		return "", "", &BookingError{"EMPTY_BOOKING", "A booking needs at least one ticket"}
	}

	var orgID string
	err = pool.QueryRow(ctx, `
		SELECT l."orgId" FROM listing_schedule ls
		JOIN listing l ON l.id = ls."listingId"
		WHERE ls.id = $1 AND ls.status = 'SCHEDULED'`, in.ScheduleID).Scan(&orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", &BookingError{"SCHEDULE_NOT_FOUND", "That departure/showtime is no longer available"}
	}
	if err != nil {
		return "", "", err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx)

	method := in.PaymentMethod
	if method == "" {
		method = "MPESA_STK"
	}
	if method == "VOUCHER" && (in.VoucherID == nil || *in.VoucherID == "") {
		return "", "", &BookingError{"VOUCHER_REQUIRED", "Choose a voucher to pay with"}
	}

	total := 0.0
	type ticketToIssue struct {
		ticketClassID string
		seatID        *string
		priceKES      float64
		holderName    string
		holderMsisdn  string
	}
	holderOf := func(name, msisdn *string) (string, string) {
		hn, hm := in.BuyerName, in.BuyerMsisdn
		if name != nil && *name != "" {
			hn = *name
		}
		if msisdn != nil && *msisdn != "" {
			hm = *msisdn
		}
		return hn, hm
	}
	var toIssue []ticketToIssue

	for _, line := range in.Lines {
		var priceKESText string
		var seated bool
		var capacity int
		err = tx.QueryRow(ctx, `
			SELECT "priceKes"::text, seated, capacity FROM ticket_class
			WHERE id = $1 AND "listingId" = (SELECT "listingId" FROM listing_schedule WHERE id = $2)
			FOR UPDATE`, line.TicketClassID, in.ScheduleID).Scan(&priceKESText, &seated, &capacity)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", &BookingError{"CAPACITY_EXCEEDED", "That ticket type is not available for this departure"}
		}
		if err != nil {
			return "", "", err
		}
		priceKES, err := strconv.ParseFloat(priceKESText, 64)
		if err != nil {
			return "", "", err
		}

		if seated {
			if line.SeatID == nil {
				return "", "", &BookingError{"SEAT_TAKEN", "Choose a seat for this ticket class"}
			}
			var claimed string
			err = tx.QueryRow(ctx, `
				UPDATE seat SET status = 'BOOKED'
				WHERE id = $1 AND "scheduleId" = $2 AND "ticketClassId" = $3 AND status = 'AVAILABLE'
				RETURNING id`, *line.SeatID, in.ScheduleID, line.TicketClassID).Scan(&claimed)
			if errors.Is(err, pgx.ErrNoRows) {
				return "", "", &BookingError{"SEAT_TAKEN", "That seat has just been taken — pick another"}
			}
			if err != nil {
				return "", "", err
			}
			total += priceKES
			hn, hm := holderOf(line.HolderName, line.HolderMsisdn)
			toIssue = append(toIssue, ticketToIssue{line.TicketClassID, line.SeatID, priceKES, hn, hm})
		} else {
			// GA capacity check: booked tickets for this class+schedule
			// (via any Ticket whose booking is on this schedule) plus
			// this request must not exceed capacity.
			var bookedCount int
			err = tx.QueryRow(ctx, `
				SELECT COUNT(*) FROM ticket t
				JOIN booking b ON b.id = t."bookingId"
				WHERE t."ticketClassId" = $1 AND b."scheduleId" = $2
				  AND b.status IN ('PAID', 'PARTIALLY_PAID', 'PENDING_PAYMENT')`,
				line.TicketClassID, in.ScheduleID).Scan(&bookedCount)
			if err != nil {
				return "", "", err
			}
			if bookedCount+line.Quantity > capacity {
				return "", "", &BookingError{"CAPACITY_EXCEEDED", "Not enough seats left for that ticket type"}
			}
			for i := 0; i < line.Quantity; i++ {
				total += priceKES
				hn, hm := holderOf(line.HolderName, line.HolderMsisdn)
				toIssue = append(toIssue, ticketToIssue{line.TicketClassID, nil, priceKES, hn, hm})
			}
		}
	}

	// Auto-capture the org-scoped loyalty identity, same natural key as
	// findOrCreateTicketCustomer.
	var ticketCustomerID string
	err = tx.QueryRow(ctx, `
		INSERT INTO ticket_customer (id, "orgId", msisdn, name, email, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
		ON CONFLICT ("orgId", msisdn) DO UPDATE SET "updatedAt" = now()
		RETURNING id`, orgID, in.BuyerMsisdn, in.BuyerName, in.BuyerEmail).Scan(&ticketCustomerID)
	if err != nil {
		return "", "", err
	}

	// method/status are code constants (never user input): MPESA_STK →
	// PENDING_PAYMENT, CASH/VOUCHER → PAID on commit with loyalty earned below.
	status := "PENDING_PAYMENT"
	paidKES := 0.0
	if method == "CASH" || method == "VOUCHER" {
		status = "PAID"
		paidKES = total
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO booking (
			id, "scheduleId", "buyerPartyId", "buyerName", "buyerMsisdn", "buyerEmail",
			"ticketCustomerId", status, "paymentMethod", "totalKes", "paidAt", "amountPaidKes", "voucherId", "createdAt"
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::"BookingStatus", $8::"BookingPaymentMethod", $9,
			CASE WHEN $7 = 'PAID' THEN now() ELSE NULL END, $10, $11, now()
		) RETURNING id`,
		in.ScheduleID, in.BuyerPartyID, in.BuyerName, in.BuyerMsisdn, in.BuyerEmail, ticketCustomerID, status, method, total, paidKES, in.VoucherID).
		Scan(&bookingID)
	if err != nil {
		return "", "", err
	}

	for _, t := range toIssue {
		code, err := generateTicketCode()
		if err != nil {
			return "", "", err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO ticket (id, "bookingId", "ticketClassId", "seatId", code, "holderName", "holderMsisdn", "priceKes", status, "createdAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'VALID', now())`,
			bookingID, t.ticketClassID, t.seatID, code, t.holderName, t.holderMsisdn, t.priceKES)
		if err != nil {
			return "", "", err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}

	// CASH is PAID on commit — earn loyalty now, mirroring TS
	// createBooking (M-Pesa earns later, at webhook confirm). VOUCHER
	// settles the same way after debiting the GENERAL card below.
	if method == "CASH" {
		_ = earnTicketLoyalty(ctx, pool, bookingID, ticketCustomerID, total)
	}
	if method == "VOUCHER" {
		if err := settleBookingVoucher(ctx, pool, bookingID, *in.VoucherID, ticketCustomerID, total); err != nil {
			_, _ = pool.Exec(ctx, `UPDATE booking SET status = 'CANCELLED' WHERE id = $1`, bookingID)
			if berr, ok := err.(*BookingError); ok {
				return "", "", berr
			}
			return "", "", &BookingError{"VOUCHER_FAILED", err.Error()}
		}
	}
	return bookingID, fmt.Sprintf("%.2f", total), nil
}

// settleBookingVoucher posts the merchant ledger for a PAID booking,
// debits the GENERAL voucher, and earns both legacy + unified loyalty.
// Idempotent per booking.
func settleBookingVoucher(ctx context.Context, pool *pgxpool.Pool, bookingID, voucherID, ticketCustomerID string, total float64) error {
	var orgEnterpriseParty, buyerParty string
	if err := pool.QueryRow(ctx, `
		SELECT e."partyId", COALESCE(bk."buyerPartyId"::text,'')
		FROM booking bk
		JOIN listing_schedule ls ON ls.id = bk."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		JOIN ticket_org o ON o.id = l."orgId"
		JOIN enterprise e ON e.id = o."enterpriseId"
		WHERE bk.id = $1`, bookingID).Scan(&orgEnterpriseParty, &buyerParty); err != nil {
		return err
	}
	settlement, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return err
	}
	revenue, err := ledger.EnsureAccount(ctx, pool, &orgEnterpriseParty, "SUSPENSE", "KES")
	if err != nil {
		return err
	}
	entryID, err := ledger.PostEntry(ctx, pool, "booking:"+bookingID, "Ticket booking voucher payment", "core-go:booking:"+bookingID,
		[]ledger.Posting{{AccountID: settlement, AmountKES: total}, {AccountID: revenue, AmountKES: -total}})
	if err != nil {
		return err
	}
	if err := SpendVoucher(ctx, pool, voucherID, "GENERAL", int(total*10+0.5), "booking:"+bookingID, entryID); err != nil {
		if _, ok := err.(*FleetError); ok {
			return &BookingError{"VOUCHER_FAILED", err.Error()}
		}
		return err
	}
	_, _ = pool.Exec(ctx, `UPDATE booking SET "journalEntryId" = $1 WHERE id = $2`, entryID, bookingID)
	_ = earnTicketLoyalty(ctx, pool, bookingID, ticketCustomerID, total)
	if buyerParty != "" {
		_ = earnUnifiedLoyaltyTicket(ctx, pool, buyerParty, total, "booking:"+bookingID)
	}
	return nil
}

func generateTicketCode() (string, error) {
	// Same unambiguous alphabet + unbiased sampling as every other Esoko
	// short code (see fleetqr). Space is 31^10 ≈ 8×10^14 and ticket.code
	// is @unique, so collisions are not worth a retry loop — a clash
	// would fail the whole booking transaction, which is vanishingly
	// unlikely and loud when it ever happens.
	return "TKT-" + fleetqr.RandomSegment(10), nil
}

func AttachBookingCheckoutRequestID(ctx context.Context, pool *pgxpool.Pool, bookingID, checkoutRequestID string) error {
	_, err := pool.Exec(ctx, `UPDATE booking SET "mpesaCheckoutRequestId" = $1 WHERE id = $2`, checkoutRequestID, bookingID)
	return err
}

// ErrBookingNotFound — same "fall through to the next domain" contract
// as dbx.ErrOrderNotFound, for the shared webhook dispatcher.
var ErrBookingNotFound = errors.New("no booking for that checkout request")

// ConfirmBookingPaymentByCheckoutID mirrors confirmBookingPayment's
// plain (non-installment) path: idempotent on checkoutRequestId, posts
// to the ledger, earns ticket loyalty if the org has it enabled.
//
// AccountKind has no TICKET_REVENUE-equivalent value yet (only
// STORE_REVENUE/WAREHOUSE_REVENUE exist for commerce) — this posts
// against SUSPENSE, keyed to the ticket org's enterprise party, as an
// honest placeholder rather than inventing a schema value core-go can't
// migrate on its own. Flagged, not silent — see the plan this shipped
// from.
func ConfirmBookingPaymentByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID string, loyaltyEnabled bool) error {
	var bookingID, status, totalKESText, ticketCustomerID, buyerParty string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "totalKes"::text, COALESCE("ticketCustomerId"::text, ''), COALESCE("buyerPartyId"::text, '')
		FROM booking WHERE "mpesaCheckoutRequestId" = $1`, checkoutRequestID).
		Scan(&bookingID, &status, &totalKESText, &ticketCustomerID, &buyerParty)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrBookingNotFound
	}
	if err != nil {
		return err
	}
	if status != "PENDING_PAYMENT" {
		return nil // already confirmed — replayed callback
	}

	totalKES, err := strconv.ParseFloat(totalKESText, 64)
	if err != nil {
		return err
	}

	var orgEnterprisePartyID string
	err = pool.QueryRow(ctx, `
		SELECT e."partyId"
		FROM booking bk
		JOIN listing_schedule ls ON ls.id = bk."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		JOIN ticket_org o ON o.id = l."orgId"
		JOIN enterprise e ON e.id = o."enterpriseId"
		WHERE bk.id = $1`, bookingID).Scan(&orgEnterprisePartyID)
	if err != nil {
		return err
	}

	settlementAcct, err := ledger.EnsureAccount(ctx, pool, nil, "SETTLEMENT", "KES")
	if err != nil {
		return err
	}
	revenueAcct, err := ledger.EnsureAccount(ctx, pool, &orgEnterprisePartyID, "SUSPENSE", "KES")
	if err != nil {
		return err
	}
	journalEntryID, err := ledger.PostEntry(ctx, pool,
		"booking:"+bookingID, "Ticket booking payment", "core-go:booking:"+bookingID,
		[]ledger.Posting{{AccountID: settlementAcct, AmountKES: totalKES}, {AccountID: revenueAcct, AmountKES: -totalKES}})
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		UPDATE booking SET status = 'PAID', "paidAt" = now(), "amountPaidKes" = "totalKes", "journalEntryId" = $1
		WHERE id = $2`, journalEntryID, bookingID)
	if err != nil {
		return err
	}

	if buyerParty != "" {
		_ = loyalty.EarnForSpend(ctx, pool, buyerParty, totalKES, "booking:"+bookingID, loyaltyEnabled)
	}
	if ticketCustomerID == "" {
		return nil
	}
	return earnTicketLoyalty(ctx, pool, bookingID, ticketCustomerID, totalKES)
}

func earnTicketLoyalty(ctx context.Context, pool *pgxpool.Pool, bookingID, ticketCustomerID string, totalKES float64) error {
	var orgID string
	if err := pool.QueryRow(ctx, `
		SELECT l."orgId" FROM booking bk
		JOIN listing_schedule ls ON ls.id = bk."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		WHERE bk.id = $1`, bookingID).Scan(&orgID); err != nil {
		return err
	}
	var loyaltyEnabled bool
	var loyaltyPerKes int
	if err := pool.QueryRow(ctx, `
		SELECT "loyaltyEnabled", "loyaltyPerKes" FROM ticket_org WHERE id = $1`, orgID).
		Scan(&loyaltyEnabled, &loyaltyPerKes); err != nil {
		return err
	}
	if !loyaltyEnabled {
		return nil
	}
	points := int(totalKES) * loyaltyPerKes
	_, err := pool.Exec(ctx, `
		INSERT INTO ticket_loyalty_entry (id, "customerId", points, kind, "bookingId", "createdAt")
		VALUES (gen_random_uuid(), $1, $2, 'EARN', $3, now())`, ticketCustomerID, points, bookingID)
	return err
}

type BookingStatusRow struct {
	ID           string
	ListingTitle string
	Status       string
	TotalKES     string
	CreatedAt    string
}

func GetBooking(ctx context.Context, pool *pgxpool.Pool, bookingID string) (*BookingStatusRow, error) {
	var b BookingStatusRow
	err := pool.QueryRow(ctx, `
		SELECT bk.id, l.title, bk.status::text, bk."totalKes"::text, bk."createdAt"::text
		FROM booking bk
		JOIN listing_schedule ls ON ls.id = bk."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		WHERE bk.id = $1`, bookingID).
		Scan(&b.ID, &b.ListingTitle, &b.Status, &b.TotalKES, &b.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func ListBookingsForParty(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]BookingStatusRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT bk.id, l.title, bk.status::text, bk."totalKes"::text, bk."createdAt"::text
		FROM booking bk
		JOIN listing_schedule ls ON ls.id = bk."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		WHERE bk."buyerPartyId" = $1
		ORDER BY bk."createdAt" DESC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BookingStatusRow
	for rows.Next() {
		var b BookingStatusRow
		if err := rows.Scan(&b.ID, &b.ListingTitle, &b.Status, &b.TotalKES, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// TicketRow — one issued ticket, for "my tickets" (QR code is `Code`).
type TicketRow struct {
	ID        string
	Code      string
	ClassName string
	SeatLabel *string
	PriceKES  string
	Status    string
	BookingID string
}

func ListTicketsForBooking(ctx context.Context, pool *pgxpool.Pool, bookingID string) ([]TicketRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT t.id, t.code, tc.name, s.label, t."priceKes"::text, t.status::text, t."bookingId"
		FROM ticket t
		JOIN ticket_class tc ON tc.id = t."ticketClassId"
		LEFT JOIN seat s ON s.id = t."seatId"
		WHERE t."bookingId" = $1`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TicketRow
	for rows.Next() {
		var t TicketRow
		if err := rows.Scan(&t.ID, &t.Code, &t.ClassName, &t.SeatLabel, &t.PriceKES, &t.Status, &t.BookingID); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func ListTicketsForParty(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]TicketRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT t.id, t.code, tc.name, s.label, t."priceKes"::text, t.status::text, t."bookingId"
		FROM ticket t
		JOIN ticket_class tc ON tc.id = t."ticketClassId"
		LEFT JOIN seat s ON s.id = t."seatId"
		JOIN booking bk ON bk.id = t."bookingId"
		WHERE bk."buyerPartyId" = $1
		ORDER BY t."createdAt" DESC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TicketRow
	for rows.Next() {
		var t TicketRow
		if err := rows.Scan(&t.ID, &t.Code, &t.ClassName, &t.SeatLabel, &t.PriceKES, &t.Status, &t.BookingID); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
