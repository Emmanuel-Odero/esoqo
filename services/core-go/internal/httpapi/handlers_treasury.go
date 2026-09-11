package httpapi

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/audit"
	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/notify"
	"github.com/esoko/core-go/internal/payments"
)

// recordTreasuryAudit — every treasury audit row is targetType "group",
// targetId the org's own partyId, regardless of which sub-entity
// (contribution, withdrawal) the action is actually about — that's
// deliberate: it's what lets dbx.GroupTimeline read one group's whole
// history with a single indexed WHERE, instead of a UNION across
// several ID spaces the caller would have to already know about. The
// sub-entity's own id still goes in payload (contributionId/
// withdrawalId), so nothing is lost, just not used as the join key.
func (s *Server) recordTreasuryAudit(c *gin.Context, action, orgID string, payload map[string]interface{}) {
	ctx := ctxFromGin(c)
	actorType := string(ctx.ActorType)
	if !ctx.Verified || actorType == "" {
		actorType = "SYSTEM"
	}
	var actorID *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		actorID = &id
	}
	var ip *string
	if v := clientIP(c); v != "" {
		ip = &v
	}
	targetType := "group"
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: actorType, ActorID: actorID, IP: ip},
		audit.Input{Action: action, TargetType: &targetType, TargetID: &orgID, Payload: payload})
}

// notifyContributionConfirmed — "the cheapest, highest-trust part of
// the feature" per the group-treasury proposal: every active member
// gets an SMS the moment a contribution is confirmed, not "the
// treasurer will tell you at the next meeting". Best-effort by design,
// same reasoning as recordFleetAudit: a missing text is a
// communication gap, not a reason to fail a payment that already
// cleared. Also records the "confirmed" audit row that feeds
// dbx.GroupTimeline — the two always happen together, so one call does
// both rather than asking every caller to remember both steps.
func (s *Server) notifyContributionConfirmed(c *gin.Context, contributionID string) {
	ctx := c.Request.Context()
	detail, err := dbx.GetContributionNotifyDetail(ctx, s.Pool, contributionID)
	if err != nil || detail == nil {
		return
	}
	balance, err := dbx.GetGroupBalance(ctx, s.Pool, detail.OrgID)
	balanceText := "?"
	if err == nil {
		balanceText = fmt.Sprintf("%.2f", balance)
	}
	s.recordTreasuryAudit(c, "treasury.contribution.confirmed", detail.OrgID, map[string]interface{}{
		"contributionId":  contributionID,
		"contributorName": detail.ContributorName,
		"amountKes":       detail.AmountKES,
		"newBalanceKes":   balanceText,
	})

	members, err := dbx.ActiveMemberContacts(ctx, s.Pool, detail.OrgID)
	if err != nil {
		return
	}
	message := notify.ContributionConfirmed(detail.AmountKES, detail.ContributorName, detail.OrgName, balanceText, contributionID[:8])
	for _, m := range members {
		if m.Msisdn == nil || *m.Msisdn == "" {
			continue
		}
		_ = authsvc.SendSms(*m.Msisdn, message, "TREASURY_CONTRIBUTION")
	}
}

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

	contributorName := ctx.PartyID
	if profile, _ := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID); profile != nil {
		if profile.KnownAs != nil && *profile.KnownAs != "" {
			contributorName = *profile.KnownAs
		} else {
			contributorName = profile.OfficialName
		}
	}
	method := "DECLARED"
	if req.Method != nil {
		method = *req.Method
	}
	s.recordTreasuryAudit(c, "treasury.contribution.declared", orgID, map[string]interface{}{
		"contributionId":  contributionID,
		"contributorName": contributorName,
		"amountKes":       fmt.Sprintf("%.2f", req.AmountKES),
		"method":          method,
	})

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
					if _, alreadyConfirmed, cerr := dbx.ConfirmContributionByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, stk.MpesaReceiptCode); cerr == nil {
						resp["status"] = "CONFIRMED"
						if !alreadyConfirmed {
							s.notifyContributionConfirmed(c, contributionID)
						}
					}
				}
			}
		}
	}
	c.JSON(http.StatusOK, resp)
}

