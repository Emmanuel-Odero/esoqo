package seed

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type demoProduct struct {
	name, category, unit string
	priceKES             float64
	stockQty             *int // nil = untracked / service
	availableOnOrder     bool
}

// fulfilmentSpec is a Store's checkout-time fulfilment option — see
// FulfilmentOption in schema.prisma. kind is "PICKUP" or "DELIVERY".
type fulfilmentSpec struct {
	kind, label string
	feeKES      float64
}

type demoStore struct {
	name, slug, tagline, primaryCategory string
	// neighborhood/lat/lng back the "click & collect" search
	// (dbx.ListStoresNearby) — see this file's own header for why every
	// demo store now carries them, not just the new supermarkets.
	neighborhood string
	lat, lng     float64
	codEnabled   bool
	fulfilment   []fulfilmentSpec
	products     []demoProduct
}

func intPtr(i int) *int { return &i }

// freshmartCatalog is shared across every "Demo Freshmart" branch —
// a real chain sells the same core SKUs at every location, so one
// grocery/household catalog reused across stores reads more honest
// than four unrelated inventories, and is the realistic seed data the
// "shop from home, collect once ready" scenario needs to actually
// exercise: staples, dairy, household, toiletries — a genuine weekly
// grocery run, not a token handful of items.
var freshmartCatalog = []demoProduct{
	{"Maize flour, 2kg", "Groceries", "pc", 180, intPtr(300), false},
	{"Sugar, 2kg", "Groceries", "pc", 280, intPtr(250), false},
	{"Cooking oil, 2L", "Groceries", "pc", 480, intPtr(180), false},
	{"Rice, pishori 2kg", "Groceries", "pc", 340, intPtr(200), false},
	{"Milk, fresh 500ml", "Dairy", "pc", 65, intPtr(400), false},
	{"Bread, sliced", "Bakery", "loaf", 65, intPtr(150), false},
	{"Eggs, tray of 30", "Dairy", "tray", 480, intPtr(100), false},
	{"Toilet paper, 4-pack", "Household", "pack", 220, intPtr(220), false},
	{"Dish soap, 500ml", "Household", "pc", 150, intPtr(180), false},
	{"Laundry detergent, 1kg", "Household", "pc", 320, intPtr(140), false},
	{"Bathing soap, 3-pack", "Toiletries", "pack", 180, intPtr(200), false},
	{"Toothpaste", "Toiletries", "pc", 150, intPtr(220), false},
	{"Sanitary pads", "Toiletries", "pack", 120, intPtr(160), false},
	{"Bottled water, 5L", "Beverages", "pc", 150, intPtr(250), false},
	{"Assorted fruit basket", "Fresh produce", "basket", 600, intPtr(60), false},
}

var freshmartFulfilment = []fulfilmentSpec{
	{"PICKUP", "Pickup in store", 0},
	{"DELIVERY", "Boda delivery, same day", 150},
}

