package httpapi

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/audit"
)

// handleHealth is the Kubernetes liveness probe (httpGet /health). It used
// to return 200 unconditionally, which meant a
// service with an unreachable database, a wrong DATABASE_URL or a schema
// that had never been migrated still reported healthy — the deploy went
// green while every real request 500'd.
//
// Deliberately a cheap dependency ping, not /ready's audit-chain walk: a
// liveness probe that fails on a data-integrity problem turns one broken
// audit link into a restart loop and takes the whole service down.
// Reachability is the question here; correctness is /ready's.
func (s *Server) handleHealth(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	if err := s.Pool.Ping(ctx); err != nil {
		log.Printf("core-go: health check failed: database unreachable: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "service": "core-go", "reason": "database_unreachable"})
		return
	}
	if err := s.Redis.Ping(ctx).Err(); err != nil {
		// Sessions and every rate limit live in Redis — without it the
		// service cannot authenticate anyone.
		log.Printf("core-go: health check failed: redis unreachable: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "service": "core-go", "reason": "redis_unreachable"})
		return
	}

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
