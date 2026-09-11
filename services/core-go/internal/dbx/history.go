package dbx

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// HistoryItem is one row of a person's own timeline — a store order or a
// ticket booking, whichever schema.prisma model matches. Deliberately
// no "status" enum shared between the two; Kind tells the client which
// domain's status vocabulary Status is drawn from (StoreOrderStatus vs
// BookingStatus).
type HistoryItem struct {
	Kind       string // "order" | "booking"
	ID         string
	Title      string
	Status     string
	TotalKES   string
	OccurredAt time.Time
}

// GetHistory unions StoreOrder and Booking for a person, newest first —
// derived on every call, same as everywhere else in this schema that
// refuses to cache a total (see the ledger's own "balances are always
// summed, never stored" rule).
func GetHistory(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]HistoryItem, error) {
	orders, err := listOrderHistory(ctx, pool, partyID)
	if err != nil {
		return nil, err
	}
	bookings, err := listBookingHistory(ctx, pool, partyID)
	if err != nil {
		return nil, err
	}

	items := append(orders, bookings...)
	// Simple insertion sort by OccurredAt desc — history lists here are
	// small (one person's own activity), not worth pulling in sort.Slice
	// ceremony for.
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].OccurredAt.After(items[j-1].OccurredAt); j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
	return items, nil
}

func listOrderHistory(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]HistoryItem, error) {
	rows, err := pool.Query(ctx, `
		SELECT so.id, s.name, so.status::text, so."totalKes"::text, so."createdAt"
		FROM store_order so
		JOIN store s ON s.id = so."storeId"
		WHERE so."buyerPartyId" = $1
		ORDER BY so."createdAt" DESC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []HistoryItem
	for rows.Next() {
		var it HistoryItem
		var storeName string
		if err := rows.Scan(&it.ID, &storeName, &it.Status, &it.TotalKES, &it.OccurredAt); err != nil {
			return nil, err
		}
		it.Kind = "order"
		it.Title = "Order — " + storeName
		items = append(items, it)
	}
	return items, rows.Err()
}

func listBookingHistory(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]HistoryItem, error) {
	rows, err := pool.Query(ctx, `
		SELECT b.id, l.title, b.status::text, b."totalKes"::text, b."createdAt"
		FROM booking b
		JOIN listing_schedule ls ON ls.id = b."scheduleId"
		JOIN listing l ON l.id = ls."listingId"
		WHERE b."buyerPartyId" = $1
		ORDER BY b."createdAt" DESC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []HistoryItem
	for rows.Next() {
		var it HistoryItem
		var listingTitle string
		if err := rows.Scan(&it.ID, &listingTitle, &it.Status, &it.TotalKES, &it.OccurredAt); err != nil {
			return nil, err
		}
		it.Kind = "booking"
		it.Title = "Booking — " + listingTitle
		items = append(items, it)
	}
	return items, rows.Err()
}

// Points — derived sum of LoyaltyEntry (store) and TicketLoyaltyEntry
// (ticketing), same "never stored" rule as GetHistory. Store customers
// are matched by partyId when the buyer was signed in, msisdn otherwise
// (guest checkout auto-captures a StoreCustomer by phone — see
// createStoreOrder); TicketCustomer has no partyId column at all, so
// that side matches by msisdn only.
type Points struct {
	StorePoints  int
	TicketPoints int
}

func (p Points) Total() int { return p.StorePoints + p.TicketPoints }

func GetPoints(ctx context.Context, pool *pgxpool.Pool, partyID, msisdn string) (Points, error) {
	var pts Points
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(le.points), 0)
		FROM loyalty_entry le
		JOIN store_customer sc ON sc.id = le."customerId"
		WHERE sc."partyId" = $1 OR sc.msisdn = $2`, partyID, msisdn).Scan(&pts.StorePoints)
	if err != nil {
		return pts, err
	}

	err = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(tle.points), 0)
		FROM ticket_loyalty_entry tle
		JOIN ticket_customer tc ON tc.id = tle."customerId"
		WHERE tc.msisdn = $1`, msisdn).Scan(&pts.TicketPoints)
	return pts, err
}
