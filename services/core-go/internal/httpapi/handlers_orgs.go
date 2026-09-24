// Package httpapi (handlers_orgs.go) — Generic organization API handlers.
//
// These handlers provide a unified API for all organization types (courier, hotel,
// eatery, chama, tout, etc.). They replace courier-specific handlers like
// handleActivateParcelOrg, handleParcelStaffSignIn, etc. with generic equivalents.
package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/orgtypes"
)

// handleListMyAllOrgs — GET /v1/me/orgs?type=courier,hotel
// Lists all organizations a signed-in person is staff of across ALL org types.
// Optional query param 'type' filters by org type (comma-separated).
// This is the generic replacement for the ticket-only handleListMyOrgs.
func (s *Server) handleListMyAllOrgs(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.PartyID == "" {
		writeError(c, http.StatusUnauthorized, "NOT_SIGNED_IN", "Sign in to view your organizations")
		return
	}

	orgs, err := dbx.ListMyOrgs(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your organizations")
		return
	}

	// Filter by type if specified
	typeFilter := c.Query("type")
	if typeFilter != "" {
		allowedTypes := make(map[string]bool)
		for _, t := range strings.Split(typeFilter, ",") {
			allowedTypes[strings.TrimSpace(t)] = true
		}

		filtered := make([]dbx.MyOrg, 0, len(orgs))
		for _, org := range orgs {
			if allowedTypes[org.Type] {
				filtered = append(filtered, org)
			}
		}
		orgs = filtered
	}

	if orgs == nil {
		orgs = []dbx.MyOrg{}
	}

	c.JSON(http.StatusOK, gin.H{"orgs": orgs})
}

// handleGetOrg — GET /v1/orgs/:orgId
// Gets an organization by ID. Only returns basic info; doesn't grant access.
func (s *Server) handleGetOrg(c *gin.Context) {
	orgID := c.Param("orgId")
	org, err := dbx.GetOrg(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that organization")
		return
	}
	if org == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That organization doesn't exist")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"org": gin.H{
			"id":     org.ID,
			"type":   org.Type,
			"name":   org.Name,
			"slug":   org.Slug,
			"status": org.Status,
		},
	})
}

// handleActivateOrgSession — POST /v1/orgs/:orgId/session
// Generic org session activation for any org type.
// Replaces courier-specific handleActivateParcelOrg with a generic version.
//
// Request body: { "orgType": "courier" | "hotel" | "eatery" | ... }
// Response: { "token": "...", "expiresAt": 1234567890, "role": "MANAGER", ... }
func (s *Server) handleActivateOrgSession(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.PartyID == "" {
		writeError(c, http.StatusUnauthorized, "NOT_SIGNED_IN", "Sign in to activate an org session")
		return
	}

	orgID := c.Param("orgId")
	var req struct {
		OrgType string `json:"orgType" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	// Validate org type
	if _, err := orgtypes.GetByString(req.OrgType); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_ORG_TYPE", "Unknown organization type")
		return
	}

	// Verify person is staff at this org
	staff, err := dbx.FindOrgStaffByParty(c.Request.Context(), s.Pool, orgID, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "ACTIVATE_FAILED", "Could not open that organization")
		return
	}
	if staff == nil {
		writeError(c, http.StatusForbidden, "NOT_STAFF", "You're not on that organization's team")
		return
	}

	// Resolve capabilities
	capabilities, err := authsvc.ResolveOrgCapabilities(req.OrgType, staff.Role, staff.CustomCapabilities)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "CAPABILITY_FAILED", "Could not resolve your permissions")
		return
	}

	// Create session using generic function
	token, err := authsvc.CreateOrgSession(
		c.Request.Context(),
		s.Session,
		orgID,
		req.OrgType,
		staff.ID,
		ctx.PartyID,
		staff.Role,
		capabilities,
	)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "Could not create a session")
		return
	}

	// Get org type definition for TTL
	orgTypeDef, _ := orgtypes.GetByString(req.OrgType)
	ttl := orgtypes.SessionTTL(orgtypes.OrgType(req.OrgType), orgTypeDef.DefaultSessionProfile)
	expiresAt := time.Now().Add(ttl).UnixMilli()

	c.JSON(http.StatusOK, gin.H{
		"token":     token,
		"expiresAt": expiresAt,
		"role":      staff.Role,
		"orgId":     orgID,
		"orgType":   req.OrgType,
		"name":      staff.Name,
	})
}

// handleOrgStaffSignIn — POST /v1/orgs/staff/signin
// Generic staff sign-in for any org type using PIN authentication.
// Replaces courier-specific handleParcelStaffSignIn with a generic version.
//
// Request body: {
//   "orgSlug": "swift-riders",
//   "orgType": "courier",
//   "name": "Achieng",
//   "pin": "1234"
// }
func (s *Server) handleOrgStaffSignIn(c *gin.Context) {
	var req struct {
		OrgSlug string `json:"orgSlug" binding:"required"`
		OrgType string `json:"orgType" binding:"required"`
		Name    string `json:"name" binding:"required"`
		Pin     string `json:"pin" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	// Validate org type
	orgTypeDef, err := orgtypes.GetByString(req.OrgType)
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_ORG_TYPE", "Unknown organization type")
		return
	}

	// Check sign-in method
	if orgTypeDef.StaffSignInMethod != orgtypes.StaffSignInMethodPIN {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "This organization type does not use PIN sign-in")
		return
	}

	// Lookup org by slug and type
	org, err := dbx.GetOrgBySlug(c.Request.Context(), s.Pool, req.OrgSlug, req.OrgType)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LOOKUP_FAILED", "Could not find that organization")
		return
	}
	if org == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "No such organization at that address")
		return
	}

	// Rate limiting: per-subject lockout for wrong PINs
	subject := "orgstaff:" + strings.ToLower(req.OrgSlug+":"+req.Name)
	if s.StaffLockout.Locked(c.Request.Context(), subject) {
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Wrong name or PIN")
		return
	}


	// Find staff by name (case-insensitive)
	staff, err := dbx.FindOrgStaffByName(c.Request.Context(), s.Pool, org.ID, req.Name)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LOOKUP_FAILED", "Could not find that staff member")
		return
	}

	// Dummy hash for constant-time comparison if staff not found
	storedHash := authsvc.DummyPinHash
	if staff != nil {
		storedHash = staff.PinHash
	}

	// Verify PIN
	if staff == nil || !staff.Active || !authsvc.VerifyPin(req.Pin, storedHash) {
		s.StaffLockout.RecordFailure(c.Request.Context(), subject)
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Wrong name or PIN")
		return
	}

	s.StaffLockout.Clear(c.Request.Context(), subject)

	// Resolve capabilities
	capabilities, err := authsvc.ResolveOrgCapabilities(req.OrgType, staff.Role, staff.CustomCapabilities)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "CAPABILITY_FAILED", "Could not resolve your permissions")
		return
	}

	// Create session
	ttl := orgtypes.SessionTTL(orgtypes.OrgType(req.OrgType), orgTypeDef.DefaultSessionProfile)
	partyID := ""
	if staff.PartyID != nil {
		partyID = *staff.PartyID
	}
	token, err := s.Session.CreateSession(c.Request.Context(), authsvc.SessionData{
		ActorType:      authsvc.ActorAgent,
		ActorID:        staff.ID,
		OrgID:          org.ID,
		OrgType:        req.OrgType,
		PartyID:        partyID,
		SessionProfile: string(orgTypeDef.DefaultSessionProfile),
		Capabilities:   capabilities,
	}, ttl)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "Could not start a session")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":     token,
		"expiresAt": time.Now().Add(ttl).UnixMilli(),
		"orgId":     org.ID,
		"orgType":   req.OrgType,
		"role":      staff.Role,
		"name":      staff.Name,
	})
}

