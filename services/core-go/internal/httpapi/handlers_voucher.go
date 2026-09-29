package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/fleetqr"
	"github.com/esoqo/core-go/internal/loyalty"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/notify"
	"github.com/esoqo/core-go/internal/payments"
)

type spendVoucherAtBusinessRequest struct {
	// The business's Esoqo ID — scanned or typed, same identifier the
	// public /pay page accepts.
	BusinessID string       `json:"businessId" binding:"required"`
	AmountKES  money.Amount `json:"amountKes" binding:"required"`
	// Caller-supplied idempotency key. A retry with the same value is a
	// no-op (see SpendVoucher's own EXISTS check) rather than a second
	// charge — the same guarantee refId gives every other SpendVoucher
	// caller in dbx.
	RefID string `json:"refId" binding:"required"`
}

// POST /v1/vouchers/:id/pay-business — spend a SHOPPING|GENERAL voucher's
// balance to pay a business, no M-Pesa leg. Stays inside the closed loop
// this platform already runs for a store checkout's VOUCHER payment
// method (see dbx.SettleStoreOrderVoucher) — the only thing new is that
// the payee is any Esoqo business, not one specific StoreOrder.
func (s *Server) handleSpendVoucherAtBusiness(c *gin.Context) {
	var req spendVoucherAtBusinessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	result, err := dbx.SpendVoucherAtBusiness(c.Request.Context(), s.Pool, ctx, c.Param("id"), req.BusinessID, req.AmountKES.KES(), req.RefID)
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"voucher":      voucherToJSON(result.Voucher, s.Cfg.FleetQrSecret),
		"businessName": result.BusinessName,
		"businessId":   result.BusinessID,
	})
}

type createVoucherRequest struct {
	Label           string       `json:"label"`
	Purpose         string       `json:"purpose"`
	AmountKES       money.Amount `json:"amountKes"`
	RecipientMsisdn string       `json:"recipientMsisdn"`
	LoadMethod      string       `json:"loadMethod"`
	BuyerMsisdn     string       `json:"buyerMsisdn"`
	ExpiresInDays   *int         `json:"expiresInDays"`
}

func voucherToJSON(v *dbx.Voucher, qrSecret string) gin.H {
	return gin.H{
		"id": v.ID, "label": v.Label, "purpose": v.Purpose, "status": v.Status,
		"shortCode": v.ShortCode, "qrToken": v.QrToken,
		"qrPayload":     fleetqr.VoucherPayload(v.ID, fleetqr.Sign(qrSecret, "voucher", v.ID)),
		"balancePoints": v.BalancePoints, "balanceKes": v.BalanceKES,
		"ownerPartyId": v.OwnerPartyID, "giftedByPartyId": v.GiftedByPartyID,
		"expiresAt": v.ExpiresAt, "createdAt": v.CreatedAt,
	}
}

// sendVoucherLoadedSms — "value landed on your card", best-effort.
//
// Every path that credits a card funnels through here rather than
// composing its own text: there are four of them (create-with-load,
// top-up, the loyalty conversions, and the async M-Pesa callback) and
// a cardholder must not be able to tell which one ran. Silent when
// there's no phone on file for the owner — see GetVoucherNotifyDetail.
func (s *Server) sendVoucherLoadedSms(c *gin.Context, load dbx.VoucherLoadResult, method string) {
	if load.VoucherID == "" || load.CreditedKES <= 0 {
		return
	}
	s.sendVoucherCreditedSms(c, load.VoucherID, load.CreditedKES, method)
}

// sendVoucherCreditedSms is the same send for callers that already know
// the card and the amount without a VoucherLoadResult to hand (the
// loyalty paths, which never touch M-Pesa at all).
//
// A gifted card gets the gift wording instead on its very first credit:
// somebody who did not buy the card and may not know Esoqo needs to be
// told who sent it, not handed a balance update for a card they have
// never heard of.
func (s *Server) sendVoucherCreditedSms(c *gin.Context, voucherID string, amountKES float64, method string) {
	detail, err := dbx.GetVoucherNotifyDetail(c.Request.Context(), s.Pool, voucherID)
	if err != nil || detail == nil {
		return
	}
	msg := notify.VoucherLoaded(amountKES, detail.Label, detail.ShortCode, detail.BalanceKES, method)
	if detail.GiftedByName != "" && detail.BalanceKES <= amountKES {
		msg = notify.VoucherGifted(amountKES, detail.GiftedByName, detail.Label, detail.ShortCode)
	}
	_ = authsvc.SendSms(detail.OwnerMsisdn, msg, "VOUCHER_LOADED")
}

