package httpapi

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/notify"
)

// Cash on delivery — the seller-facing half of the parcel vertical.
//
// Collection itself is not a route a client calls on its own during a
// normal delivery: it rides inside handleDeliverParcel (see
// collectCodOnDelivery below), because "the goods changed hands" and
// "the money changed hands" are one event at a doorstep, and any
// arrangement that lets a courier do one without the other is an
// arrangement that will eventually do one without the other.

// handleGetCodPolicy — GET /v1/parcels/cod-policy. Public, so a booking
// form knows whether to offer COD at all and what cap to enforce in the
// UI before the server re-enforces it.
func (s *Server) handleGetCodPolicy(c *gin.Context) {
	policy, err := dbx.GetCodPolicy(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load cash-on-delivery settings")
		return
	}
	// The handling fee is deliberately included: it's deducted from what
	// a seller is paid, and a seller finding that out after their first
	// settlement rather than before their first booking is the kind of
	// surprise that loses an account.
	c.JSON(http.StatusOK, policy)
}

// CodAmountKes is money.Amount, not float64: it binds from a JSON
// number (every client today) or a decimal string (clients that have
// moved to the converged contract). Strictly non-breaking — see
// money.Amount's doc comment and step 3 of
// docs/proposals/money-representation.md.
type setParcelCodRequest struct {
	CodAmountKes          money.Amount `json:"codAmountKes" binding:"required"`
	CodCollectDeliveryFee bool         `json:"codCollectDeliveryFee"`
}

// handleSetParcelCod — POST /v1/parcels/:code/cod. Public, same
// boundary booking and pricing already sit on: a guest seller books a
// parcel and says what their buyer owes, all before any sign-in.
func (s *Server) handleSetParcelCod(c *gin.Context) {
	var req setParcelCodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.SetParcelCod(c.Request.Context(), s.Pool, c.Param("code"),
		req.CodAmountKes.KES(), req.CodCollectDeliveryFee); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleConfirmParcelCodBooking — POST /v1/parcels/:code/cod/confirm.
// The COD equivalent of paying: it makes the booking real without any
// money moving, because the money moves at the door.
func (s *Server) handleConfirmParcelCodBooking(c *gin.Context) {
	code := c.Param("code")
	if err := dbx.ConfirmParcelCodBooking(c.Request.Context(), s.Pool, code); err != nil {
		writeParcelError(c, err)
		return
	}
	// The sender hears the booking is live. Deliberately not the
	// payment-confirmed message: nothing has been paid, and telling a
	// seller their money arrived when it hasn't is the worst possible
	// thing this vertical could get wrong.
	if info, ierr := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code); ierr == nil && info != nil && info.SenderMsisdn != "" {
		_ = authsvc.SendSms(info.SenderMsisdn,
			notify.ParcelCodBooked(code, info.ReceiverName, info.DestinationLabel),
			"PARCEL_COD_BOOKED")
	}
	c.JSON(http.StatusOK, gin.H{"status": "BOOKED", "paymentMethod": "CASH_ON_DELIVERY"})
}

// collectCodOnDelivery records the cash a courier took, as part of
// closing the parcel out. Returns a result to report, or nil when the
// parcel isn't COD.
//
// Called by handleDeliverParcel AFTER the delivery itself succeeds, so
// a wrong delivery code can never book a collection for goods that
// never changed hands. The reverse order would be worse: recording
// money against a parcel the courier then failed to hand over.
func (s *Server) collectCodOnDelivery(c *gin.Context, code string, collected *money.Amount, partyID string) (*dbx.CodCollectionResult, error) {
	if collected == nil {
		return nil, nil
	}
	return dbx.RecordCodCollection(c.Request.Context(), s.Pool, code, collected.KES(), partyID)
}

