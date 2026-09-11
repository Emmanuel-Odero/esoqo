package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/dbx"
)

// GET /v1/admin/fraud/summary — staff-only ops overview (24h outcomes +
// reuse suspects). Crew sessions (fare.verify) are denied: the directory
// is deliberately unscoped, same contract as handleAdminListTicketOrgs.
func (s *Server) handleFraudSummary(c *gin.Context) {
	sum, err := dbx.GetFraudSummary(c.Request.Context(), s.Pool, ctxFromGin(c))
	if err != nil {
		if _, ok := err.(*authsvc.AuthorisationError); ok {
			writeError(c, http.StatusForbidden, "DENIED", "Staff access required")
			return
		}
		writeError(c, http.StatusInternalServerError, "SUMMARY_FAILED", "Could not load fraud summary")
		return
	}
	c.JSON(http.StatusOK, gin.H{"summary": sum})
}
