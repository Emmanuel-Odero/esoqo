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

type demoStore struct {
	name, slug, tagline, primaryCategory string
	codEnabled                           bool
	products                             []demoProduct
}

func intPtr(i int) *int { return &i }

// demoStores is new content, not a port — neither seed.ts nor
// seed-demo.ts seeded any Store/Product data (see the plan's own note),
// so this is what gives the mobile app's Shopping tab something real to
// browse. One store is deliberately service-shaped (untracked stock,
// sell-by-order) per the plan's "services are Products" decision.
var demoStores = []demoStore{
	{
		name: "Demo Wakulima Greens", slug: "demo-wakulima-greens",
		tagline: "Fresh from the farm, daily", primaryCategory: "Fresh produce", codEnabled: true,
		products: []demoProduct{
			{"Sukuma wiki", "Vegetables", "bunch", 20, intPtr(200), false},
			{"Tomatoes", "Vegetables", "crate", 1800, intPtr(30), false},
			{"Avocado, Hass", "Fruit", "kg", 120, intPtr(150), false},
			{"Irish potatoes", "Vegetables", "bag 50kg", 3200, intPtr(15), false},
		},
	},
	{
		name: "Demo Kitale Hardware", slug: "demo-kitale-hardware",
		tagline: "Everything for the site, in stock", primaryCategory: "Hardware & construction", codEnabled: true,
		products: []demoProduct{
			{"Cement, 50kg", "Building materials", "bag", 780, intPtr(120), false},
			{"DAP fertiliser", "Agriculture", "bag 50kg", 3600, intPtr(40), false},
			{"Wheelbarrow", "Tools", "pc", 4500, intPtr(8), false},
		},
	},
	{
		name: "Demo Nairobi Tailors", slug: "demo-nairobi-tailors",
		tagline: "Made to measure, delivered", primaryCategory: "Services", codEnabled: false,
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
		tagline: "Quality secondhand, sorted by size", primaryCategory: "Clothing", codEnabled: true,
		products: []demoProduct{
			{"Mitumba bale, grade A", "Clothing", "bale", 9500, intPtr(6), false},
			{"Men's shirts, assorted", "Clothing", "pc", 350, intPtr(80), false},
			{"Children's wear, assorted", "Clothing", "pc", 200, intPtr(100), false},
		},
	},
}

// SeedDemoStores seeds a handful of realistic stores across categories
// (produce, hardware, a service-only tailor, secondhand clothing) so
// the Shopping tab has real content — see this file's own header for
// why it's new content rather than a TS port.
func SeedDemoStores(ctx context.Context, pool *pgxpool.Pool) error {
	ownerPartyID, err := EnsurePersonParty(ctx, pool, "+254700300300", "Demo Merchant", "Demo Merchant", "047", "300300")
	if err != nil {
		return fmt.Errorf("merchant: %w", err)
	}
	enterpriseID, err := EnsureEnterprise(ctx, pool, ownerPartyID, "retail")
	if err != nil {
		return fmt.Errorf("merchant enterprise: %w", err)
	}

	for _, st := range demoStores {
		storeID, err := ensureStore(ctx, pool, enterpriseID, st)
		if err != nil {
			return fmt.Errorf("store %s: %w", st.name, err)
		}
		for _, p := range st.products {
			if err := ensureProduct(ctx, pool, storeID, p); err != nil {
				return fmt.Errorf("product %s at %s: %w", p.name, st.name, err)
			}
		}
	}

	fmt.Printf("  stores: %d, merchant login +254700300300 (PIN 300300)\n", len(demoStores))
	return nil
}

func ensureStore(ctx context.Context, pool *pgxpool.Pool, enterpriseID string, st demoStore) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO store (id, "enterpriseId", name, slug, status, "codEnabled", "loyaltyEnabled", "loyaltyPerKes",
			tagline, "primaryCategory", currency, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', $4, true, 1, $5, $6, 'KES', now(), now())
		ON CONFLICT (slug) DO UPDATE SET name = $2, status = 'ACTIVE', "codEnabled" = $4
		RETURNING id`, enterpriseID, st.name, st.slug, st.codEnabled, st.tagline, st.primaryCategory).Scan(&id)
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
