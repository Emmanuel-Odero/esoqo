package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/payments"
)

type issueAllowanceBatchRequest struct {
	Purpose              string       `json:"purpose" binding:"required"` // FUEL | TRAVEL
	Label                string       `json:"label"`
	AmountPerEmployeeKES money.Amount `json:"amountPerEmployeeKes" binding:"required"`
	// EmployeeMsisdns — phone numbers, not party ids: same "resolve or
	// create a Person by msisdn" pattern gifting a single voucher
	// already uses (see handleCreateVoucher's RecipientMsisdn), just
	// looped for a batch.
	EmployeeMsisdns []string `json:"employeeMsisdns" binding:"required"`
	// EmployerMsisdn — the phone the STK push charges. Employer pays
	// once for the whole batch, same "one payment, plural effect" shape
	// as a table order's single checkout covering many line items.
	EmployerMsisdn string `json:"employerMsisdn" binding:"required"`
}

// handleIssueAllowanceBatch — POST /v1/me/voucher-batches. Self-funded
// only (see dbx.InitiateAllowanceVoucherBatch's own comment): the
// signed-in party is always the employer paying, never a party id
// taken from the body.
func (s *Server) handleIssueAllowanceBatch(c *gin.Context) {
	var req issueAllowanceBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.EmployerMsisdn, "The employer's phone number") {
		return
	}
	ctx := ctxFromGin(c)
	employeePartyIDs := make([]string, 0, len(req.EmployeeMsisdns))
	for _, msisdn := range req.EmployeeMsisdns {
		partyID, err := dbx.FindOrCreatePersonByMsisdn(c.Request.Context(), s.Pool, msisdn)
		if err != nil {
			writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Could not resolve "+msisdn)
			return
		}
		employeePartyIDs = append(employeePartyIDs, partyID)
	}
	batchID, totalKES, err := dbx.InitiateAllowanceVoucherBatch(c.Request.Context(), s.Pool, ctx.PartyID, req.Purpose, req.Label, req.AmountPerEmployeeKES.KES(), employeePartyIDs)
	if err != nil {
		if fe, ok := err.(*dbx.FleetError); ok {
			writeError(c, http.StatusBadRequest, fe.Code, fe.Message)
			return
		}
		writeError(c, http.StatusInternalServerError, "CREATE_FAILED", "Could not start that batch")
		return
	}

	resp := gin.H{"batchId": batchID, "totalKes": totalKES, "status": "PENDING_PAYMENT"}
	stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
		Msisdn: req.EmployerMsisdn, AmountKES: totalKES,
		AccountReference: batchID[:8], Description: "Allowance voucher batch",
	})
	if err != nil {
		resp["paymentError"] = err.Error()
		c.JSON(http.StatusOK, resp)
		return
	}
	_ = dbx.AttachVoucherBatchCheckoutRequestID(c.Request.Context(), s.Pool, batchID, stk.CheckoutRequestID)
	resp["checkoutRequestId"] = stk.CheckoutRequestID
	if stk.AutoConfirmed {
		if _, _, err := dbx.ConfirmVoucherBatchByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, "AUTO"); err == nil {
			resp["status"] = "ISSUED"
		}
	}
	c.JSON(http.StatusOK, resp)
}

func (s *Server) handleListVoucherBatches(c *gin.Context) {
	ctx := ctxFromGin(c)
	batches, err := dbx.ListVoucherBatches(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your batches")
		return
	}
	c.JSON(http.StatusOK, gin.H{"batches": batches})
}
