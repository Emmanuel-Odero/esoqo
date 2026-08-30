package authsvc

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RateLimitError mirrors packages/auth/src/ratelimit.ts's RateLimitError
// (HTTP 429).
type RateLimitError struct {
	RetryAfterSeconds int
}

func (e *RateLimitError) Error() string {
	return fmt.Sprintf("rate limit exceeded, retry after %ds", e.RetryAfterSeconds)
}

// CheckRateLimit — fixed-window counter, same shape as the TS version.
func CheckRateLimit(ctx context.Context, rdb *redis.Client, key string, limit int, window time.Duration) error {
	k := "rl:" + key
	n, err := rdb.Incr(ctx, k).Result()
	if err != nil {
		return err
	}
	if n == 1 {
		rdb.Expire(ctx, k, window)
	}
	if int(n) > limit {
		ttl, _ := rdb.TTL(ctx, k).Result()
		retryAfter := int(window.Seconds())
		if ttl > 0 {
			retryAfter = int(ttl.Seconds())
		}
		return &RateLimitError{RetryAfterSeconds: retryAfter}
	}
	return nil
}
