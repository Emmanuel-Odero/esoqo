// Command api runs core-go, Esoko's mobile-facing REST API. See
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

	"github.com/esoko/core-go/internal/config"
	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/httpapi"
	"github.com/esoko/core-go/internal/redisclient"
)

func main() {
	cfg := config.Load()

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

	<-ctx.Done()
	log.Println("core-go: shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("core-go: graceful shutdown failed: %v", err)
	}
}
