package authsvc

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
)

// Package doc: docs/proposals/esoqo-unified-crew-identity.md.
//
// OrgContextService is the live, OTP-gated switch a SUBJECT flips to
// briefly also hold org-staff (SCANNER/MANAGER/ADMIN/CREW) capabilities
// for one org — the thing that lets a crew member's own Esoqo account
// carry both "myself" and "on duty for Acme Tours" without a second
// login, while keeping the two separated by an explicit re-verification
// step. Deliberately Redis-backed and TTL-bound like SessionService, not
// folded into the session token itself: an activation should be able to
// lapse (or be killed by an org admin) independent of the underlying
// sign-in staying valid.
//
// Presence of a live key here is necessary but not sufficient — every
// caller must also re-check the OrgStaffGrant's status in Postgres
// before trusting it (see dbx.GetOrgStaffGrant), so a suspension takes
// effect immediately even if this key hasn't expired yet.

// DefaultActivationTTL — used only where a caller doesn't supply its
// own (tests, anything constructing a service directly). Production and
// dev both go through config.Config.OrgContextActivationDays instead —
// see NewOrgContextService.
const DefaultActivationTTL = 60 * 24 * time.Hour

type OrgContextActivation struct {
	PartyID     string `json:"partyId"`
	OrgID       string `json:"orgId"`
	Role        string `json:"role"`
	ActivatedAt int64  `json:"activatedAt"`
}

type OrgContextService struct {
	rdb *redis.Client
	// ttl — how long an activated org context lasts before the next
	// org-scoped action requires OTP again, win or lose. Deliberately no
	// PIN-only fast path for reactivation: every lapse, suspension or
	// not, needs OTP. Configurable (config.Config.
	// OrgContextActivationDays) rather than the original design's fixed
	// shift-length window — see that field's own comment for why.
	ttl time.Duration
}

func NewOrgContextService(rdb *redis.Client, ttl time.Duration) *OrgContextService {
	if ttl <= 0 {
		ttl = DefaultActivationTTL
	}
	return &OrgContextService{rdb: rdb, ttl: ttl}
}

func orgContextKey(partyID, orgID string) string {
	return "orgctx:" + partyID + ":" + orgID
}

// TTL — exposed so handlers can tell the client how long an activation
// will actually last (see handleOrgContextActivateVerify's response).
func (s *OrgContextService) TTL() time.Duration { return s.ttl }

// Activate — called only after a fresh OTP verification. role is
// recorded for convenience/audit but is never trusted on its own; every
// consumer re-reads the grant's current role/status from Postgres.
func (s *OrgContextService) Activate(ctx context.Context, partyID, orgID, role string) error {
	data, err := json.Marshal(OrgContextActivation{
		PartyID: partyID, OrgID: orgID, Role: role, ActivatedAt: time.Now().UnixMilli(),
	})
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, orgContextKey(partyID, orgID), data, s.ttl).Err()
}

// Get returns the live activation, or nil if none/lapsed. Callers must
// still confirm the grant is active in Postgres — this only proves a
// switch happened, not that it's still allowed to have.
func (s *OrgContextService) Get(ctx context.Context, partyID, orgID string) (*OrgContextActivation, error) {
	raw, err := s.rdb.Get(ctx, orgContextKey(partyID, orgID)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var a OrgContextActivation
	if json.Unmarshal([]byte(raw), &a) != nil {
		return nil, nil
	}
	return &a, nil
}

// Deactivate — an org admin suspending a crew member calls this
// immediately, so a live session loses staff capabilities on its very
// next request rather than waiting out the TTL. Also used when a person
// deliberately switches back to "just me".
func (s *OrgContextService) Deactivate(ctx context.Context, partyID, orgID string) error {
	return s.rdb.Del(ctx, orgContextKey(partyID, orgID)).Err()
}