// POST /v1/vouchers — create card, optionally load via M-Pesa STK or loyalty.
func (s *Server) handleCreateVoucher(c *gin.Context) {
	if !s.Cfg.VouchersEnabled {
		writeError(c, http.StatusForbidden, "DISABLED", "Vouchers are disabled")
		return
	}
	var req createVoucherRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !optionalMsisdnString(c, &req.RecipientMsisdn, "The recipient's phone number") {
		return
	}
	if !optionalMsisdnString(c, &req.BuyerMsisdn, "The buyer's phone number") {
		return
	}
	ctx := ctxFromGin(c)
	if ctx.PartyID == "" {
		writeError(c, http.StatusUnauthorized, "UNAUTHENTICATED", "Sign in required")
		return
	}
	purpose := strings.ToUpper(strings.TrimSpace(req.Purpose))
	if purpose == "" {
		purpose = "GENERAL"
	}
	ownerParty := ctx.PartyID
	var giftedBy *string
	if msisdn := strings.TrimSpace(req.RecipientMsisdn); msisdn != "" && msisdn != ctx.PartyID {
		// Gift: resolve recipient person; uses same msisdn identity as OTP.
		partyID, err := dbx.FindOrCreatePersonByMsisdn(c.Request.Context(), s.Pool, msisdn)
		if err != nil {
			writeError(c, http.StatusInternalServerError, "CREATE_FAILED", "Could not resolve recipient")
			return
		}
		ownerParty = partyID
		g := ctx.PartyID
		giftedBy = &g
	}
	var expiresAt *time.Time
	if req.ExpiresInDays != nil && *req.ExpiresInDays > 0 {
		t := time.Now().AddDate(0, 0, *req.ExpiresInDays)
		expiresAt = &t
	}
	v, err := dbx.CreateVoucher(c.Request.Context(), s.Pool, ctx, &ownerParty, giftedBy, req.Label, purpose, expiresAt, s.Cfg.FleetQrSecret)
	if err != nil {
		writeFleetError(c, err)
		return
	}
	resp := voucherToJSON(v, s.Cfg.FleetQrSecret)

	loadMethod := strings.ToUpper(strings.TrimSpace(req.LoadMethod))
	if req.AmountKES.KES() > 0 && loadMethod != "LOYALTY" {
		msisdn := strings.TrimSpace(req.BuyerMsisdn)
		if msisdn == "" {
			// Fall back to own profile msisdn.
			if p, _ := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID); p != nil && p.Msisdn != nil {
				msisdn = *p.Msisdn
			}
		}
		if msisdn == "" {
			resp["paymentError"] = "buyerMsisdn required for M-Pesa load"
			c.JSON(http.StatusCreated, gin.H{"voucher": resp})
			return
		}
		points := loyalty.PointsForKES(req.AmountKES.KES())
		stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
			Msisdn: msisdn, AmountKES: req.AmountKES.KES(),
			AccountReference: v.ShortCode, Description: "Voucher load",
		})
		if err != nil {
			resp["paymentError"] = err.Error()
			c.JSON(http.StatusCreated, gin.H{"voucher": resp})
			return
		}
		_ = dbx.AttachVoucherCheckoutRequestID(c.Request.Context(), s.Pool, v.ID, stk.CheckoutRequestID, points)
		resp["checkoutRequestId"] = stk.CheckoutRequestID
		if stk.AutoConfirmed {
			load, _ := dbx.ConfirmVoucherLoadByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, stk.MpesaReceiptCode, s.Cfg.LoyaltyEarnEnabled)
			s.sendVoucherLoadedSms(c, load, "M-Pesa")
			if refreshed, _ := dbx.GetVoucher(c.Request.Context(), s.Pool, v.ID); refreshed != nil {
				resp = voucherToJSON(refreshed, s.Cfg.FleetQrSecret)
				resp["status"] = "LOADED"
			}
		} else {
			resp["status"] = "PENDING_LOAD"
		}
	} else if loadMethod == "LOYALTY" && req.AmountKES.KES() > 0 {
		points := loyalty.PointsForKES(req.AmountKES.KES())
		if refreshed, err := dbx.LoadVoucherWithLoyalty(c.Request.Context(), s.Pool, ctx, v.ID, points); err != nil {
			resp["paymentError"] = err.Error()
		} else {
			resp = voucherToJSON(refreshed, s.Cfg.FleetQrSecret)
			s.sendVoucherCreditedSms(c, v.ID, req.AmountKES.KES(), "points")
		}
	}
	c.JSON(http.StatusCreated, gin.H{"voucher": resp})
}

type loadVoucherRequest struct {
	AmountKES   money.Amount `json:"amountKes" binding:"required"`
	Method      string       `json:"method" binding:"required"`
	BuyerMsisdn string       `json:"buyerMsisdn"`
	// Set only when Method is "VOUCHER" — the caller's other voucher to
	// move balance out of. See dbx.TransferVoucherBalance.
	FromVoucherID string `json:"fromVoucherId"`
}

