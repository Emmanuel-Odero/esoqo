// Package seed replaces packages/db/prisma/seed.ts and seed-demo.ts —
// see docs/adr/0005-mobile-api-in-go.md and the plan this shipped from.
// Every function here is idempotent (upsert-by-natural-key), same
// promise the TS scripts made, so `go run ./cmd/seed` is safe to re-run.
package seed

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/authsvc"
)

type countyRow struct {
	code, name                  string
	hasFieldOfficer, pricesLive bool
	population                  string
}

var counties = []countyRow{
	{"047", "Nairobi", true, true, "4.4M"},
	{"023", "Turkana", true, true, "1.0M"},
	{"028", "Elgeyo Marakwet", true, true, "0.5M"},
	{"024", "West Pokot", true, true, "0.7M"},
	{"027", "Uasin Gishu", true, true, "1.2M"},
	{"022", "Kiambu", true, true, "2.4M"},
	{"032", "Nakuru", true, true, "2.2M"},
	{"026", "Trans Nzoia", true, true, "1.0M"},
	{"016", "Machakos", false, false, "1.4M"},
	{"042", "Kisumu", false, false, "1.2M"},
	{"001", "Mombasa", false, false, "1.2M"},
}

type issuerRow struct {
	name, shortName, kind string
	allowedClaims         []string
}

var issuers = []issuerRow{
	{"Ministry of Labour & Social Protection", "MoL", "MINISTRY", []string{"GROUP_REGISTERED"}},
	{"Business Registration Service", "BRS", "AGENCY", []string{"BUSINESS_REGISTERED"}},
	{"Kenya Revenue Authority", "KRA", "AGENCY", []string{"KRA_PIN", "ETIMS_ACTIVE"}},
	{"Judiciary Mediation Directorate", "Judiciary", "JUDICIARY", []string{"MEDIATION_TRAINED"}},
	{"Nairobi City County", "Nairobi County", "COUNTY", []string{"SINGLE_BUSINESS_PERMIT", "FOOD_HANDLER", "HEALTH_CLEARANCE"}},
	{"Child & Elder Care Foundation", "CECF", "NGO", []string{"FIELD_VISIT", "MEDIATION_TRAINED", "ORG_PAGE_VERIFIED"}},
}

type marketRow struct {
	name, countyCode, days string
	reporting              bool
}

var markets = []marketRow{
	{"Wakulima", "047", "Daily", true}, {"Gikomba", "047", "Daily", true}, {"Marikiti", "047", "Daily", true},
	{"Lodwar", "023", "Mon & Thu", true}, {"Kakuma", "023", "Wed", false},
	{"Iten", "028", "Tue & Sat", true}, {"Kapsowar", "028", "Fri", true},
	{"Kapenguria", "024", "Mon & Thu", true},
	{"Eldoret", "027", "Daily", true}, {"Limuru", "022", "Tue & Fri", true}, {"Thika", "022", "Daily", true},
	{"Nakuru Wakulima", "032", "Daily", true}, {"Kitale", "026", "Mon, Wed & Sat", true},
}

type commodityRow struct{ name, unit, category string }

var commodities = []commodityRow{
	{"Sukuma wiki", "bunch", "veg"}, {"Cabbage", "head", "veg"}, {"Tomatoes", "crate", "veg"},
	{"Onions, red", "net 13kg", "veg"}, {"Irish potatoes", "bag 50kg", "veg"}, {"Carrots", "bag 90kg", "veg"},
	{"Maize", "bag 90kg", "cereal"}, {"Beans, rosecoco", "bag 90kg", "cereal"}, {"Rice, pishori", "bag 50kg", "cereal"},
	{"Avocado, Hass", "kg", "fruit"}, {"French beans", "kg", "fruit"}, {"Banana", "bunch", "fruit"},
	{"Goat, mature", "head", "live"}, {"Cattle, mature", "head", "live"}, {"Milk, raw", "litre", "live"},
	{"Chicken, kienyeji", "bird", "live"}, {"Tilapia", "kg", "live"},
	{"Mitumba bale, grade A", "bale", "goods"}, {"DAP fertiliser", "bag 50kg", "goods"}, {"Cement, 50kg", "bag", "goods"},
}

type pricingRuleRow struct {
	key, label    string
	amountKES     *float64
	amountPct     *float64
	billingPeriod string
}

