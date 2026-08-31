package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/dbx"
)

type createBillRequest struct {
	Label              string   `json:"label" binding:"required"`
	Category           string   `json:"category" binding:"required"`
	AccountRef         *string  `json:"accountRef"`
	AmountKES          *float64 `json:"amountKes"`
	Cycle              string   `json:"cycle" binding:"required"`     // MONTHLY | WEEKLY | ONE_TIME
	NextDueAt          string   `json:"nextDueAt" binding:"required"` // RFC3339
	ReminderDaysBefore int      `json:"reminderDaysBefore"`
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
		AmountKES: req.AmountKES, Cycle: req.Cycle, NextDueAt: nextDueAt, ReminderDaysBefore: req.ReminderDaysBefore,
	})
	if err != nil {
		writeError(c, http.StatusBadRequest, "CREATE_FAILED", err.Error())
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
	AmountKES float64 `json:"amountKes" binding:"required"`
	Note      *string `json:"note"`
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
	if err := dbx.MarkBillPaid(c.Request.Context(), s.Pool, billID, req.AmountKES, req.Note); err != nil {
		writeError(c, http.StatusBadRequest, "MARK_PAID_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type updateBillRequest struct {
	Label      *string  `json:"label"`
	AccountRef *string  `json:"accountRef"`
	AmountKES  *float64 `json:"amountKes"`
	NextDueAt  *string  `json:"nextDueAt"`
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
	in := dbx.UpdateBillInput{Label: req.Label, AccountRef: req.AccountRef, AmountKES: req.AmountKES}
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