// POST /v1/vouchers/:id/load — top up via M-Pesa or loyalty.
func (s *Server) handleLoadVoucher(c *gin.Context) {
	var req loadVoucherRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !optionalMsisdnString(c, &req.BuyerMsisdn, "The buyer's phone number") {
		return
	}
	ctx := ctxFromGin(c)
	v, err := dbx.GetVoucher(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Voucher not found")
		return
	}
	if v.OwnerPartyID != ctx.PartyID {
		writeError(c, http.StatusForbidden, "DENIED", "Not your voucher")
		return
	}
	method := strings.ToUpper(req.Method)
	if method == "LOYALTY" {
		refreshed, err := dbx.LoadVoucherWithLoyalty(c.Request.Context(), s.Pool, ctx, v.ID, loyalty.PointsForKES(req.AmountKES.KES()))
		if err != nil {
			writeFleetError(c, err)
			return
		}
		s.sendVoucherCreditedSms(c, v.ID, req.AmountKES.KES(), "points")
		c.JSON(http.StatusOK, gin.H{"voucher": voucherToJSON(refreshed, s.Cfg.FleetQrSecret)})
		return
	}
	if method == "VOUCHER" {
		if strings.TrimSpace(req.FromVoucherID) == "" {
			writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Choose which voucher to load from")
			return
		}
		refreshed, err := dbx.TransferVoucherBalance(c.Request.Context(), s.Pool, ctx, req.FromVoucherID, v.ID, loyalty.PointsForKES(req.AmountKES.KES()))
		if err != nil {
			writeFleetError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"voucher": voucherToJSON(refreshed, s.Cfg.FleetQrSecret)})
		return
	}
	msisdn := strings.TrimSpace(req.BuyerMsisdn)
	if msisdn == "" {
		if p, _ := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID); p != nil && p.Msisdn != nil {
			msisdn = *p.Msisdn
		}
	}
	stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
		Msisdn: msisdn, AmountKES: req.AmountKES.KES(),
		AccountReference: v.ShortCode, Description: "Voucher load",
	})
	if err != nil {
		writeSafeError(c, http.StatusBadRequest, "PAYMENT_FAILED", err, "Could not start the M-Pesa payment")
		return
	}
	_ = dbx.AttachVoucherCheckoutRequestID(c.Request.Context(), s.Pool, v.ID, stk.CheckoutRequestID, loyalty.PointsForKES(req.AmountKES.KES()))
	resp := gin.H{"checkoutRequestId": stk.CheckoutRequestID, "status": "PENDING_LOAD"}
	if stk.AutoConfirmed {
		load, _ := dbx.ConfirmVoucherLoadByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, stk.MpesaReceiptCode, s.Cfg.LoyaltyEarnEnabled)
		s.sendVoucherLoadedSms(c, load, "M-Pesa")
		resp["status"] = "LOADED"
	}
	c.JSON(http.StatusOK, resp)
}

// GET /v1/vouchers/:id/status — poll a pending M-Pesa load.
func (s *Server) handleVoucherStatus(c *gin.Context) {
	v, err := dbx.GetVoucher(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Voucher not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"voucher": voucherToJSON(v, s.Cfg.FleetQrSecret)})
}

// GET /v1/me/vouchers
func (s *Server) handleListMyVouchers(c *gin.Context) {
	ctx := ctxFromGin(c)
	list, err := dbx.ListMyVouchers(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load vouchers")
		return
	}
	out := make([]gin.H, 0, len(list))
	for i := range list {
		out = append(out, voucherToJSON(&list[i], s.Cfg.FleetQrSecret))
	}
	c.JSON(http.StatusOK, gin.H{"vouchers": out})
}

// GET /v1/vouchers/resolve?code=VCH-XXXXXX — safe projection for gifting/scan.
func (s *Server) handleResolveVoucher(c *gin.Context) {
	v, err := dbx.ResolveVoucherByCode(c.Request.Context(), s.Pool, c.Query("code"))
	if err != nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Voucher not found")
		return
	}
	masked := v.OwnerPartyID
	if len(masked) > 8 {
		masked = masked[:4] + "…" + masked[len(masked)-4:]
	}
	c.JSON(http.StatusOK, gin.H{"voucher": gin.H{
		"id": v.ID, "label": v.Label, "purpose": v.Purpose, "status": v.Status,
		"balancePoints": v.BalancePoints, "balanceKes": v.BalanceKES,
		"owner": masked,
	}})
}

type freezeVoucherRequest struct {
	Frozen bool `json:"frozen"`
}

// POST /v1/vouchers/:id/freeze
func (s *Server) handleFreezeVoucher(c *gin.Context) {
	var req freezeVoucherRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.FreezeVoucher(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Frozen); err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GET /v1/me/loyalty — unified balance (legacy store/ticket + party ledger).
func (s *Server) handleMyLoyalty(c *gin.Context) {
	ctx := ctxFromGin(c)
	profile, err := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil || profile == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Profile not found")
		return
	}
	msisdn := ""
	if profile.Msisdn != nil {
		msisdn = *profile.Msisdn
	}
	legacy, err := dbx.GetPoints(c.Request.Context(), s.Pool, ctx.PartyID, msisdn)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "POINTS_FAILED", "Could not load points")
		return
	}
	partyPts, _ := loyalty.PartyPoints(c.Request.Context(), s.Pool, ctx.PartyID)
	total := legacy.Total() + partyPts
	c.JSON(http.StatusOK, gin.H{
		"storePoints": legacy.StorePoints, "ticketPoints": legacy.TicketPoints,
		"partyPoints": partyPts, "totalPoints": total,
		"kesEquiv": loyalty.KesForPoints(total),
	})
}
