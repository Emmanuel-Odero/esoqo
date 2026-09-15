// Package httpapi (handlers_org_context.go) — unified crew identity
// (docs/proposals/esoqo-unified-crew-identity.md). Two surfaces:
//
//   - org-context/*    — a signed-in SUBJECT switching org-staff duty
//     on/off for themselves, always OTP-gated.
//   - ticketorgs/:id/staff-grants — an org owner/ADMIN-staff managing
//     who is eligible, and suspending/reinstating them.
package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// ── POST /v1/org-context/activate/request (authenticated) ──────────
// Step 1 of switching org-staff duty on: confirms a grant exists and is
// active, then sends an OTP to the caller's own verified number. Never
// PIN — see the proposal's "OTP required after any expiry" decision.

type activateRequestBody struct {
	OrgID string `json:"orgId" binding:"required"`
}

func (s *Server) handleOrgContextActivateRequest(c *gin.Context) {
	ctx := ctxFromGin(c)
	var req activateRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	grant, err := dbx.GetOrgStaffGrant(c.Request.Context(), s.Pool, req.OrgID, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GRANT_LOOKUP_FAILED", "Could not check your access")
		return
	}
	if grant == nil {
		writeError(c, http.StatusForbidden, "NO_GRANT", "You don't hold a staff role for that organisation")
		return
	}
	if grant.Status != "active" {
		writeError(c, http.StatusForbidden, "SUSPENDED", "Your access has been suspended. Contact your organisation's admin.")
		return
	}

	profile, err := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil || profile == nil || profile.Msisdn == nil {
		writeError(c, http.StatusInternalServerError, "PROFILE_LOOKUP_FAILED", "Could not send a verification code")
		return
	}

	result, err := s.OTP.IssueOtp(c.Request.Context(), *profile.Msisdn, authsvc.OtpStepUp, clientIP(c))
	if err != nil {
		writeOtpError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"expiresAt": result.ExpiresAt, "cooldownSeconds": result.CooldownSeconds})
}

// ── POST /v1/org-context/activate/verify (authenticated) ────────────
// Step 2: correct OTP + grant still active -> live activation, TTL-
// bound (s.OrgCtx.TTL(), config.Config.OrgContextActivationDays).
// Re-checks the grant again here too — it may have been suspended in
// the gap between request and verify.

