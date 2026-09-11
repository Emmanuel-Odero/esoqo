package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/audit"
)

func (s *Server) handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true, "service": "core-go", "ts": time.Now().UTC().Format(time.RFC3339)})
}

// handleReady mirrors services/core/src/index.ts's GET /ready: walks the
// audit hash chain and returns 503 the moment it finds a broken link, so
// this service never reports healthy while the audit trail is untrustworthy.
func (s *Server) handleReady(c *gin.Context) {
	result, err := audit.VerifyChain(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed, 200)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "reason": "readiness_check_failed"})
		return
	}
	if !result.OK {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "reason": "audit_chain_broken"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "auditEvents": result.Checked})
}