func f(v float64) *float64 { return &v }

var pricingRules = []pricingRuleRow{
	{"SUBDOMAIN_SETUP_FEE", "Custom subdomain — setup", f(1500), nil, "ONE_TIME"},
	{"SUBDOMAIN_MONTHLY_FEE", "Custom subdomain — hosting", f(300), nil, "MONTHLY"},
	{"POS_MONTHLY_FEE", "PoS terminal add-on", f(400), nil, "MONTHLY"},
	{"PLATFORM_FEE_PCT", "Platform fee on checkout sales", nil, f(1.5), "PER_ORDER"},
}

// SeedReferenceData ports seed.ts in full — counties, issuers, markets,
// commodities, pricing rules, and the one operations StaffUser account
// that makes the admin app reachable on first run. No fake registrations
// or parties, same discipline the TS version documents.
func SeedReferenceData(ctx context.Context, pool *pgxpool.Pool) error {
	for _, c := range counties {
		_, err := pool.Exec(ctx, `
			INSERT INTO county (code, name, "hasFieldOfficer", "pricesLive", population)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (code) DO UPDATE SET "hasFieldOfficer" = $3, "pricesLive" = $4`,
			c.code, c.name, c.hasFieldOfficer, c.pricesLive, c.population)
		if err != nil {
			return fmt.Errorf("county %s: %w", c.name, err)
		}
	}
	fmt.Printf("  counties: %d\n", len(counties))

	for _, iss := range issuers {
		_, err := pool.Exec(ctx, `
			INSERT INTO issuer (id, name, "shortName", kind, "allowedClaims", active)
			VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
			ON CONFLICT (name) DO UPDATE SET active = true`,
			iss.name, iss.shortName, iss.kind, iss.allowedClaims)
		if err != nil {
			return fmt.Errorf("issuer %s: %w", iss.name, err)
		}
	}
	fmt.Printf("  issuers: %d\n", len(issuers))

	for _, m := range markets {
		_, err := pool.Exec(ctx, `
			INSERT INTO market (id, name, "countyCode", "marketDays", reporting)
			VALUES (gen_random_uuid(), $1, $2, $3, $4)
			ON CONFLICT (name, "countyCode") DO UPDATE SET reporting = $4`,
			m.name, m.countyCode, m.days, m.reporting)
		if err != nil {
			return fmt.Errorf("market %s: %w", m.name, err)
		}
	}
	fmt.Printf("  markets: %d\n", len(markets))

	for _, c := range commodities {
		_, err := pool.Exec(ctx, `
			INSERT INTO commodity (id, name, unit, category)
			VALUES (gen_random_uuid(), $1, $2, $3)
			ON CONFLICT (name) DO NOTHING`, c.name, c.unit, c.category)
		if err != nil {
			return fmt.Errorf("commodity %s: %w", c.name, err)
		}
	}
	fmt.Printf("  commodities: %d\n", len(commodities))

	for _, p := range pricingRules {
		_, err := pool.Exec(ctx, `
			INSERT INTO pricing_rule (id, key, label, "amountKes", "amountPct", "billingPeriod", "updatedAt")
			VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
			ON CONFLICT (key) DO NOTHING`, p.key, p.label, p.amountKES, p.amountPct, p.billingPeriod)
		if err != nil {
			return fmt.Errorf("pricing rule %s: %w", p.key, err)
		}
	}
	fmt.Printf("  pricing rules: %d (edit these from the admin app, not by re-seeding)\n", len(pricingRules))

	pin := os.Getenv("SEED_ADMIN_PIN")
	if pin == "" {
		pin = "482915"
	}
	pinHash := os.Getenv("SEED_ADMIN_HASH")
	if pinHash == "" {
		var err error
		pinHash, err = authsvc.HashPin(pin)
		if err != nil {
			return fmt.Errorf("hashing admin PIN: %w", err)
		}
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO staff_user (id, email, name, "pinHash", capabilities, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), 'ops@esoko.co.ke', 'Operations', $1, ARRAY['*'], now(), now())
		ON CONFLICT (email) DO NOTHING`, pinHash)
	if err != nil {
		return fmt.Errorf("ops staff user: %w", err)
	}
	fmt.Printf("  staff: ops@esoko.co.ke  (PIN %s — change before any deployment)\n", pin)

	return nil
}
