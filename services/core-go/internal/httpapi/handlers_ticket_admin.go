package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/dbx"
)

// Platform oversight — STAFF sessions (admin cookie forwarded as
// Bearer; session caps are frozen at sign-in, same as TS). Denied for
// owners: the directory is deliberately unscoped, a global grant only
// staff hold.

func (s *Server) handleAdminListTicketOrgs(c *gin.Context) {
	take, _ := strconv.Atoi(c.Query("take"))
	skip, _ := strconv.Atoi(c.Query("skip"))
	rows, total, err := dbx.ListTicketOrgsForStaff(c.Request.Context(), s.Pool, ctxFromGin(c),
		c.Query("status"), c.Query("vertical"), c.Query("search"), take, skip)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"rows": rows, "total": total})
}

func (s *Server) handleAdminTicketOrgCounts(c *gin.Context) {
	total, active, transport, err := dbx.GetTicketOrgCounts(c.Request.Context(), s.Pool, ctxFromGin(c))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"total": total, "active": active, "transport": transport, "events": total - transport,
	})
}

type adminSetOrgStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

func (s *Server) handleAdminSetTicketOrgStatus(c *gin.Context) {
	var req adminSetOrgStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.SetTicketOrgStatus(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Status); err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
