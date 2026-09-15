package authsvc

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// Ported from packages/auth/src/session.ts. Opaque, Redis-backed —
// deliberately not a JWT, because SIMAMA (instant account freeze) needs
// a server-side kill switch a JWT's own expiry can't provide. The mobile
// client sends the token as `Authorization: Bearer <token>` instead of
// the web app's httpOnly cookie; everything else is identical, including
// storing the token hashed at rest so a Redis dump yields nothing usable.

const SessionTTL = 14 * 24 * time.Hour

// SessionIdleTTL bounds how long a session survives without being used,
// inside the absolute SessionTTL above.
//
// 14 days of absolute life with no idle bound meant a phone left in a
// matatu, or a shared till device nobody signed out of, stayed a valid
// credential for a fortnight. Seven days is deliberately generous — this
// is a mobile-first product where a fortnightly user is normal, and the
// goal is to expire genuinely abandoned sessions, not to log people out
// mid-task. Override with SESSION_IDLE_TTL_HOURS.
var SessionIdleTTL = idleTTLFromEnv()

func idleTTLFromEnv() time.Duration {
	if raw := os.Getenv("SESSION_IDLE_TTL_HOURS"); raw != "" {
		if h, err := strconv.Atoi(raw); err == nil && h > 0 {
			return time.Duration(h) * time.Hour
		}
	}
	return 7 * 24 * time.Hour
}

type SessionData struct {
	ActorType   ActorType `json:"actorType"`
	ActorID     string    `json:"actorId"`
	PartyID     string    `json:"partyId,omitempty"`
	OrgID       string    `json:"orgId,omitempty"`
	StoreID     string    `json:"storeId,omitempty"`
	TicketOrgID string    `json:"ticketOrgId,omitempty"`
	// ParcelOrgID scopes an AGENT session to one courier company, the
	// exact role TicketOrgID plays for organiser staff. Set only by
	// parcel-company PIN sign-in; empty everywhere else.
	ParcelOrgID  string   `json:"parcelOrgId,omitempty"`
	Capabilities []string `json:"capabilities"`
	IssuedAt     int64    `json:"issuedAt"`

	// ExpiresAt is the absolute end of life, carried in the payload so
	// that refreshing the idle window (which rewrites the Redis TTL)
	// cannot extend a session indefinitely. Zero for sessions issued
	// before this field existed — those keep the old behaviour of
	// expiring purely on the Redis TTL.
	ExpiresAt int64 `json:"expiresAt,omitempty"`
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

type SessionService struct {
	rdb *redis.Client
}

func NewSessionService(rdb *redis.Client) *SessionService {
	return &SessionService{rdb: rdb}
}

// CreateSession — ttl defaults to 14 days; pass a shorter one for
// anything that shouldn't linger (e.g. a till/cashier-equivalent session).
func (s *SessionService) CreateSession(ctx context.Context, data SessionData, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = SessionTTL
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)

	now := time.Now()
	data.IssuedAt = now.UnixMilli()
	data.ExpiresAt = now.Add(ttl).UnixMilli()
	payload, err := json.Marshal(data)
	if err != nil {
		return "", err
	}

	// The Redis key expires on the idle window, not the absolute TTL —
	// ReadSession slides it forward on each use, and ExpiresAt in the
	// payload is what stops that sliding forever. A session unused for
	// SessionIdleTTL simply disappears.
	redisTTL := ttl
	if SessionIdleTTL < redisTTL {
		redisTTL = SessionIdleTTL
	}

	h := hashToken(token)
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, "sess:"+h, payload, redisTTL)
	if data.ActorID != "" {
		pipe.SAdd(ctx, "sess:actor:"+data.ActorID, h)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return "", err
	}
	return token, nil
}

func (s *SessionService) ReadSession(ctx context.Context, token string) (*SessionData, error) {
	if token == "" {
		return nil, nil
	}
	raw, err := s.rdb.Get(ctx, "sess:"+hashToken(token)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var data SessionData
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return nil, nil
	}

	// Absolute expiry wins over the sliding Redis TTL. Without this
	// check, a session touched once a day would live forever.
	if data.ExpiresAt > 0 && time.Now().UnixMilli() >= data.ExpiresAt {
		s.rdb.Del(ctx, "sess:"+hashToken(token))
		return nil, nil
	}

	// Slide the idle window forward. Best-effort: a failure here costs
	// the user an early sign-out, never wrongly extends anything.
	if remaining := remainingLife(data); remaining > 0 {
		s.rdb.Expire(ctx, "sess:"+hashToken(token), remaining)
	}

	return &data, nil
}

// remainingLife is how long this session may still live: the idle
// window, clipped to whatever is left of its absolute lifetime.
func remainingLife(data SessionData) time.Duration {
	ttl := SessionIdleTTL
	if data.ExpiresAt > 0 {
		untilAbsolute := time.Until(time.UnixMilli(data.ExpiresAt))
		if untilAbsolute < ttl {
			ttl = untilAbsolute
		}
	}
	return ttl
}

func (s *SessionService) DestroySession(ctx context.Context, token string) error {
	h := hashToken(token)
	raw, err := s.rdb.Get(ctx, "sess:"+h).Result()
	if err == nil {
		var data SessionData
		if json.Unmarshal([]byte(raw), &data) == nil {
			s.rdb.SRem(ctx, "sess:actor:"+data.ActorID, h)
		}
	}
	return s.rdb.Del(ctx, "sess:"+h).Err()
}

// DestroyAllSessions — sign out everywhere. Used by account freeze and
// PIN reset.
func (s *SessionService) DestroyAllSessions(ctx context.Context, actorID string) (int, error) {
	hashes, err := s.rdb.SMembers(ctx, "sess:actor:"+actorID).Result()
	if err != nil {
		return 0, err
	}
	if len(hashes) == 0 {
		return 0, nil
	}
	keys := make([]string, 0, len(hashes)+1)
	for _, h := range hashes {
		keys = append(keys, "sess:"+h)
	}
	keys = append(keys, "sess:actor:"+actorID)
	if err := s.rdb.Del(ctx, keys...).Err(); err != nil {
		return 0, err
	}
	return len(hashes), nil
}

// CtxFromToken is the ONLY way a Ctx is constructed from a request —
// nothing here reads a header, mirroring the TS original's explicit
// anti-CVE-2025-29927 design.
func (s *SessionService) CtxFromToken(ctx context.Context, token, ip string) (*Ctx, error) {
	data, err := s.ReadSession(ctx, token)
	if err != nil || data == nil {
		return nil, err
	}
	caps := data.Capabilities
	if data.ActorType == ActorSubject {
		// SUBJECT capabilities are always exactly the current SUBJECT
		// preset — re-derived on every request so a session opened before
		// a new self-serve capability shipped picks it up immediately, no
		// re-login required. STAFF/AGENT stay session-frozen (not ported
		// here yet — see capabilities.go).
		caps = CapabilitiesForRole(RoleSubject)
	}
	return &Ctx{
		ActorType:    data.ActorType,
		ActorID:      data.ActorID,
		Capabilities: caps,
		PartyID:      data.PartyID,
		OrgID:        data.OrgID,
		StoreID:      data.StoreID,
		TicketOrgID:  data.TicketOrgID,
		ParcelOrgID:  data.ParcelOrgID,
		IP:           ip,
		Verified:     true,
		ExpiresAt:    data.ExpiresAt,
	}, nil
}