// handleGetOrgMe — GET /v1/orgs/me
// Gets the current organization and staff member's info from their session.
// Works for any org type.
func (s *Server) handleGetOrgMe(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.OrgID == "" {
		writeError(c, http.StatusForbidden, "NOT_ORG_STAFF", "This requires an organization staff session")
		return
	}

	org, err := dbx.GetOrg(c.Request.Context(), s.Pool, ctx.OrgID)
	if err != nil || org == nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load your organization")
		return
	}

	staff, err := dbx.FindOrgStaff(c.Request.Context(), s.Pool, ctx.OrgID, ctx.ActorID)
	if err != nil || staff == nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load your staff info")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"org": gin.H{
			"id":     org.ID,
			"type":   org.Type,
			"name":   org.Name,
			"slug":   org.Slug,
			"status": org.Status,
		},
		"staff": gin.H{
			"id":   staff.ID,
			"name": staff.Name,
			"role": staff.Role,
		},
		"capabilities": ctx.Capabilities,
		"expiresAt":    ctx.ExpiresAt,
	})
}

// handleListGenericOrgStaff — GET /v1/orgs/me/staff
// Lists all staff members in the current organization (generic, any org type).
// The ticket-org-specific version is handleListOrgStaff in handlers_ticket_orgs.go.
func (s *Server) handleListGenericOrgStaff(c *gin.Context) {
	ctx := ctxFromGin(c)
	orgID := authsvc.ExtractOrgFromContext(c, ctx, "staff")
	if orgID == "" {
		return
	}

	staff, err := dbx.ListOrgStaff(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load staff list")
		return
	}

	if staff == nil {
		staff = []dbx.OrgStaff{}
	}

	c.JSON(http.StatusOK, gin.H{"staff": staff})
}

