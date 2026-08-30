package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/authsvc"
)

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

		c.Set(ctxKey, *ctx)
		c.Next()
	}
}

func ctxFromGin(c *gin.Context) authsvc.Ctx {
	v, _ := c.Get(ctxKey)
	ctx, _ := v.(authsvc.Ctx)
	return ctx
}
