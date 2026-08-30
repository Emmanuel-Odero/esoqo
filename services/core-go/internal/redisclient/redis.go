// Package redisclient wraps the single go-redis client every other
// internal package shares — the Go equivalent of packages/auth/src/redis.ts's
// global singleton (no HMR-survival trick needed here, since a Go process
// doesn't hot-reload the way `next dev` does).
package redisclient

import (
	"context"

	"github.com/redis/go-redis/v9"
)

func New(url string) (*redis.Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(opt)
	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, err
	}
	return client, nil
}