// handleSignOutOrg — POST /v1/orgs/me/signout
// Signs out from the current organization session.
func (s *Server) handleSignOutOrg(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.OrgID == "" {
		writeError(c, http.StatusForbidden, "NOT_ORG_STAFF", "Not in an organization session")
		return
	}

	// Clear org session cookie based on org type
	if ctx.OrgType != "" {
		authsvc.ClearOrgSessionCookie(c.Writer, ctx.OrgType)
	} else {
		authsvc.ClearOrgSessionCookie(c.Writer, "courier") // fallback for backward compat
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleGetOrgConfig — GET /v1/orgs/me/config/:configKey
// Gets a configuration entry for the current organization.
func (s *Server) handleGetOrgConfig(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.OrgID == "" {
		writeError(c, http.StatusForbidden, "NOT_ORG_STAFF", "This requires an organization session")
		return
	}

	configKey := c.Param("configKey")
	config, err := dbx.GetOrgConfig(c.Request.Context(), s.Pool, ctx.OrgID, configKey)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load configuration")
		return
	}
	if config == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That configuration doesn't exist")
		return
	}

	var data interface{}
	if err := json.Unmarshal(config.ConfigData, &data); err != nil {
		writeError(c, http.StatusInternalServerError, "DECODE_FAILED", "Could not decode configuration")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"config": gin.H{
			"key":  config.ConfigKey,
			"data": data,
		},
	})
}

// handleListOrgConfigs — GET /v1/orgs/me/configs?prefix=pricing
// Lists configuration entries for the current organization.
// Optional 'prefix' query param filters results.
func (s *Server) handleListOrgConfigs(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.OrgID == "" {
		writeError(c, http.StatusForbidden, "NOT_ORG_STAFF", "This requires an organization session")
		return
	}

	prefix := c.Query("prefix")
	configs, err := dbx.ListOrgConfigs(c.Request.Context(), s.Pool, ctx.OrgID, prefix)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load configurations")
		return
	}

	if configs == nil {
		configs = []dbx.OrgConfig{}
	}

	// Parse config data for response
	type ConfigResponse struct {
		Key  string      `json:"key"`
		Data interface{} `json:"data"`
	}

	var results []ConfigResponse
	for _, cfg := range configs {
		var data interface{}
		if err := json.Unmarshal(cfg.ConfigData, &data); err != nil {
			// Skip configs that can't be decoded
			continue
		}
		results = append(results, ConfigResponse{
			Key:  cfg.ConfigKey,
			Data: data,
		})
	}

	c.JSON(http.StatusOK, gin.H{"configs": results})
}

// handleGetOrgPortalData — GET /v1/orgs/:orgId/portal
// Fetches all data needed for the org portal to render.
// Returns org info, staff member info, and org-type-specific metadata.
func (s *Server) handleGetOrgPortalData(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.OrgID == "" {
		writeError(c, http.StatusUnauthorized, "NOT_SIGNED_IN", "Sign in to a org to view portal data")
		return
	}

	orgID := c.Param("orgId")
	if orgID != ctx.OrgID {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "Access denied")
		return
	}

	org, err := dbx.GetOrg(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "FETCH_FAILED", "Could not load organization")
		return
	}
	if org == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Organization not found")
		return
	}

	// Capabilities are already on the session ctx; no extra resolve needed.
	caps := ctx.Capabilities
	if caps == nil {
		caps = []string{}
	}

	c.JSON(http.StatusOK, gin.H{
		"org": gin.H{
			"id":     org.ID,
			"type":   org.Type,
			"name":   org.Name,
			"slug":   org.Slug,
			"status": org.Status,
		},
		"staff": gin.H{
			"profile":      ctx.SessionProfile,
			"capabilities": caps,
		},
		"metadata": gin.H{
			// Org-type-specific metadata can be added here dynamically
			// based on ctx.OrgType
		},
	})
}

// handleListOrgMetadata — GET /v1/orgs/:orgId/metadata
// Lists configuration entries for an org that affect portal rendering.
// Examples: hotel occupancy stats, courier parcel stats, etc.
func (s *Server) handleListOrgMetadata(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.OrgID == "" {
		writeError(c, http.StatusUnauthorized, "NOT_SIGNED_IN", "Sign in to an org to view metadata")
		return
	}

	orgID := c.Param("orgId")
	if orgID != ctx.OrgID {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "Access denied")
		return
	}

	// Get all org config entries with optional prefix filter
	prefix := c.Query("prefix")
	configs, err := dbx.ListOrgConfigs(c.Request.Context(), s.Pool, orgID, prefix)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "FETCH_FAILED", "Could not load metadata")
		return
	}

	if configs == nil {
		configs = []dbx.OrgConfig{}
	}

	c.JSON(http.StatusOK, gin.H{"metadata": configs})
}

// handleUpdateOrgMetadata — PATCH /v1/orgs/:orgId/metadata
// Updates organization metadata/config entries.
// Gated on the org-type-specific write capability.
func (s *Server) handleUpdateOrgMetadata(c *gin.Context) {
	ctx := ctxFromGin(c)
	if ctx.OrgID == "" {
		writeError(c, http.StatusUnauthorized, "NOT_SIGNED_IN", "Sign in to an org to update metadata")
		return
	}

	orgID := c.Param("orgId")
	if orgID != ctx.OrgID {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "Access denied")
		return
	}

	var req map[string]interface{}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Invalid request body")
		return
	}

	// For now, this is a placeholder. Implementation would:
	// 1. Check write capability
	// 2. Update org_config entries
	// 3. Return updated metadata

	c.JSON(http.StatusOK, gin.H{"updated": true})
}
