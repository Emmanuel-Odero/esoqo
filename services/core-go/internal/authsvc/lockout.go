package authsvc

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// Lockout is a Redis-backed failed-attempt counter for credential checks
// that have no per-account column to record failures in.
//
// Subject sign-in records failures on the person row (dbx.RecordSignIn*),
// but ticketing staff have no equivalent, which left that endpoint with
// unlimited PIN guesses against a named staff member. Redis keeps this
// out of the schema; the tradeoff is that a Redis flush resets the
// counter, which is acceptable for a guard sitting behind a transport
// rate limit that does not share that failure mode.
type Lockout struct {
	rdb      *redis.Client
	max      int
	window   time.Duration
	keyspace string
}

func NewLockout(rdb *redis.Client, keyspace string, max int, window time.Duration) *Lockout {
	return &Lockout{rdb: rdb, max: max, window: window, keyspace: keyspace}
}

func (l *Lockout) key(subject string) string { return "lockout:" + l.keyspace + ":" + subject }

// Locked reports whether this subject has already burned its attempts.
// A Redis error returns false: the transport rate limit is still in
// force, and failing closed here would let a Redis blip lock every
// legitimate operator out of the till.
func (l *Lockout) Locked(ctx context.Context, subject string) bool {
	n, err := l.rdb.Get(ctx, l.key(subject)).Int()
	if err != nil {
		return false
	}
	return n >= l.max
}

// RecordFailure counts one bad attempt and starts the window on the
// first. The window is not extended by later failures, so a locked-out
// subject always recovers after at most one full window.
func (l *Lockout) RecordFailure(ctx context.Context, subject string) {
	k := l.key(subject)
	n, err := l.rdb.Incr(ctx, k).Result()
	if err == nil && n == 1 {
		l.rdb.Expire(ctx, k, l.window)
	}
}

// Clear resets the counter after a successful authentication.
func (l *Lockout) Clear(ctx context.Context, subject string) {
	l.rdb.Del(ctx, l.key(subject))
}
