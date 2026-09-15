package authsvc

import (
	"context"
	"errors"
	"log"
	"os"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrSmsBudgetExhausted is returned by SendSms once the global daily
// message ceiling is reached. Callers that treat SMS as best-effort
// (most notifications) already ignore send errors; the ones that don't
// surface it as a normal failure.
var ErrSmsBudgetExhausted = errors.New("authsvc: daily SMS budget exhausted")

// smsBudgetRedis is set once at boot by SetSmsBudgetRedis. SendSms is a
// package-level function called from every domain, so there is nowhere
// to thread a client through without touching all of them.
var smsBudgetRedis atomic.Pointer[redis.Client]

// SetSmsBudgetRedis enables global SMS budgeting. Until it is called —
// and in any process without Redis — sends are unmetered, which is the
// pre-existing behaviour rather than a silent outage.
func SetSmsBudgetRedis(rdb *redis.Client) { smsBudgetRedis.Store(rdb) }

// smsDailyCap is the ceiling across every purpose combined. Generous by
// default: this is a backstop against runaway loops and abuse, not a
// business throttle, so it should only ever fire on something wrong.
func smsDailyCap() int64 {
	if raw := os.Getenv("SMS_DAILY_CAP"); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return 20000
}

// chargeSmsBudget reserves one message against today's global ceiling.
//
// OTP keeps its own tighter, cost-denominated cap in IssueOtp; this is
// the outer bound that applies to everything, including OTP, so no
// single purpose can exhaust the account on its own.
func chargeSmsBudget(purpose string) error {
	rdb := smsBudgetRedis.Load()
	if rdb == nil {
		return nil // unmetered (no Redis wired) — see SetSmsBudgetRedis
	}
	// Console/mock providers never dial a gateway, so they cost nothing
	// and must not consume budget a real send would need.
	switch SmsProvider() {
	case "console", "mock":
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	key := "sms:sent:" + time.Now().UTC().Format("2006-01-02")
	n, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		// Redis trouble must not take messaging down with it; the OTP
		// path retains its own independent cap either way.
		return nil
	}
	if n == 1 {
		rdb.Expire(ctx, key, 48*time.Hour)
	}

	cap := smsDailyCap()
	if n > cap {
		if n == cap+1 { // log the crossing once, not once per blocked send
			log.Printf("ALERT sms_daily_cap_exceeded sent=%d cap=%d purpose=%s", n, cap, purpose)
		}
		return ErrSmsBudgetExhausted
	}
	return nil
}