// demoStores is new content, not a port — neither seed.ts nor
// seed-demo.ts seeded any Store/Product data (see the plan's own note),
// so this is what gives the mobile app's Shopping tab something real to
// browse. One store is deliberately service-shaped (untracked stock,
// sell-by-order) per the plan's "services are Products" decision. The
// four "Demo Freshmart" branches back the "click & collect" scenario:
// real (approximate) Nairobi neighbourhood coordinates, a genuine
// grocery catalogue, and both PICKUP and DELIVERY fulfilment — see
// ensureDemoPickupOrders below for demo orders walking through every
// pickup state.
var demoStores = []demoStore{
	{
		name: "Demo Wakulima Greens", slug: "demo-wakulima-greens",
		tagline: "Fresh from the farm, daily", primaryCategory: "Fresh produce",
		neighborhood: "Wakulima Market, Nairobi CBD", lat: -1.2850, lng: 36.8250,
		codEnabled: true, fulfilment: []fulfilmentSpec{{"PICKUP", "Pickup at the stall", 0}},
		products: []demoProduct{
			{"Sukuma wiki", "Vegetables", "bunch", 20, intPtr(200), false},
			{"Tomatoes", "Vegetables", "crate", 1800, intPtr(30), false},
			{"Avocado, Hass", "Fruit", "kg", 120, intPtr(150), false},
			{"Irish potatoes", "Vegetables", "bag 50kg", 3200, intPtr(15), false},
		},
	},
	{
		name: "Demo Kitale Hardware", slug: "demo-kitale-hardware",
		tagline: "Everything for the site, in stock", primaryCategory: "Hardware & construction",
		neighborhood: "Kitale Town, Trans Nzoia", lat: 1.0157, lng: 35.0062,
		codEnabled: true, fulfilment: []fulfilmentSpec{{"PICKUP", "Pickup at the yard", 0}},
		products: []demoProduct{
			{"Cement, 50kg", "Building materials", "bag", 780, intPtr(120), false},
			{"DAP fertiliser", "Agriculture", "bag 50kg", 3600, intPtr(40), false},
			{"Wheelbarrow", "Tools", "pc", 4500, intPtr(8), false},
		},
	},
	{
		name: "Demo Nairobi Tailors", slug: "demo-nairobi-tailors",
		tagline: "Made to measure, delivered", primaryCategory: "Services",
		neighborhood: "Nairobi CBD", lat: -1.2864, lng: 36.8172,
		codEnabled: false, fulfilment: []fulfilmentSpec{{"PICKUP", "Collect from the workshop", 0}},
		products: []demoProduct{
			// Untracked stock + availableOnOrder=true — a service, not
			// physical goods, per the plan's "services are Products" call.
			{"Custom suit tailoring", "Services", "order", 8000, nil, true},
			{"Dress alteration", "Services", "order", 800, nil, true},
			{"School uniform set", "Services", "set", 1500, intPtr(25), false},
		},
	},
	{
		name: "Demo Mama Mboga Mitumba", slug: "demo-mama-mboga-mitumba",
		tagline: "Quality secondhand, sorted by size", primaryCategory: "Clothing",
		neighborhood: "Gikomba, Nairobi", lat: -1.2833, lng: 36.8283,
		codEnabled: true, fulfilment: []fulfilmentSpec{{"PICKUP", "Pickup at the market", 0}},
		products: []demoProduct{
			{"Mitumba bale, grade A", "Clothing", "bale", 9500, intPtr(6), false},
			{"Men's shirts, assorted", "Clothing", "pc", 350, intPtr(80), false},
			{"Children's wear, assorted", "Clothing", "pc", 200, intPtr(100), false},
		},
	},
	{
		name: "Demo Freshmart Kilimani", slug: "demo-freshmart-kilimani",
		tagline: "Your weekly shop, ready when you are", primaryCategory: "Supermarket",
		neighborhood: "Kilimani, Nairobi", lat: -1.2921, lng: 36.7820,
		codEnabled: true, fulfilment: freshmartFulfilment, products: freshmartCatalog,
	},
	{
		name: "Demo Freshmart Westlands", slug: "demo-freshmart-westlands",
		tagline: "Your weekly shop, ready when you are", primaryCategory: "Supermarket",
		neighborhood: "Westlands, Nairobi", lat: -1.2673, lng: 36.8065,
		codEnabled: true, fulfilment: freshmartFulfilment, products: freshmartCatalog,
	},
	{
		name: "Demo Freshmart Lavington", slug: "demo-freshmart-lavington",
		tagline: "Your weekly shop, ready when you are", primaryCategory: "Supermarket",
		neighborhood: "Lavington, Nairobi", lat: -1.2789, lng: 36.7669,
		codEnabled: true, fulfilment: freshmartFulfilment, products: freshmartCatalog,
	},
	{
		name: "Demo Freshmart South B", slug: "demo-freshmart-south-b",
		tagline: "Your weekly shop, ready when you are", primaryCategory: "Supermarket",
		neighborhood: "South B, Nairobi", lat: -1.3103, lng: 36.8362,
		codEnabled: true, fulfilment: freshmartFulfilment, products: freshmartCatalog,
	},
}

// SeedDemoStores seeds a handful of realistic stores across categories
// (produce, hardware, a service-only tailor, secondhand clothing, and
// four supermarket branches) so the Shopping tab has real content —
// see this file's own header for why it's new content rather than a
// TS port. Finishes by seeding demo pickup orders in every state of
// the click-and-collect lifecycle against one of the supermarkets.
func SeedDemoStores(ctx context.Context, pool *pgxpool.Pool) error {
	ownerPartyID, err := EnsurePersonParty(ctx, pool, "+254700300300", "Demo Merchant", "Demo Merchant", "047", "300300")
	if err != nil {
		return fmt.Errorf("merchant: %w", err)
	}
	enterpriseID, err := EnsureEnterprise(ctx, pool, ownerPartyID, "retail")
	if err != nil {
		return fmt.Errorf("merchant enterprise: %w", err)
	}

	storeIDBySlug := make(map[string]string, len(demoStores))
	for _, st := range demoStores {
		storeID, err := ensureStore(ctx, pool, enterpriseID, st)
		if err != nil {
			return fmt.Errorf("store %s: %w", st.name, err)
		}
		storeIDBySlug[st.slug] = storeID
		for _, p := range st.products {
			if err := ensureProduct(ctx, pool, storeID, p); err != nil {
				return fmt.Errorf("product %s at %s: %w", p.name, st.name, err)
			}
		}
		for _, f := range st.fulfilment {
			if err := ensureFulfilmentOption(ctx, pool, storeID, f); err != nil {
				return fmt.Errorf("fulfilment %s at %s: %w", f.label, st.name, err)
			}
		}
	}

	if err := ensureDemoPickupOrders(ctx, pool, storeIDBySlug["demo-freshmart-kilimani"]); err != nil {
		return fmt.Errorf("demo pickup orders: %w", err)
	}

	fmt.Printf("  stores: %d, merchant login +254700300300 (PIN 300300)\n", len(demoStores))
	fmt.Println("  pickup demo: Demo Freshmart Kilimani has orders in every click-and-collect state for +254700200200 (PIN 200200)")
	return nil
}

