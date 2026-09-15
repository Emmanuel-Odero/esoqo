package authsvc

import (
	"testing"
	"time"
)

// The failure this guards: ReadSession slides the Redis TTL forward on
// every use, so without clipping to the absolute expiry a session that
// is touched once a day never dies.
func TestRemainingLifeClipsToAbsoluteExpiry(t *testing.T) {
	data := SessionData{ExpiresAt: time.Now().Add(2 * time.Hour).UnixMilli()}

	got := remainingLife(data)
	if got > 2*time.Hour {
		t.Errorf("remainingLife = %v, must not exceed the 2h left of absolute life", got)
	}
	if got <= 0 {
		t.Errorf("remainingLife = %v, should still be positive", got)
	}
}

// Well inside the absolute window, the idle TTL is the binding limit.
func TestRemainingLifeUsesIdleTTLWhenAbsoluteIsFarOff(t *testing.T) {
	data := SessionData{ExpiresAt: time.Now().Add(14 * 24 * time.Hour).UnixMilli()}

	if got := remainingLife(data); got != SessionIdleTTL {
		t.Errorf("remainingLife = %v, want the idle TTL %v", got, SessionIdleTTL)
	}
}

// Sessions issued before ExpiresAt existed must keep working rather than
// being treated as already expired.
func TestRemainingLifeHandlesLegacySessions(t *testing.T) {
	if got := remainingLife(SessionData{}); got != SessionIdleTTL {
		t.Errorf("remainingLife = %v for a legacy session, want %v", got, SessionIdleTTL)
	}
}

// Past the absolute expiry there is no life left to grant.
func TestRemainingLifeIsNonPositiveOnceExpired(t *testing.T) {
	data := SessionData{ExpiresAt: time.Now().Add(-time.Minute).UnixMilli()}
	if got := remainingLife(data); got > 0 {
		t.Errorf("remainingLife = %v for an expired session, want <= 0", got)
	}
}

func TestIdleTTLFromEnvOverride(t *testing.T) {
	t.Setenv("SESSION_IDLE_TTL_HOURS", "3")
	if got := idleTTLFromEnv(); got != 3*time.Hour {
		t.Errorf("idleTTLFromEnv = %v, want 3h", got)
	}

	t.Setenv("SESSION_IDLE_TTL_HOURS", "not-a-number")
	if got := idleTTLFromEnv(); got != 7*24*time.Hour {
		t.Errorf("idleTTLFromEnv = %v on garbage input, want the 7d default", got)
	}
}
