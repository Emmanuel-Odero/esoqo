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

// ── Failure counters ────────────────────────────────────────────────
//
// CheckRateLimit counts every call, which is right for "how often may
// anyone ask this" and wrong for "how many times may you get this
// WRONG". A six-digit delivery code needs the second: a receiver who
// fumbles the code twice and then reads it correctly must not be any
// closer to a lockout than one who got it right first time, while a
// courier enumerating the million must hit a wall quickly.
//
// Hence the split below — the check never increments, and only a
// genuine failure does. Deliberately in Redis rather than a column on
// parcel: it is throttling state with a natural expiry, not a fact
// about the parcel worth keeping once the window passes.

// FailedAttempts reports how many failures are recorded against key
// WITHOUT recording another. A Redis outage reports zero rather than an
// error: the throttle is a guard on top of the code check, never the
// thing standing between a receiver and their parcel (the same
// "guard, not gate" rule rateLimit's own middleware follows).
func FailedAttempts(ctx context.Context, rdb *redis.Client, key string) int {
	if rdb == nil {
		return 0
	}
	n, err := rdb.Get(ctx, "fail:"+key).Int()
	if err != nil {
		return 0
	}
	return n
}

// RecordFailure counts one failure against key and returns the new
// total. The window restarts on the first failure only, so a burst of
// guesses cannot keep pushing the expiry out ahead of itself.
func RecordFailure(ctx context.Context, rdb *redis.Client, key string, window time.Duration) int {
	if rdb == nil {
		return 0
	}
	n, err := rdb.Incr(ctx, "fail:"+key).Result()
	if err != nil {
		return 0
	}
	if n == 1 {
		rdb.Expire(ctx, "fail:"+key, window)
	}
	return int(n)
}

// ClearFailures wipes the counter after a success, so a parcel whose
// receiver mistyped twice before getting it right leaves no trap behind
// for the next code checked against the same key.
func ClearFailures(ctx context.Context, rdb *redis.Client, key string) {
	if rdb == nil {
		return
	}
	rdb.Del(ctx, "fail:"+key)
}
