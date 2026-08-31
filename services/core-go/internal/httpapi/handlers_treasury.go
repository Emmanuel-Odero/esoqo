package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/payments"
)

func (s *Server) handleGetTreasuryPolicy(c *gin.Context) {
	policy, err := dbx.GetTreasuryPolicy(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load treasury settings")
		return
	}
	c.JSON(http.StatusOK, policy)
}

type declareContributionRequest struct {
	AmountKES float64 `json:"amountKes" binding:"required"`
	Method    *string `json:"method"`
	Reference *string `json:"reference"`
	Note      *string `json:"note"`
}

func (s *Server) handleDeclareContribution(c *gin.Context) {
	ctx := ctxFromGin(c)
	var req declareContributionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	orgID := c.Param("id")
	contributionID, err := dbx.DeclareContribution(c.Request.Context(), s.Pool, orgID, ctx.PartyID, req.AmountKES, req.Method, req.Reference, req.Note)
	if err != nil {
		writeTreasuryError(c, err)
		return
	}

	resp := gin.H{"contributionId": contributionID, "status": "DECLARED"}

	// A member can pay by STK right away instead of waiting on an
	// officer's manual confirm — same convenience the checkout flows
	// elsewhere in the app already give.
	if req.Method != nil && *req.Method == "MPESA" {
		var msisdn string
		if profile, _ := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID); profile != nil && profile.Msisdn != nil {
			msisdn = *profile.Msisdn
		}
		if msisdn != "" {
			stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
				Msisdn: msisdn, AmountKES: req.AmountKES, AccountReference: contributionID[:8], Description: "Chama contribution",
			})
			if err == nil {
				_ = dbx.AttachContributionCheckoutRequestID(c.Request.Context(), s.Pool, contributionID, stk.CheckoutRequestID)
				resp["checkoutRequestId"] = stk.CheckoutRequestID
				if stk.AutoConfirmed {
					_ = dbx.ConfirmContributionByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, stk.MpesaReceiptCode)
					resp["status"] = "CONFIRMED"
				}
			}
		}
	}
	c.JSON(http.StatusOK, resp)
}

func (s *Server) handleConfirmContribution(c *gin.Context) {
	ctx := ctxFromGin(c)
	err := dbx.ConfirmContribution(c.Request.Context(), s.Pool, c.Param("cid"), ctx.PartyID)
	if err != nil {
		writeTreasuryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) handleListContributions(c *gin.Context) {
	contributions, err := dbx.ListContributions(c.Request.Context(), s.Pool, c.Param("id"), 50)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load contributions")
		return
	}
	c.JSON(http.StatusOK, gin.H{"contributions": contributions})
}

func (s *Server) handleGetGroupBalance(c *gin.Context) {
	balance, err := dbx.GetGroupBalance(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load the group's balance")
		return
	}
	c.JSON(http.StatusOK, gin.H{"balanceKes": balance})
}

type requestWithdrawalRequest struct {
	AmountKES   float64 `json:"amountKes" binding:"required"`
	Purpose     string  `json:"purpose" binding:"required"`
	PayeeName   string  `json:"payeeName" binding:"required"`
	PayeeMsisdn *string `json:"payeeMsisdn"`
	MeetingID   *string `json:"meetingId"`
}

func (s *Server) handleRequestWithdrawal(c *gin.Context) {
	ctx := ctxFromGin(c)
	var req requestWithdrawalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	withdrawalID, err := dbx.RequestWithdrawal(c.Request.Context(), s.Pool, dbx.RequestWithdrawalInput{
		OrgID: c.Param("id"), RequestedBy: ctx.PartyID, AmountKES: req.AmountKES,
		Purpose: req.Purpose, PayeeName: req.PayeeName, PayeeMsisdn: req.PayeeMsisdn, MeetingID: req.MeetingID,
	}, s.Cfg.SessionSecret)
	if err != nil {
		writeTreasuryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawalId": withdrawalID, "status": "PENDING_SIGNATURES"})
}

type signWithdrawalRequest struct {
	Decision string `json:"decision" binding:"required"` // APPROVE | REJECT
	Pin      string `json:"pin" binding:"required"`
}

func (s *Server) handleSignWithdrawal(c *gin.Context) {
	ctx := ctxFromGin(c)
	var req signWithdrawalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	result, err := dbx.SignWithdrawal(c.Request.Context(), s.Pool, c.Param("id"), ctx.PartyID, req.Decision, req.Pin, clientIP(c), s.Cfg.SessionSecret)
	if err != nil {
		writeTreasuryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": result.Status})
}

func (s *Server) handleListWithdrawals(c *gin.Context) {
	withdrawals, err := dbx.ListWithdrawals(c.Request.Context(), s.Pool, c.Param("id"), s.Cfg.SessionSecret, 20)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load withdrawals")
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawals": withdrawals})
}

func (s *Server) handleGetWithdrawal(c *gin.Context) {
	ctx := ctxFromGin(c)
	w, err := dbx.GetWithdrawal(c.Request.Context(), s.Pool, c.Param("id"), ctx.PartyID, s.Cfg.SessionSecret)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that withdrawal")
		return
	}
	if w == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Withdrawal not found")
		return
	}
	c.JSON(http.StatusOK, w)
}

func writeTreasuryError(c *gin.Context, err error) {
	if te, ok := err.(*dbx.TreasuryError); ok {
		status := http.StatusBadRequest
		switch te.Code {
		case "NOT_FOUND":
			status = http.StatusNotFound
		case "NOT_AN_OFFICER", "NOT_A_SIGNER", "WRONG_PIN":
			status = http.StatusForbidden
		}
		writeError(c, status, te.Code, te.Message)
		return
	}
	if err == dbx.ErrNotActiveMember {
		writeError(c, http.StatusForbidden, "NOT_A_MEMBER", err.Error())
		return
	}
	writeError(c, http.StatusBadRequest, "REQUEST_FAILED", err.Error())
}
