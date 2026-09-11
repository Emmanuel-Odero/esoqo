package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/payments"
)

// ── POST /v1/bookings/installment ────────────────────────────────
// Opens a "lipia pole pole" plan (GA classes, 48h+ out, deposit within
// [min, total]) and fires the STK push for the opening deposit —
// mirroring the TS actionCreateBooking installment branch, with the DAL
// now living here. Guest or authenticated (bearer optional, same as
// POST /v1/bookings).

type openPlanRequest struct {
	ScheduleID  string  `json:"scheduleId" binding:"required"`
	BuyerName   string  `json:"buyerName" binding:"required"`
	BuyerMsisdn string  `json:"buyerMsisdn" binding:"required"`
	BuyerEmail  *string `json:"buyerEmail"`
	DepositKES  float64 `json:"depositKes" binding:"required"`
	Lines       []struct {
		TicketClassID string  `json:"ticketClassId" binding:"required"`
		HolderName    *string `json:"holderName"`
		HolderMsisdn  *string `json:"holderMsisdn"`
	} `json:"lines" binding:"required"`
}

func (s *Server) handleOpenInstallmentPlan(c *gin.Context) {
	var req openPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	lines := make([]dbx.PlanLineInput, len(req.Lines))
	for i, l := range req.Lines {
		lines[i] = dbx.PlanLineInput{TicketClassID: l.TicketClassID, HolderName: l.HolderName, HolderMsisdn: l.HolderMsisdn}
	}

	plan, err := dbx.OpenInstallmentPlan(c.Request.Context(), s.Pool, dbx.OpenPlanInput{
		ScheduleID: req.ScheduleID, BuyerPartyID: optionalBuyerPartyID(c, s),
		BuyerName: req.BuyerName, BuyerMsisdn: req.BuyerMsisdn, BuyerEmail: req.BuyerEmail,
		Lines: lines, DepositKES: req.DepositKES,
	})
	if err != nil {
		writeInstallmentError(c, err)
		return
	}

	resp := gin.H{
		"bookingId": plan.BookingID, "status": plan.Status,
		"totalKes": plan.TotalKES, "balanceKes": plan.TotalKES,
		"balanceDueBy": plan.BalanceDueBy, "isInstallment": true,
	}

	stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
		Msisdn: req.BuyerMsisdn, AmountKES: plan.DepositKES,
		AccountReference: plan.BookingID[:8], Description: "Trip deposit",
	})
	if err != nil {
		resp["paymentError"] = err.Error()
		c.JSON(http.StatusOK, resp)
		return
	}
	_ = dbx.AttachBookingPaymentCheckoutRequestID(c.Request.Context(), s.Pool, plan.DepositPaymentID, stk.CheckoutRequestID)
	resp["checkoutRequestId"] = stk.CheckoutRequestID
	if stk.AutoConfirmed {
		_ = dbx.ConfirmInstallmentPaymentByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, stk.MpesaReceiptCode)
		if st, derr := dbx.GetInstallmentStatus(c.Request.Context(), s.Pool, plan.BookingID); derr == nil && st != nil {
			resp["status"] = st.Status
			resp["balanceKes"] = st.BalanceKES
		}
	}
	c.JSON(http.StatusOK, resp)
}

// ── POST /v1/bookings/:id/balance ────────────────────────────────
// Records a top-up against an open plan and fires the STK push for it.
// Auth mirrors TS createBookingBalancePayment: a signed-in buyer's
// booking requires the bearer to match; a guest booking's id is the
// secret (no bearer needed).

type payBalanceRequest struct {
	AmountKES float64 `json:"amountKes" binding:"required"`
}

func (s *Server) handlePayBookingBalance(c *gin.Context) {
	var req payBalanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	bookingID := c.Param("id")
	payment, err := dbx.CreateBalancePayment(c.Request.Context(), s.Pool, bookingID, optionalBuyerPartyID(c, s), req.AmountKES)
	if err != nil {
		writeInstallmentError(c, err)
		return
	}

	resp := gin.H{"paymentId": payment.ID}
	stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
		Msisdn: payment.Msisdn, AmountKES: payment.AmountKES,
		AccountReference: bookingID[:8], Description: "Trip balance",
	})
	if err != nil {
		resp["paymentError"] = err.Error()
		if st, derr := dbx.GetInstallmentStatus(c.Request.Context(), s.Pool, bookingID); derr == nil && st != nil {
			resp["status"] = st.Status
			resp["balanceKes"] = st.BalanceKES
		}
		c.JSON(http.StatusOK, resp)
		return
	}
	_ = dbx.AttachBookingPaymentCheckoutRequestID(c.Request.Context(), s.Pool, payment.ID, stk.CheckoutRequestID)
	resp["checkoutRequestId"] = stk.CheckoutRequestID
	if stk.AutoConfirmed {
		_ = dbx.ConfirmInstallmentPaymentByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, stk.MpesaReceiptCode)
	}
	if st, derr := dbx.GetInstallmentStatus(c.Request.Context(), s.Pool, bookingID); derr == nil && st != nil {
		resp["status"] = st.Status
		resp["balanceKes"] = st.BalanceKES
	} else {
		resp["status"] = "PARTIALLY_PAID"
	}
	c.JSON(http.StatusOK, resp)
}

// optionalBuyerPartyID resolves the bearer to a party when present —
// nil for guests. Never errors: an unresolvable token degrades to
// guest, the same contract as handleCreateBooking.
func optionalBuyerPartyID(c *gin.Context, s *Server) *string {
	if token := bearerToken(c); token != "" {
		if ctx, _ := s.Session.CtxFromToken(c.Request.Context(), token, clientIP(c)); ctx != nil && ctx.PartyID != "" {
			partyID := ctx.PartyID
			return &partyID
		}
	}
	return nil
}

func writeInstallmentError(c *gin.Context, err error) {
	if ierr, ok := err.(*dbx.InstallmentError); ok {
		status := http.StatusBadRequest
		switch ierr.Code {
		case "SCHEDULE_NOT_FOUND", "NOT_FOUND":
			status = http.StatusNotFound
		case "PAST_DUE":
			status = http.StatusGone
		case "OVERPAY", "DEPOSIT_TOO_LOW", "PLAN_NOT_ALLOWED", "BAD_INPUT":
			status = http.StatusBadRequest
		}
		writeError(c, status, ierr.Code, ierr.Message)
		return
	}
	writeError(c, http.StatusInternalServerError, "FAILED", "Could not complete that request")
}
