package authsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// OrgContextService manages temporary org-context activations for subjects
// (people) switching into org-staff duty. An activation is a Redis key that
// expires after TTL, meaning the subject has confirmed (via OTP) that they
// hold the given role at the given org for the current session window.
//
// This is used by the "unified crew identity" flow:
// POST /org-context/activate/request → OTP sent
// POST /org-context/activate/verify  → OTP checked, activation stored
// GET  /org-context/status            → active org contexts for the caller
// POST /org-context/deactivate        → remove an activation early
type OrgContextService struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewOrgContextService creates a new OrgContextService backed by Redis.
// ttl is how long an activation remains valid after the OTP is confirmed.
func NewOrgContextService(rdb *redis.Client, ttl time.Duration) *OrgContextService {
	return &OrgContextService{rdb: rdb, ttl: ttl}
}

// TTL returns the configured activation window.
func (s *OrgContextService) TTL() time.Duration {
	return s.ttl
}

type orgContextActivation struct {
	OrgID     string    `json:"orgId"`
	Role      string    `json:"role"`
	PartyID   string    `json:"partyId"`
	ActivatedAt time.Time `json:"activatedAt"`
}

func orgContextKey(partyID, orgID string) string {
	return fmt.Sprintf("orgctx:%s:%s", partyID, orgID)
}

func orgContextIndexKey(partyID string) string {
	return fmt.Sprintf("orgctx:idx:%s", partyID)
}

// Activate stores an org-context activation for a party.
func (s *OrgContextService) Activate(ctx context.Context, partyID, orgID, role string) error {
	activation := orgContextActivation{
		OrgID:       orgID,
		Role:        role,
		PartyID:     partyID,
		ActivatedAt: time.Now().UTC(),
	}
	data, err := json.Marshal(activation)
	if err != nil {
		return err
	}

	key := orgContextKey(partyID, orgID)
	pipe := s.rdb.Pipeline()
	pipe.Set(ctx, key, data, s.ttl)
	// Track all org activations for this party in a set
	pipe.SAdd(ctx, orgContextIndexKey(partyID), orgID)
	pipe.Expire(ctx, orgContextIndexKey(partyID), s.ttl)
	_, err = pipe.Exec(ctx)
	return err
}

// Deactivate removes an org-context activation.
func (s *OrgContextService) Deactivate(ctx context.Context, partyID, orgID string) error {
	key := orgContextKey(partyID, orgID)
	pipe := s.rdb.Pipeline()
	pipe.Del(ctx, key)
	pipe.SRem(ctx, orgContextIndexKey(partyID), orgID)
	_, err := pipe.Exec(ctx)
	return err
}

// OrgContextActivation is the public view of an activation.
type OrgContextActivation struct {
	OrgID       string    `json:"orgId"`
	Role        string    `json:"role"`
	PartyID     string    `json:"partyId"`
	ActivatedAt time.Time `json:"activatedAt"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

// Get returns the active org-context activation for a party+org combination,
// or nil if none exists.
func (s *OrgContextService) Get(ctx context.Context, partyID, orgID string) (*OrgContextActivation, error) {
	key := orgContextKey(partyID, orgID)
	data, err := s.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var a orgContextActivation
	if err := json.Unmarshal(data, &a); err != nil {
		return nil, err
	}

	ttl, err := s.rdb.TTL(ctx, key).Result()
	if err != nil {
		ttl = 0
	}

	return &OrgContextActivation{
		OrgID:       a.OrgID,
		Role:        a.Role,
		PartyID:     a.PartyID,
		ActivatedAt: a.ActivatedAt,
		ExpiresAt:   time.Now().Add(ttl),
	}, nil
}

// List returns all active org-context activations for a party.
func (s *OrgContextService) List(ctx context.Context, partyID string) ([]OrgContextActivation, error) {
	orgIDs, err := s.rdb.SMembers(ctx, orgContextIndexKey(partyID)).Result()
	if err != nil {
		return nil, err
	}

	var activations []OrgContextActivation
	for _, orgID := range orgIDs {
		a, err := s.Get(ctx, partyID, orgID)
		if err != nil {
			continue // skip broken entries
		}
		if a == nil {
			// Activation expired but index entry wasn't cleaned up — remove it
			s.rdb.SRem(ctx, orgContextIndexKey(partyID), orgID) //nolint:errcheck
			continue
		}
		activations = append(activations, *a)
	}
	return activations, nil
}
