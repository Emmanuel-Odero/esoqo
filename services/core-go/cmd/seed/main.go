// Command seed replaces packages/db/prisma/seed.ts and seed-demo.ts —
// see docs/adr/0005-mobile-api-in-go.md and internal/seed's own header.
// Run: go run ./cmd/seed  (from services/core-go)
package main

import (
	"context"
	"log"

	"github.com/esoko/core-go/internal/config"
	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/seed"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	pool, err := dbx.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("seed: could not connect to postgres: %v", err)
	}
	defer pool.Close()

	log.Println("seeding reference data…")
	if err := seed.SeedReferenceData(ctx, pool); err != nil {
		log.Fatalf("seed: reference data: %v", err)
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

	log.Println("\nNo real registrations, parties or prices were seeded — reference data and clearly-labelled \"Demo\" content only.")
}
