package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/payments"
)

// The admin "bank overview" surface: the platform's own Co-op
// settlement account (balance + statement, read straight from Co-op —
// nothing here is cached or derived) alongside the internal payout
// ledger every courier company's cut already clears through. Same
// parcels.read capability as the rest of the finance-facing parcels
// admin pages, since this is the same money.

// handleAdminGetBankBalance — GET /v1/admin/bank/balance. The
// platform's Co-op settlement account (COOP_SOURCE_ACCOUNT) balance,
// straight from Co-op — see payments.CoopGetAccountBalance.
func (s *Server) handleAdminGetBankBalance(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	if s.Cfg.CoopSourceAccount == "" {
		writeError(c, http.StatusNotFound, "NOT_CONFIGURED", "No Co-op settlement account configured (COOP_SOURCE_ACCOUNT)")
		return
	}
	bal, err := payments.CoopGetAccountBalance(s.Cfg, s.Cfg.CoopSourceAccount)
	if err != nil {
		writeError(c, http.StatusBadGateway, "COOP_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"balance": bal})
}

// handleAdminGetBankStatement — GET /v1/admin/bank/statement?start=YYYY-MM-DD&end=YYYY-MM-DD.
// Defaults to the last 30 days when either bound is missing, mirroring
// a typical "mini statement" view.
func (s *Server) handleAdminGetBankStatement(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	if s.Cfg.CoopSourceAccount == "" {
		writeError(c, http.StatusNotFound, "NOT_CONFIGURED", "No Co-op settlement account configured (COOP_SOURCE_ACCOUNT)")
		return
	}
	start := c.Query("start")
	end := c.Query("end")
	now := time.Now()
	if end == "" {
		end = now.Format("2006-01-02")
	}
	if start == "" {
		start = now.AddDate(0, 0, -30).Format("2006-01-02")
	}
	accountName, entries, err := payments.CoopGetAccountStatement(s.Cfg, s.Cfg.CoopSourceAccount, start, end)
	if err != nil {
		writeError(c, http.StatusBadGateway, "COOP_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"accountNumber": s.Cfg.CoopSourceAccount,
		"accountName":   accountName,
		"startDate":     start,
		"endDate":       end,
		"transactions":  entries,
	})
}

// handleAdminListParcelOrgPayoutOverview — GET
// /v1/admin/parcels/orgs/payout-overview. Per-company rollup of
// dbx.ListParcelOrgPayoutOverview: what's been paid, what's in flight,
// what needs a human — the internal counterpart to the Co-op balance
// above, since a courier company's "account" is a ledger liability, not
// a real bank account.
func (s *Server) handleAdminListParcelOrgPayoutOverview(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	rows, err := dbx.ListParcelOrgPayoutOverview(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load the payout overview")
		return
	}
	c.JSON(http.StatusOK, gin.H{"companies": rows})
}
