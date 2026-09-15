// Command api runs core-go, Esoqo's mobile-facing REST API. See
// docs/adr/0005-mobile-api-in-go.md for why this exists alongside
// services/core (TypeScript), and the phased plan it was scaffolded from.
package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/config"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/httpapi"
	"github.com/esoqo/core-go/internal/notify"
	"github.com/esoqo/core-go/internal/redisclient"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("core-go: refusing to start: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := dbx.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("core-go: could not connect to postgres: %v", err)
	}
	defer pool.Close()

	rdb, err := redisclient.New(cfg.RedisURL)
	if err != nil {
		log.Fatalf("core-go: could not connect to redis: %v", err)
	}
	defer rdb.Close()

	// Puts every SMS sender, not just OTP, under one daily ceiling.
	authsvc.SetSmsBudgetRedis(rdb)

	// Every parcel notification appends a tracking link built from this.
	// Process-wide configuration rather than a parameter threaded
	// through every composer — see notify.SetTrackingBaseURL. Unset is
	// valid and simply omits the link, which is what keeps a
	// misconfigured deploy from texting people a broken URL.
	notify.SetTrackingBaseURL(cfg.PublicTrackingBaseURL)

	server := httpapi.NewServer(cfg, pool, rdb)
	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           server.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("core-go: listening on :%s (APP_ENV=%s)", cfg.Port, config.CurrentAppEnv())
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("core-go: server error: %v", err)
		}
	}()

	// ExecuteWithdrawalIfDue is meant to run from a scheduled sweep, not
	// a request — see dbx.SweepDueWithdrawals's own comment. A withdrawal
	// only ever executes here, once its standby window has elapsed AND
	// its signature threshold is met; never on the request that got it
	// there.
	go runWithdrawalSweep(ctx, pool, server)

	// Cancels a DRAFT_PENDING_PAYMENT parcel booking abandoned over 24h
	// ago — see dbx.SweepStaleParcelDrafts's own comment. Not
	// time-critical like a due withdrawal, so a longer interval.
	go runParcelDraftSweep(ctx, pool)

	<-ctx.Done()
	log.Println("core-go: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("core-go: graceful shutdown failed: %v", err)
	}
}

func runWithdrawalSweep(ctx context.Context, pool *pgxpool.Pool, server *httpapi.Server) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			swept, err := dbx.SweepDueWithdrawals(ctx, pool)
			if err != nil {
				log.Printf("core-go: withdrawal sweep failed: %v", err)
				continue
			}
			for _, w := range swept {
				// The audit row + member SMS for each executed/expired
				// withdrawal — see RecordWithdrawalOutcome's own comment
				// for why this can't happen at the handler layer like
				// every other treasury audit row in this file.
				server.RecordWithdrawalOutcome(ctx, w)
			}
			if len(swept) > 0 {
				log.Printf("core-go: withdrawal sweep executed/expired %d request(s)", len(swept))
			}
		}
	}
}

func runParcelDraftSweep(ctx context.Context, pool *pgxpool.Pool) {
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := dbx.SweepStaleParcelDrafts(ctx, pool)
			if err != nil {
				log.Printf("core-go: parcel draft sweep failed: %v", err)
				continue
			}
			if n > 0 {
				log.Printf("core-go: parcel draft sweep cancelled %d abandoned booking(s)", n)
			}
		}
	}
}