func (s *Server) handleConfirmContribution(c *gin.Context) {
	ctx := ctxFromGin(c)
	contributionID := c.Param("cid")
	alreadyConfirmed, err := dbx.ConfirmContribution(c.Request.Context(), s.Pool, contributionID, ctx.PartyID)
	if err != nil {
		writeTreasuryError(c, err)
		return
	}
	if !alreadyConfirmed {
		s.notifyContributionConfirmed(c, contributionID)
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
	orgID := c.Param("id")
	withdrawalID, err := dbx.RequestWithdrawal(c.Request.Context(), s.Pool, dbx.RequestWithdrawalInput{
		OrgID: orgID, RequestedBy: ctx.PartyID, AmountKES: req.AmountKES,
		Purpose: req.Purpose, PayeeName: req.PayeeName, PayeeMsisdn: req.PayeeMsisdn, MeetingID: req.MeetingID,
	}, s.Cfg.SessionSecret)
	if err != nil {
		writeTreasuryError(c, err)
		return
	}
	s.recordTreasuryAudit(c, "treasury.withdrawal.requested", orgID, map[string]interface{}{
		"withdrawalId": withdrawalID,
		"amountKes":    fmt.Sprintf("%.2f", req.AmountKES),
		"purpose":      req.Purpose,
		"payeeName":    req.PayeeName,
	})
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
	withdrawalID := c.Param("id")
	result, err := dbx.SignWithdrawal(c.Request.Context(), s.Pool, withdrawalID, ctx.PartyID, req.Decision, req.Pin, clientIP(c), s.Cfg.SessionSecret)
	if err != nil {
		writeTreasuryError(c, err)
		return
	}

	// GetWithdrawal here is a read the sign call already has everything
	// to avoid, but the payload wants amount/payee for a self-contained
	// timeline line — one extra query on a PIN-gated write is a
	// reasonable trade against every reader re-deriving that text later.
	signerName := ctx.PartyID
	if profile, _ := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID); profile != nil {
		if profile.KnownAs != nil && *profile.KnownAs != "" {
			signerName = *profile.KnownAs
		} else {
			signerName = profile.OfficialName
		}
	}
	// Execution itself never happens here — SignWithdrawal only ever
	// returns REJECTED or PENDING_SIGNATURES; a withdrawal moves to
	// EXECUTED/EXPIRED strictly from the periodic sweep (see
	// RecordWithdrawalOutcome, called from cmd/api/main.go's ticker),
	// never on the request that got a signature onto it — the standby
	// window's whole point is that nobody's own action short-circuits it.
	if w, werr := dbx.GetWithdrawal(c.Request.Context(), s.Pool, withdrawalID, ctx.PartyID, s.Cfg.SessionSecret); werr == nil && w != nil {
		s.recordTreasuryAudit(c, "treasury.withdrawal.signed", w.OrgID, map[string]interface{}{
			"withdrawalId":    withdrawalID,
			"decision":        req.Decision,
			"signerName":      signerName,
			"resultingStatus": result.Status,
			"amountKes":       w.AmountKES,
			"payeeName":       w.PayeeName,
		})
	}
	c.JSON(http.StatusOK, gin.H{"status": result.Status})
}

// notifyGroup — a plain SMS to every active member, for moments the
// group-treasury proposal calls out explicitly as needing an
// "everybody gets a copy" broadcast, distinct from
// notifyContributionConfirmed's contribution-specific wording.
// Best-effort, same reasoning throughout this file.
func (s *Server) notifyGroup(ctx context.Context, orgID, message string) {
	members, err := dbx.ActiveMemberContacts(ctx, s.Pool, orgID)
	if err != nil {
		return
	}
	for _, m := range members {
		if m.Msisdn == nil || *m.Msisdn == "" {
			continue
		}
		_ = authsvc.SendSms(*m.Msisdn, message, "TREASURY_WITHDRAWAL")
	}
}

// recordSystemTreasuryAudit is recordTreasuryAudit's counterpart for
// events with no request behind them at all — the withdrawal sweep
// runs from a ticker in cmd/api/main.go, not a handler, so there is no
// gin.Context to pull an actor/IP from; SYSTEM is the correct actor
// here the same way it already is for other unattended writes.
func (s *Server) recordSystemTreasuryAudit(ctx context.Context, action, orgID string, payload map[string]interface{}) {
	targetType := "group"
	_, _ = audit.RecordAudit(ctx, s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: "SYSTEM"}, audit.Input{Action: action, TargetType: &targetType, TargetID: &orgID, Payload: payload})
}

// RecordWithdrawalOutcome — exported for cmd/api/main.go's sweep loop
// to call once per row SweepDueWithdrawals actually moved to EXECUTED
// or EXPIRED: the audit row that closes out that withdrawal's line in
// dbx.GroupTimeline, plus the "everybody gets a copy" SMS closing the
// loop the same way any other posting already does.
func (s *Server) RecordWithdrawalOutcome(ctx context.Context, w dbx.ExecutedWithdrawal) {
	action := "treasury.withdrawal.executed"
	message := fmt.Sprintf("Withdrawal of KES %s to %s executed — ref %s", w.AmountKES, w.PayeeName, w.ID[:8])
	if w.Status == "EXPIRED" {
		action = "treasury.withdrawal.expired"
		message = fmt.Sprintf(
			"Withdrawal of KES %s for %s expired — threshold not reached in time. Re-raise it if it's still needed.",
			w.AmountKES, w.PayeeName)
	}
	s.recordSystemTreasuryAudit(ctx, action, w.OrgID, map[string]interface{}{
		"withdrawalId": w.ID,
		"amountKes":    w.AmountKES,
		"payeeName":    w.PayeeName,
	})
	s.notifyGroup(ctx, w.OrgID, message)
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

// handleGroupTimeline — GET /v1/groups/:id/timeline. Member-visible by
// construction (dbx.GroupTimeline requires active membership, unlike
// several sibling reads in this file — see that function's own note).
func (s *Server) handleGroupTimeline(c *gin.Context) {
	ctx := ctxFromGin(c)
	entries, err := dbx.GroupTimeline(c.Request.Context(), s.Pool, c.Param("id"), ctx.PartyID, 100)
	if err != nil {
		writeTreasuryError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": entries})
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