// handleRecordCodCollection — POST /v1/parcels/:code/cod/collect. The
// standalone path, for the one case the delivery flow can't cover: the
// parcel was handed over but recording the cash failed (a dropped
// connection at exactly the wrong moment), leaving a delivered parcel
// with money still marked pending. Custody-gated like everything else
// at the door.
func (s *Server) handleRecordCodCollection(c *gin.Context) {
	var req struct {
		CollectedKes money.Amount `json:"collectedKes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	result, err := dbx.RecordCodCollection(c.Request.Context(), s.Pool, c.Param("code"), req.CollectedKes.KES(), ctx.PartyID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	s.notifyCodCollected(c, c.Param("code"), result)
	c.JSON(http.StatusOK, result)
}

// notifyCodCollected tells the seller their buyer paid — and, when the
// buyer came up short, says so plainly rather than letting the seller
// discover it at settlement.
func (s *Server) notifyCodCollected(c *gin.Context, code string, result *dbx.CodCollectionResult) {
	if result == nil {
		return
	}
	info, err := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code)
	if err != nil || info == nil || info.SenderMsisdn == "" {
		return
	}
	_ = authsvc.SendSms(info.SenderMsisdn,
		notify.ParcelCodCollected(code, fmt.Sprintf("%.0f", result.GoodsKes),
			fmt.Sprintf("%.0f", result.ShortfallKes), result.ShortfallKes > 0),
		"PARCEL_COD_COLLECTED")
}

// handleGetMyCodHolding — GET /v1/me/cod-holding. What a rider is
// carrying right now, which is the number they reconcile against at the
// end of a round.
func (s *Server) handleGetMyCodHolding(c *gin.Context) {
	ctx := ctxFromGin(c)
	holding, err := dbx.GetRiderCodHolding(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load your cash total")
		return
	}
	c.JSON(http.StatusOK, holding)
}

// ── Remittance and settlement ────────────────────────────────────────

type remitCodRequest struct {
	RiderPartyID string       `json:"riderPartyId" binding:"required"`
	AmountKes    money.Amount `json:"amountKes"`
	Note         *string      `json:"note"`
}

// handleAdminRemitCod — POST /v1/admin/parcels/cod/remit. An Esoqo
// staff member counting a rider's cash in.
func (s *Server) handleAdminRemitCod(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.refund", nil); err != nil {
		// Deliberately the same capability that already governs moving
		// real money out of the parcel vertical (refunds), rather than a
		// new one: taking custody of a bag of cash is the same kind of
		// trust, and a capability set that grows a string per money
		// movement stops being something anyone can audit.
		writeError(c, http.StatusForbidden, "DENIED", "You can't handle parcel money")
		return
	}
	var req remitCodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	var staffID *string
	if ctx.ActorID != "" {
		staffID = &ctx.ActorID
	}
	id, expected, err := dbx.RemitCod(c.Request.Context(), s.Pool, req.RiderPartyID, req.AmountKes.KES(), staffID, nil, req.Note)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		// Exact cents throughout: the shortfall is the difference between
		// what a rider was holding and what they handed over, and it is
		// the number an admin acts on.
		"remittanceId": id,
		"amountKes":    req.AmountKes,
		"expectedKes":  money.AmountFromKES(expected),
		// Surfaced rather than left for the caller to subtract: a short
		// hand-over is the whole reason this record exists.
		"shortfallKes": money.AmountOf(money.FromKES(expected) - req.AmountKes.Cents()),
	})
}

// handleOrgRemitCod — POST /v1/parcel-orgs/me/cod/remit. A courier
// company's own manager counting in one of their riders, without
// routing every depot hand-over through Esoqo support.
func (s *Server) handleOrgRemitCod(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgEarnings)
	if orgID == "" {
		return
	}
	var req remitCodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	// The rider has to be one of theirs. Without this a manager could
	// clear another company's rider's float by guessing a party id.
	onTeam, err := dbx.RiderBelongsToOrg(c.Request.Context(), s.Pool, req.RiderPartyID, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "REMIT_FAILED", "Could not check that rider")
		return
	}
	if !onTeam {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That rider isn't on your team")
		return
	}
	ctx := ctxFromGin(c)
	var orgStaffID *string
	if ctx.ActorID != "" {
		orgStaffID = &ctx.ActorID
	}
	id, expected, err := dbx.RemitCod(c.Request.Context(), s.Pool, req.RiderPartyID, req.AmountKes.KES(), nil, orgStaffID, req.Note)
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

// handleAdminListSellersOwedCod — GET /v1/admin/parcels/cod/sellers.
func (s *Server) handleAdminListSellersOwedCod(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	sellers, err := dbx.ListSellersOwedCod(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load what sellers are owed")
		return
	}
	c.JSON(http.StatusOK, gin.H{"sellers": sellers})
}

// handleAdminSettleSellerCod — POST /v1/admin/parcels/cod/settle.
// Pays a seller everything of theirs a rider has actually handed in.
func (s *Server) handleAdminSettleSellerCod(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.refund", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't handle parcel money")
		return
	}
	var req struct {
		SenderPartyID string `json:"senderPartyId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	paid, fee, count, err := dbx.SettleSellerCod(c.Request.Context(), s.Pool, req.SenderPartyID, ctx.ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	if msisdn, name, merr := dbx.GetPartyContact(c.Request.Context(), s.Pool, req.SenderPartyID); merr == nil && msisdn != "" {
		_ = authsvc.SendSms(msisdn,
			notify.ParcelCodSettled(fmt.Sprintf("%.0f", paid), count, name),
			"PARCEL_COD_SETTLED")
	}
	c.JSON(http.StatusOK, gin.H{"paidKes": paid, "handlingFeeKes": fee, "parcels": count})
}

// ── Policy admin ─────────────────────────────────────────────────────

func (s *Server) handleAdminGetCodPolicy(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	policy, err := dbx.GetCodPolicy(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load cash-on-delivery settings")
		return
	}
	c.JSON(http.StatusOK, policy)
}

func (s *Server) handleAdminSetCodPolicy(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	var req dbx.ParcelCodPolicy
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.SetCodPolicy(c.Request.Context(), s.Pool, req, ctx.ActorID); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}
