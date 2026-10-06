package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
)

type remitCounterCashRequest struct {
	StaffID   string       `json:"staffId" binding:"required"`
	AmountKes money.Amount `json:"amountKes"`
	Note      *string      `json:"note"`
}

// handleOrgRemitCounterCash — POST /v1/parcel-orgs/me/counter-cash/remit.
// A courier company's own manager counting a clerk's counter-intake
// cash in — handleOrgRemitCod's counterpart for a station desk instead
// of a rider's round. See dbx.RemitCounterCash.
func (s *Server) handleOrgRemitCounterCash(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgCounterCash)
	if orgID == "" {
		return
	}
	var req remitCounterCashRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	id, expected, err := dbx.RemitCounterCash(c.Request.Context(), s.Pool, orgID, req.StaffID, ctx.ActorID, req.AmountKes.KES(), req.Note)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"remittanceId": id,
		"amountKes":    req.AmountKes,
		"expectedKes":  money.AmountFromKES(expected),
		"shortfallKes": money.AmountOf(money.FromKES(expected) - req.AmountKes.Cents()),
	})
}
