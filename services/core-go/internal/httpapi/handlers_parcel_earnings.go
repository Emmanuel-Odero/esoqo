package httpapi

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/notify"
)

// Courier earnings — the gig half of dispatch, finally made financially
// real. Accrual itself isn't a route: it happens inside DeliverParcel,
// because "the job is done" and "the courier has earned" are one event
// and any arrangement that lets a client decide otherwise will
// eventually decide wrongly.

// handleGetMyEarnings — GET /v1/me/courier-earnings. A courier's own
// money screen: what they're owed, what they've been paid, what today
// came to.
func (s *Server) handleGetMyEarnings(c *gin.Context) {
	ctx := ctxFromGin(c)
	earnings, err := dbx.GetCourierEarnings(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load your earnings")
		return
	}
	limit := 50
	if v := c.Query("limit"); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}
	rows, err := dbx.ListCourierEarnings(c.Request.Context(), s.Pool, ctx.PartyID, limit)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load your deliveries")
		return
	}
	// The rate is returned alongside so a courier can see how a figure
	// was arrived at, not just what it came to. "Why is this 300?" is
	// the first question anybody asks about their own pay.
	tariff, err := dbx.GetCourierTariff(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load the rate")
		return
	}
	c.JSON(http.StatusOK, gin.H{"earnings": earnings, "deliveries": rows, "tariff": tariff})
}

// ── Admin: the payout run ────────────────────────────────────────────

func (s *Server) handleAdminListCouriersOwed(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	couriers, err := dbx.ListCouriersOwed(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load what couriers are owed")
		return
	}
	c.JSON(http.StatusOK, gin.H{"couriers": couriers})
}

type payCourierRequest struct {
	CourierPartyID string       `json:"courierPartyId" binding:"required"`
	AmountKes      money.Amount `json:"amountKes"`
	Reference      *string      `json:"reference"`
	Note           *string      `json:"note"`
}

// handleAdminPayCourier — POST /v1/admin/parcels/couriers/payout.
//
// Gated on parcels.refund, the same capability that already governs
// every other movement of real money out of this vertical. Paying a
// courier is the same kind of trust as processing a refund or taking
// custody of COD cash, and a capability set that grows a string per
// money movement stops being something anyone can audit.
func (s *Server) handleAdminPayCourier(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.refund", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't handle parcel money")
		return
	}
	var req payCourierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	payoutID, expected, err := dbx.PayCourier(c.Request.Context(), s.Pool,
		req.CourierPartyID, req.AmountKes.KES(), req.Reference, req.Note, ctx.ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	// Tell them. A payout a courier only discovers by checking their
	// M-Pesa balance is a payout they will phone somebody about.
	if msisdn, _, merr := dbx.GetPartyContact(c.Request.Context(), s.Pool, req.CourierPartyID); merr == nil && msisdn != "" {
		_ = authsvc.SendSms(msisdn,
			notify.CourierPaid(fmt.Sprintf("%.0f", req.AmountKes.KES()), req.Reference),
			"COURIER_PAID")
	}
	c.JSON(http.StatusOK, gin.H{
		"payoutId": payoutID, "amountKes": req.AmountKes.KES(), "expectedKes": expected,
		// Surfaced rather than left for the caller to subtract — a part
		// payment is the whole reason both numbers are kept.
		"shortfallKes": expected - req.AmountKes.KES(),
	})
}

func (s *Server) handleAdminGetCourierTariff(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	tariff, err := dbx.GetCourierTariff(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load the courier rate")
		return
	}
	c.JSON(http.StatusOK, tariff)
}

func (s *Server) handleAdminSetCourierTariff(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	var req dbx.ParcelCourierTariff
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.SetCourierTariff(c.Request.Context(), s.Pool, req, ctx.ActorID); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}
