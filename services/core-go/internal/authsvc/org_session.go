package authsvc

import (
	"context"
	"fmt"

	"github.com/esoqo/core-go/internal/orgtypes"
)

// CreateOrgSession creates a new organization-scoped session using the org type registry.
// This replaces courier-specific session creation with a generic approach.
//
// Parameters:
//   - ctx: context for redis operations
//   - s: session service instance
//   - orgID: the organization ID
//   - orgType: the organization type (courier, hotel, eatery, etc.)
//   - actorID: the staff member's ID
//   - partyID: the party ID (person) associated with this staff member
//   - role: the staff member's role
//   - capabilities: custom capabilities for this staff member (overrides role defaults)
//
// Returns the session token or an error.
func CreateOrgSession(
	ctx context.Context,
	s *SessionService,
	orgID string,
	orgType string,
	actorID string,
	partyID string,
	role string,
	capabilities []string,
) (string, error) {
	// Validate org type
	orgTypeDef, err := orgtypes.GetByString(orgType)
	if err != nil {
		return "", fmt.Errorf("invalid org type: %w", err)
	}

	// Determine TTL based on org type and session profile
	profile := orgTypeDef.DefaultSessionProfile
	ttl := orgtypes.SessionTTL(orgtypes.OrgType(orgType), orgtypes.SessionProfile(profile))

	// If no custom capabilities provided, use role defaults
	if len(capabilities) == 0 {
		var err error
		capabilities, err = orgtypes.AllCapabilitiesForRole(
			orgtypes.OrgType(orgType),
			role,
		)
		if err != nil {
			// Role doesn't exist; fall back to empty capabilities
			capabilities = []string{}
		}
	}

	// Create the session data
	sessionData := SessionData{
		ActorType:      ActorAgent,
		ActorID:        actorID,
		OrgID:          orgID,
		OrgType:        orgType,
		PartyID:        partyID,
		SessionProfile: string(profile),
		Capabilities:   capabilities,
	}

	// Courier's legacy /v1/parcel-orgs/* handlers (the entire courier
	// portal — parcels, counter, dispatch, money, scan) all gate on
	// ctx.ParcelOrgID via orgCtx(), not the generic OrgID/OrgType this
	// function otherwise sets. Without this, a courier session minted
	// through the generic switcher is invisible to every one of them.
	if orgType == "courier" {
		sessionData.ParcelOrgID = orgID
	}

	// Create and return the session token
	return s.CreateSession(ctx, sessionData, ttl)
}

// BackwardCompatCreateParcelOrgSession creates a session using the old ParcelOrgID field
// for backward compatibility during migration. New code should use CreateOrgSession.
// DEPRECATED: Use CreateOrgSession instead.
func BackwardCompatCreateParcelOrgSession(
	ctx context.Context,
	s *SessionService,
	parcelOrgID string,
	actorID string,
	partyID string,
	role string,
	capabilities []string,
) (string, error) {
	// Use new generic function
	token, err := CreateOrgSession(
		ctx, s,
		parcelOrgID, "courier",
		actorID, partyID,
		role, capabilities,
	)
	if err != nil {
		return "", err
	}

	// Also maintain backward compat by setting ParcelOrgID in session data
	// (This is read back in CtxFromToken and set in ParcelOrgID field)
	return token, nil
}

// CreateTicketOrgSession creates a session for a ticket organiser staff member.
// DEPRECATED: Use CreateOrgSession instead.
func CreateTicketOrgSession(
	ctx context.Context,
	s *SessionService,
	ticketOrgID string,
	actorID string,
	partyID string,
	role string,
	capabilities []string,
) (string, error) {
	// Use new generic function
	return CreateOrgSession(
		ctx, s,
		ticketOrgID, "ticket",
		actorID, partyID,
		role, capabilities,
	)
}

// CopySessionToNewOrgType creates a new session with the same data but different org type.
// Useful when migrating sessions between org types or for testing.
func CopySessionToNewOrgType(
	ctx context.Context,
	s *SessionService,
	existingData SessionData,
	newOrgType string,
) (string, error) {
	// Update org type and re-derive TTL
	existingData.OrgType = newOrgType
	orgTypeDef, err := orgtypes.GetByString(newOrgType)
	if err != nil {
		return "", err
	}

	profile := orgTypeDef.DefaultSessionProfile
	ttl := orgtypes.SessionTTL(orgtypes.OrgType(newOrgType), orgtypes.SessionProfile(profile))

	return s.CreateSession(ctx, existingData, ttl)
}