func ensureStore(ctx context.Context, pool *pgxpool.Pool, enterpriseID string, st demoStore) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO store (id, "enterpriseId", name, slug, status, "codEnabled", "loyaltyEnabled", "loyaltyPerKes",
			tagline, "primaryCategory", neighborhood, latitude, longitude, currency, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', $4, true, 1, $5, $6, $7, $8, $9, 'KES', now(), now())
		ON CONFLICT (slug) DO UPDATE SET
			name = $2, status = 'ACTIVE', "codEnabled" = $4, neighborhood = $7, latitude = $8, longitude = $9
		RETURNING id`, enterpriseID, st.name, st.slug, st.codEnabled, st.tagline, st.primaryCategory,
		st.neighborhood, st.lat, st.lng).Scan(&id)
	return id, err
}

func ensureProduct(ctx context.Context, pool *pgxpool.Pool, storeID string, p demoProduct) error {
	var existing string
	err := pool.QueryRow(ctx, `SELECT id FROM product WHERE "storeId" = $1 AND name = $2`, storeID, p.name).Scan(&existing)
	if err == nil {
		_, err = pool.Exec(ctx, `
			UPDATE product SET "priceKes" = $1, "stockQty" = $2, "availableOnOrder" = $3, status = 'ACTIVE', "updatedAt" = now()
			WHERE id = $4`, p.priceKES, p.stockQty, p.availableOnOrder, existing)
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO product (id, "storeId", name, category, "priceKes", "stockQty", "availableOnOrder", unit, status, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'ACTIVE', now(), now())`,
		storeID, p.name, p.category, p.priceKES, p.stockQty, p.availableOnOrder, p.unit)
	return err
}

