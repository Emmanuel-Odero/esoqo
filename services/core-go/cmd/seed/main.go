// Command seed replaces packages/db/prisma/seed.ts and seed-demo.ts —
// see docs/adr/0005-mobile-api-in-go.md and internal/seed's own header.
// Run: go run ./cmd/seed  (from services/core-go)
package main

import (
	"context"
	"log"
	"os"

	"github.com/esoqo/core-go/internal/config"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/seed"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("seed: refusing to run: %v", err)
	}
	ctx := context.Background()

	// Everything below "reference data" plants accounts whose PIN is a
	// known function of the phone number. LOCAL_TEST_PROD points
	// DATABASE_URL at real infrastructure, so demo seeding is confined to
	// development — otherwise a rehearsal run leaves sign-in-able demo
	// identities on a live database.
	demoAllowed := config.CurrentAppEnv() == config.AppEnvDevelopment
	if !demoAllowed && os.Getenv("SEED_REFERENCE_ONLY") != "1" {
		log.Fatalf("seed: APP_ENV=%s seeds demo accounts with predictable PINs; "+
			"set SEED_REFERENCE_ONLY=1 to seed reference data only", config.CurrentAppEnv())
	}

	pool, err := dbx.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("seed: could not connect to postgres: %v", err)
	}
	defer pool.Close()

	log.Println("seeding reference data…")
	if err := seed.SeedReferenceData(ctx, pool); err != nil {
		log.Fatalf("seed: reference data: %v", err)
	}

	if !demoAllowed {
		log.Println("SEED_REFERENCE_ONLY=1 — skipping all demo data.")
		return
	}

	log.Println("seeding demo ticketing…")
	if err := seed.SeedDemoTicketing(ctx, pool); err != nil {
		log.Fatalf("seed: demo ticketing: %v", err)
	}

	log.Println("seeding demo stores…")
	if err := seed.SeedDemoStores(ctx, pool); err != nil {
		log.Fatalf("seed: demo stores: %v", err)
	}

	log.Println("seeding pilot SACCO…")
	if err := seed.SeedPilotData(ctx, pool, cfg.FleetQrSecret); err != nil {
		log.Fatalf("seed: pilot: %v", err)
	}

	log.Println("seeding unified-crew-identity demo accounts…")
	accounts, err := seed.SeedDemoUnifiedIdentity(ctx, pool)
	if err != nil {
		log.Fatalf("seed: unified identity: %v", err)
	}
	log.Println("\nDemo sign-in accounts (phone + PIN, POST /v1/auth/sign-in):")
	for _, a := range accounts {
		log.Printf("  %-16s PIN %-8s %-24s %s\n", a.Msisdn, a.Pin, a.Name, a.Description)
	}

	log.Println("\nNo real registrations, parties or prices were seeded — reference data and clearly-labelled \"Demo\" content only.")
}
