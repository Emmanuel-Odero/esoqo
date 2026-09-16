package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/payments"
)

type createBillRequest struct {
	Label              string        `json:"label" binding:"required"`
	Category           string        `json:"category" binding:"required"`
	AccountRef         *string       `json:"accountRef"`
	AmountKES          *money.Amount `json:"amountKes"`
	Cycle              string        `json:"cycle" binding:"required"`     // MONTHLY | WEEKLY | ONE_TIME
	NextDueAt          string        `json:"nextDueAt" binding:"required"` // RFC3339
	ReminderDaysBefore int           `json:"reminderDaysBefore"`
}

func (s *Server) handleCreateBill(c *gin.Context) {
	ctx := ctxFromGin(c)
	var req createBillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	nextDueAt, err := time.Parse(time.RFC3339, req.NextDueAt)
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "nextDueAt must be a valid date")
		return
	}

	billID, err := dbx.CreateBill(c.Request.Context(), s.Pool, dbx.CreateBillInput{
		PartyID: ctx.PartyID, Label: req.Label, Category: req.Category, AccountRef: req.AccountRef,
		AmountKES: req.AmountKES.KESPtr(), Cycle: req.Cycle, NextDueAt: nextDueAt, ReminderDaysBefore: req.ReminderDaysBefore,
	})
	if err != nil {
		writeSafeError(c, http.StatusBadRequest, "CREATE_FAILED", err, "Could not create this bill")
		return
	}
	c.JSON(http.StatusOK, gin.H{"billId": billID})
}

func (s *Server) handleListMyBills(c *gin.Context) {
	ctx := ctxFromGin(c)
	bills, err := dbx.ListMyBills(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your bills")
		return
	}
	c.JSON(http.StatusOK, gin.H{"bills": bills})
}

type markBillPaidRequest struct {
	AmountKES money.Amount `json:"amountKes" binding:"required"`
	Note      *string      `json:"note"`
}