func ensureFulfilmentOption(ctx context.Context, pool *pgxpool.Pool, storeID string, f fulfilmentSpec) error {
	var existing string
	err := pool.QueryRow(ctx, `SELECT id FROM fulfilment_option WHERE "storeId" = $1 AND kind = $2 AND label = $3`,
		storeID, f.kind, f.label).Scan(&existing)
	if err == nil {
		_, err = pool.Exec(ctx, `UPDATE fulfilment_option SET "feeKes" = $1, active = true WHERE id = $2`, f.feeKES, existing)
		return err
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO fulfilment_option (id, "storeId", kind, label, "feeKes", active)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, true)`, storeID, f.kind, f.label, f.feeKES)
	return err
}

// demoPickupOrder describes one seeded order in the click-and-collect
// lifecycle. Deliberately direct SQL, not dbx.CreateStoreOrder — this
// is offline seed data (no real stock contention to validate against),
// same approach demo_ticketing.go takes for its bookings/tickets. No
// ledger postings either, for the same reason those seeded
// bookings/tickets don't post to the ledger: seed data models the
// buyer-visible state directly rather than replaying every side effect
// of the live checkout path.
type demoPickupOrder struct {
	tag        string // matched against collectionNotes as the idempotency key
	status     string
	pickupCode *string
	paid       bool
	ready      bool
	collected  bool
}

var demoPickupOrders = []demoPickupOrder{
	{tag: "SEED:pending", status: "PENDING_PAYMENT"},
	{tag: "SEED:paid", status: "PAID", pickupCode: strPtr("PKP-DEMO01"), paid: true},
	{tag: "SEED:ready", status: "READY_FOR_PICKUP", pickupCode: strPtr("PKP-DEMO02"), paid: true, ready: true},
	{tag: "SEED:fulfilled", status: "FULFILLED", pickupCode: strPtr("PKP-DEMO03"), paid: true, ready: true, collected: true},
}

// ensureDemoPickupOrders seeds one order per demoPickupOrders entry at
// storeID for the existing demo buyer (+254700200200 — see
// demo_ticketing.go, seeded before this runs), each with two Freshmart
// lines, so the mobile app's order history/detail screens have a real
// example of every stage: placed, paid (code issued but store still
// packing), ready for pickup (code redeemable), and already collected.
func ensureDemoPickupOrders(ctx context.Context, pool *pgxpool.Pool, storeID string) error {
	if storeID == "" {
		return fmt.Errorf("demo-freshmart-kilimani store not found")
	}

	buyerPartyID, err := EnsurePersonParty(ctx, pool, "+254700200200", "Demo Customer", "Demo Customer", "047", "200200")
	if err != nil {
		return fmt.Errorf("buyer: %w", err)
	}

	var customerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO store_customer (id, "storeId", msisdn, name, "partyId", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, '+254700200200', 'Demo Customer', $2, now(), now())
		ON CONFLICT ("storeId", msisdn) DO UPDATE SET "updatedAt" = now()
		RETURNING id`, storeID, buyerPartyID).Scan(&customerID); err != nil {
		return fmt.Errorf("store customer: %w", err)
	}

	var pickupOptionID string
	if err := pool.QueryRow(ctx, `
		SELECT id FROM fulfilment_option WHERE "storeId" = $1 AND kind = 'PICKUP' LIMIT 1`, storeID).
		Scan(&pickupOptionID); err != nil {
		return fmt.Errorf("pickup option: %w", err)
	}

	type line struct {
		productID string
		priceKES  float64
		quantity  int
	}
	lineFor := func(name string, quantity int) (line, error) {
		var id string
		var price float64
		if err := pool.QueryRow(ctx, `SELECT id, "priceKes"::float8 FROM product WHERE "storeId" = $1 AND name = $2`,
			storeID, name).Scan(&id, &price); err != nil {
			return line{}, fmt.Errorf("product %s: %w", name, err)
		}
		return line{id, price, quantity}, nil
	}
	milk, err := lineFor("Milk, fresh 500ml", 4)
	if err != nil {
		return err
	}
	riceLine, err := lineFor("Rice, pishori 2kg", 2)
	if err != nil {
		return err
	}
	lines := []line{milk, riceLine}
	total := 0.0
	for _, l := range lines {
		total += l.priceKES * float64(l.quantity)
	}
	total += 0 // pickup fee is 0 for Freshmart's "Pickup in store" option

	for _, o := range demoPickupOrders {
		var orderID string
		err := pool.QueryRow(ctx, `
			SELECT id FROM store_order WHERE "storeId" = $1 AND "buyerMsisdn" = '+254700200200' AND "collectionNotes" = $2`,
			storeID, o.tag).Scan(&orderID)
		if err == nil {
			_, err = pool.Exec(ctx, `
				UPDATE store_order SET status = $1::"StoreOrderStatus", "pickupCode" = $2,
					"paidAt" = CASE WHEN $3 THEN COALESCE("paidAt", now()) ELSE NULL END,
					"readyAt" = CASE WHEN $4 THEN COALESCE("readyAt", now()) ELSE NULL END,
					"collectedAt" = CASE WHEN $5 THEN COALESCE("collectedAt", now()) ELSE NULL END
				WHERE id = $6`, o.status, o.pickupCode, o.paid, o.ready, o.collected, orderID)
			if err != nil {
				return fmt.Errorf("update seed order %s: %w", o.tag, err)
			}
			continue
		}

		if err := pool.QueryRow(ctx, `
			INSERT INTO store_order (
				id, "storeId", "buyerPartyId", "buyerName", "buyerMsisdn", status, "paymentMethod",
				"totalKes", "deliveryOptionId", "deliveryFeeKes", "collectionNotes", "customerId",
				"pickupCode", "paidAt", "readyAt", "collectedAt", "createdAt"
			) VALUES (
				gen_random_uuid(), $1, $2, 'Demo Customer', '+254700200200', $3::"StoreOrderStatus", 'MPESA_STK',
				$4, $5, 0, $6, $7,
				$8,
				CASE WHEN $9 THEN now() ELSE NULL END,
				CASE WHEN $10 THEN now() ELSE NULL END,
				CASE WHEN $11 THEN now() ELSE NULL END,
				now()
			) RETURNING id`,
			storeID, buyerPartyID, o.status, total, pickupOptionID, o.tag, customerID,
			o.pickupCode, o.paid, o.ready, o.collected).Scan(&orderID); err != nil {
			return fmt.Errorf("insert seed order %s: %w", o.tag, err)
		}
		for _, l := range lines {
			if _, err := pool.Exec(ctx, `
				INSERT INTO store_order_item (id, "orderId", "productId", quantity, "unitPriceKes")
				VALUES (gen_random_uuid(), $1, $2, $3, $4)`, orderID, l.productID, l.quantity, l.priceKES); err != nil {
				return fmt.Errorf("insert seed order item: %w", err)
			}
		}
	}
	return nil
}
