package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/dbx"
)

// orgContextHeader — a SUBJECT that has activated staff duty for one org
// (see authsvc.OrgContextService / docs/proposals/
// esoko-unified-crew-identity.md) sends this on org-scoped requests to
// say which org they mean to act for. Absence just means "acting as
// myself" — it is never required, and never trusted on its own; see the
// live re-check below.
const orgContextHeader = "X-Esoko-Org-Context"

const ctxKey = "esoko_ctx"

// authRequired is the mobile equivalent of ctxFromToken in
// packages/auth/src/session.ts: the only place a Ctx is built from a
// request, and it never trusts a header for anything but the opaque
// bearer token itself — the token is looked up in Redis, same as the
// cookie-based web sessions, just carried differently in transport.
func (s *Server) authRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		token, ok := strings.CutPrefix(authHeader, "Bearer ")
		if !ok || token == "" {
			writeError(c, http.StatusUnauthorized, "UNAUTHENTICATED", "Sign in required")
			c.Abort()
			return
		}

		ctx, err := s.Session.CtxFromToken(c.Request.Context(), token, clientIP(c))
		if err != nil {
			writeError(c, http.StatusInternalServerError, "SESSION_LOOKUP_FAILED", "Could not verify session")
			c.Abort()
			return
		}
		if ctx == nil {
			writeError(c, http.StatusUnauthorized, "SESSION_EXPIRED", "Sign in again")
			c.Abort()
			return
		}

		if ctx.ActorType == authsvc.ActorSubject {
			if orgID := c.GetHeader(orgContextHeader); orgID != "" {
				s.layerOrgStaffCapabilities(c, ctx, orgID)
			}
		}

		c.Set(ctxKey, *ctx)
		c.Next()
	}
}

// layerOrgStaffCapabilities — mutates ctx in place to add the
// TicketingStaffCapabilities bundle for orgID, but only when BOTH a live
// activation exists (Redis, OTP-gated, TTL-bound) AND the underlying
// grant is still active in Postgres right now — checked on every
// request, not cached from activation time, so an org admin's suspend
// call takes effect on the very next request even if the Redis key
// hasn't expired yet. A miss here is silent: the request proceeds as a
// plain SUBJECT, and any org-scoped capability check simply denies via
// the normal deny-by-default path (see dbx.AssertOwnsOrg).
func (s *Server) layerOrgStaffCapabilities(c *gin.Context, ctx *authsvc.Ctx, orgID string) {
	activation, err := s.OrgCtx.Get(c.Request.Context(), ctx.PartyID, orgID)
	if err != nil || activation == nil {
		return
	}
	grant, err := dbx.GetOrgStaffGrant(c.Request.Context(), s.Pool, orgID, ctx.PartyID)
	if err != nil || grant == nil || grant.Status != "active" {
		return
	}
	bundle, ok := authsvc.TicketingStaffCapabilities[grant.Role]
	if !ok {
		return
	}
	ctx.TicketOrgID = orgID
	ctx.Capabilities = append(ctx.Capabilities, bundle...)
}

func ctxFromGin(c *gin.Context) authsvc.Ctx {
	v, _ := c.Get(ctxKey)
	ctx, _ := v.(authsvc.Ctx)
	return ctx
}

// bearerToken reads the raw token off an optional Authorization header
// — for routes that behave differently for a signed-in buyer vs a guest
// without requiring one (see handleCreateOrder/handleCreateBooking).
func bearerToken(c *gin.Context) string {
	token, _ := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
	return token
}