type activateVerifyBody struct {
	OrgID string `json:"orgId" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

func (s *Server) handleOrgContextActivateVerify(c *gin.Context) {
	ctx := ctxFromGin(c)
	var req activateVerifyBody
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	profile, err := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil || profile == nil || profile.Msisdn == nil {
		writeError(c, http.StatusInternalServerError, "PROFILE_LOOKUP_FAILED", "Could not verify that code")
		return
	}

	ok, err := s.OTP.VerifyOtp(c.Request.Context(), *profile.Msisdn, authsvc.OtpStepUp, req.Code)
	if err != nil {
		writeOtpError(c, err)
		return
	}
	if !ok {
		writeError(c, http.StatusUnauthorized, "WRONG_CODE", "That code is not right")
		return
	}

	grant, err := dbx.GetOrgStaffGrant(c.Request.Context(), s.Pool, req.OrgID, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GRANT_LOOKUP_FAILED", "Could not check your access")
		return
	}
	if grant == nil || grant.Status != "active" {
		writeError(c, http.StatusForbidden, "SUSPENDED", "Your access has been suspended. Contact your organisation's admin.")
		return
	}

	if err := s.OrgCtx.Activate(c.Request.Context(), ctx.PartyID, req.OrgID, grant.Role); err != nil {
		writeError(c, http.StatusInternalServerError, "ACTIVATE_FAILED", "Could not switch you in")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "orgId": req.OrgID, "role": grant.Role, "ttlSeconds": int(s.OrgCtx.TTL().Seconds())})
}

// ── POST /v1/org-context/deactivate (authenticated) ──────────────────
// Deliberate "switch back to just me" — never required, but lets a
// person end staff duty early instead of waiting out the TTL.

func (s *Server) handleOrgContextDeactivate(c *gin.Context) {
	ctx := ctxFromGin(c)
	var req activateRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := s.OrgCtx.Deactivate(c.Request.Context(), ctx.PartyID, req.OrgID); err != nil {
		writeError(c, http.StatusInternalServerError, "DEACTIVATE_FAILED", "Could not switch you out")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── GET /v1/org-context/status (authenticated) ────────────────────────

func (s *Server) handleOrgContextStatus(c *gin.Context) {
	ctx := ctxFromGin(c)
	orgID := c.Query("orgId")
	if orgID == "" {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "orgId is required")
		return
	}
	activation, err := s.OrgCtx.Get(c.Request.Context(), ctx.PartyID, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "STATUS_LOOKUP_FAILED", "Could not check your status")
		return
	}
	c.JSON(http.StatusOK, gin.H{"active": activation != nil})
}

// ── GET /v1/me/org-grants (authenticated) ─────────────────────────────
// The switcher's data source: every org this person can additionally
// act for, and whether they're currently switched in.

func (s *Server) handleListMyOrgGrants(c *gin.Context) {
	ctx := ctxFromGin(c)
	grants, err := dbx.ListOrgStaffGrantsForParty(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GRANTS_LOOKUP_FAILED", "Could not load your staff roles")
		return
	}
	out := make([]gin.H, 0, len(grants))
	for _, g := range grants {
		activation, _ := s.OrgCtx.Get(c.Request.Context(), ctx.PartyID, g.OrgID)
		out = append(out, gin.H{
			"orgId":        g.OrgID,
			"orgName":      g.OrgName,
			"role":         g.Role,
			"status":       g.Status,
			"active":       activation != nil,
			"crewMemberId": g.CrewMemberID,
		})
	}
	c.JSON(http.StatusOK, gin.H{"grants": out})
}

// ── ticketorgs/:id/staff-grants (authenticated, owner/ADMIN-staff) ────

type createStaffGrantRequest struct {
	Msisdn string `json:"msisdn" binding:"required"`
	Role   string `json:"role" binding:"required"` // SCANNER | MANAGER | ADMIN | CREW
	// CrewMemberID — only meaningful for role "CREW"; see
	// dbx.CreateOrgStaffGrant's own comment on the contract.
	CrewMemberID *string `json:"crewMemberId"`
}

// handleCreateOrgStaffGrant — deliberately requires an existing Esoqo
// account (found by msisdn) rather than provisioning one: "every crew
// member has used Esoqo" is a product decision, not just a technical
// default, so there is no account-less onboarding path here at all.
func (s *Server) handleCreateOrgStaffGrant(c *gin.Context) {
	ctx := ctxFromGin(c)
	orgID := c.Param("id")
	var req createStaffGrantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	person, err := dbx.FindPersonByMsisdn(c.Request.Context(), s.Pool, req.Msisdn)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LOOKUP_FAILED", "Could not look up that number")
		return
	}
	if person == nil {
		writeError(c, http.StatusNotFound, "NO_ACCOUNT",
			"That number doesn't have an Esoqo account yet. Crew need their own account before they can be added as staff.")
		return
	}

	grant, err := dbx.CreateOrgStaffGrant(c.Request.Context(), s.Pool, ctx, orgID, person.PartyID, req.Role, req.CrewMemberID)
	if err != nil {
		if orgErr, ok := err.(*dbx.OrgError); ok {
			writeError(c, http.StatusBadRequest, orgErr.Code, orgErr.Message)
			return
		}
		if authErr, ok := err.(*authsvc.AuthorisationError); ok {
			writeError(c, http.StatusForbidden, "DENIED", authErr.Error())
			return
		}
		writeError(c, http.StatusInternalServerError, "GRANT_CREATE_FAILED", "Could not add that staff member")
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": grant.ID, "orgId": grant.OrgID, "partyId": grant.PartyID, "role": grant.Role, "status": grant.Status})
}

func (s *Server) handleListOrgStaffGrants(c *gin.Context) {
	ctx := ctxFromGin(c)
	orgID := c.Param("id")
	grants, err := dbx.ListOrgStaffGrantsForOrg(c.Request.Context(), s.Pool, ctx, orgID)
	if err != nil {
		if authErr, ok := err.(*authsvc.AuthorisationError); ok {
			writeError(c, http.StatusForbidden, "DENIED", authErr.Error())
			return
		}
		writeError(c, http.StatusInternalServerError, "GRANTS_LOOKUP_FAILED", "Could not load staff")
		return
	}
	out := make([]gin.H, 0, len(grants))
	for _, g := range grants {
		out = append(out, gin.H{
			"partyId": g.PartyID, "partyName": g.PartyName, "msisdn": g.PartyMsisdn,
			"role": g.Role, "status": g.Status, "suspendedAt": g.SuspendedAt,
			"crewMemberId": g.CrewMemberID,
		})
	}
	c.JSON(http.StatusOK, gin.H{"staff": out})
}

func (s *Server) handleSuspendOrgStaffGrant(c *gin.Context) {
	ctx := ctxFromGin(c)
	orgID := c.Param("id")
	partyID := c.Param("partyId")

	if err := dbx.SuspendOrgStaffGrant(c.Request.Context(), s.Pool, ctx, orgID, partyID); err != nil {
		if err == dbx.ErrGrantNotFound {
			writeError(c, http.StatusNotFound, "NOT_FOUND", "No staff grant found for that person")
			return
		}
		if authErr, ok := err.(*authsvc.AuthorisationError); ok {
			writeError(c, http.StatusForbidden, "DENIED", authErr.Error())
			return
		}
		writeError(c, http.StatusInternalServerError, "SUSPEND_FAILED", "Could not suspend that staff member")
		return
	}
	// Kill any live session immediately — the whole point of a
	// suspension being an admin action rather than "wait out the TTL".
	if err := s.OrgCtx.Deactivate(c.Request.Context(), partyID, orgID); err != nil {
		writeError(c, http.StatusInternalServerError, "SUSPEND_FAILED", "Suspended, but could not end their live session — try again")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleReinstateOrgStaffGrant only clears the suspension flag. It does
// not, and must not, restore a live activation — see
// dbx.ReinstateOrgStaffGrant's own comment.
func (s *Server) handleReinstateOrgStaffGrant(c *gin.Context) {
	ctx := ctxFromGin(c)
	orgID := c.Param("id")
	partyID := c.Param("partyId")

	if err := dbx.ReinstateOrgStaffGrant(c.Request.Context(), s.Pool, ctx, orgID, partyID); err != nil {
		if err == dbx.ErrGrantNotFound {
			writeError(c, http.StatusNotFound, "NOT_FOUND", "No suspended grant found for that person")
			return
		}
		if authErr, ok := err.(*authsvc.AuthorisationError); ok {
			writeError(c, http.StatusForbidden, "DENIED", authErr.Error())
			return
		}
		writeError(c, http.StatusInternalServerError, "REINSTATE_FAILED", "Could not reinstate that staff member")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