func (s *Server) handleMarkBillPaid(c *gin.Context) {
	ctx := ctxFromGin(c)
	billID := c.Param("id")
	if !s.assertOwnsBill(c, billID, ctx.PartyID) {
		return
	}
	var req markBillPaidRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.MarkBillPaid(c.Request.Context(), s.Pool, billID, req.AmountKES.KES(), req.Note); err != nil {
		writeSafeError(c, http.StatusBadRequest, "MARK_PAID_FAILED", err, "Could not mark this bill paid")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type updateBillRequest struct {
	Label          *string       `json:"label"`
	AccountRef     *string       `json:"accountRef"`
	AmountKES      *money.Amount `json:"amountKes"`
	NextDueAt      *string       `json:"nextDueAt"`
	TargetKES      *money.Amount `json:"targetKes"`
	AutoPayEnabled *bool         `json:"autoPayEnabled"`
}

func (s *Server) handleUpdateBill(c *gin.Context) {
	ctx := ctxFromGin(c)
	billID := c.Param("id")
	if !s.assertOwnsBill(c, billID, ctx.PartyID) {
		return
	}
	var req updateBillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	in := dbx.UpdateBillInput{
		Label: req.Label, AccountRef: req.AccountRef, AmountKES: req.AmountKES.KESPtr(),
		TargetKES: req.TargetKES.KESPtr(), AutoPayEnabled: req.AutoPayEnabled,
	}
	if req.NextDueAt != nil {
		t, err := time.Parse(time.RFC3339, *req.NextDueAt)
		if err != nil {
			writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "nextDueAt must be a valid date")
			return
		}
		in.NextDueAt = &t
	}
	if err := dbx.UpdateBill(c.Request.Context(), s.Pool, billID, in); err != nil {
		writeError(c, http.StatusInternalServerError, "UPDATE_FAILED", "Could not update that bill")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) handleArchiveBill(c *gin.Context) {
	ctx := ctxFromGin(c)
	billID := c.Param("id")
	if !s.assertOwnsBill(c, billID, ctx.PartyID) {
		return
	}
	if err := dbx.ArchiveBill(c.Request.Context(), s.Pool, billID); err != nil {
		writeError(c, http.StatusInternalServerError, "ARCHIVE_FAILED", "Could not remove that bill")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── bill funding: guest-safe summary + contribute ──────────────────

// handleGetBillFunding — GET /v1/bills/:id/funding. Guest-safe (no
// authRequired): the whole point of a shareable funding link is that
// family/friends without an Esoqo account can open it. Returns only
// the PII-minimal projection (see dbx.BillFundingSummary's own
// comment) — never the owner's identity or accountRef.
func (s *Server) handleGetBillFunding(c *gin.Context) {
	summary, err := dbx.GetBillFundingSummary(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeBillFundingError(c, err)
		return
	}
	c.JSON(http.StatusOK, summary)
}

func (s *Server) handleListBillContributions(c *gin.Context) {
	rows, err := dbx.ListBillContributions(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load contributions")
		return
	}
	c.JSON(http.StatusOK, gin.H{"contributions": rows})
}

type contributeToBillRequest struct {
	ContributorName   string       `json:"contributorName" binding:"required"`
	ContributorMsisdn string       `json:"contributorMsisdn" binding:"required"`
	AmountKES         money.Amount `json:"amountKes" binding:"required"`
}

// handleContributeToBill — POST /v1/bills/:id/contributions.
// Guest-safe, same reasoning as handleGetBillFunding: a friend or
// family member contributing doesn't need an Esoqo account. A
// signed-in contributor's partyId is still captured (from the
// session, never trusted from the body) when present, same "guest OR
// authenticated" pattern handleCreateOrder already uses.
func (s *Server) handleContributeToBill(c *gin.Context) {
	var req contributeToBillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.ContributorMsisdn, "That phone number") {
		return
	}
	var contributorPartyID *string
	if token := bearerToken(c); token != "" {
		if ctx, _ := s.Session.CtxFromToken(c.Request.Context(), token, clientIP(c)); ctx != nil && ctx.PartyID != "" {
			contributorPartyID = &ctx.PartyID
		}
	}
	contributionID, err := dbx.ContributeToBill(c.Request.Context(), s.Pool, c.Param("id"), contributorPartyID, req.ContributorName, req.AmountKES.KES())
	if err != nil {
		writeBillFundingError(c, err)
		return
	}
	resp := gin.H{"contributionId": contributionID, "status": "PENDING_PAYMENT"}
	stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
		Msisdn: req.ContributorMsisdn, AmountKES: req.AmountKES.KES(),
		AccountReference: contributionID[:8], Description: "Bill contribution",
	})
	if err != nil {
		resp["paymentError"] = err.Error()
		c.JSON(http.StatusOK, resp)
		return
	}
	_ = dbx.AttachBillContributionCheckoutRequestID(c.Request.Context(), s.Pool, contributionID, stk.CheckoutRequestID)
	resp["checkoutRequestId"] = stk.CheckoutRequestID
	if stk.AutoConfirmed {
		if _, _, err := dbx.ConfirmBillContributionByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID); err == nil {
			resp["status"] = "PAID"
		}
	}
	c.JSON(http.StatusOK, resp)
}

func writeBillFundingError(c *gin.Context, err error) {
	switch err {
	case dbx.ErrBillNotFound:
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Bill not found")
	case dbx.ErrBillNotFunding:
		writeError(c, http.StatusBadRequest, "NOT_FUNDING", "This bill isn't accepting contributions")
	default:
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that bill")
	}
}

// assertOwnsBill writes its own error response and returns false when
// the signed-in person doesn't own billID — every mutating bill
// endpoint needs this same check, so it's factored out rather than
// repeated four times.
func (s *Server) assertOwnsBill(c *gin.Context, billID, partyID string) bool {
	owner, err := dbx.GetBillOwner(c.Request.Context(), s.Pool, billID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that bill")
		return false
	}
	if owner == "" {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Bill not found")
		return false
	}
	if owner != partyID {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "That is not your bill")
		return false
	}
	return true
}
