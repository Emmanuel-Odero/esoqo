// Package dbx wraps the pgx pool and the hand-written queries core-go
// needs against the schema authored by packages/db/prisma/schema.prisma.
// No ORM/sqlc codegen yet (Phase 0 keeps this small and explicit); Phase
// 1 introduces sqlc once the domain query surface is large enough to
// justify it — see docs/adr/0005-mobile-api-in-go.md and the plan this
// service was scaffolded from.
package dbx

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
