package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/dbx"
)

type bookParcelRequest struct {
	SenderName       string  `json:"senderName" binding:"required"`
	SenderMsisdn     string  `json:"senderMsisdn" binding:"required"`
	ReceiverName     string  `json:"receiverName" binding:"required"`
	ReceiverMsisdn   string  `json:"receiverMsisdn" binding:"required"`
	OriginLabel      string  `json:"originLabel" binding:"required"`
	DestinationLabel string  `json:"destinationLabel" binding:"required"`
	Notes            *string `json:"notes"`
}

// handleBookParcel — POST /v1/parcels. Guest-or-authenticated, same
// pattern handleCreateOrder uses: a signed-in sender's partyId comes
// from the session, a guest supplies name+phone directly.
func (s *Server) handleBookParcel(c *gin.Context) {
	var req bookParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	var senderPartyID *string
	if token := bearerToken(c); token != "" {
		if ctx, _ := s.Session.CtxFromToken(c.Request.Context(), token, clientIP(c)); ctx != nil && ctx.PartyID != "" {
			senderPartyID = &ctx.PartyID
		}
	}
	parcelID, code, err := dbx.BookParcel(c.Request.Context(), s.Pool, dbx.BookParcelInput{
		SenderPartyID: senderPartyID, SenderName: req.SenderName, SenderMsisdn: req.SenderMsisdn,
		ReceiverName: req.ReceiverName, ReceiverMsisdn: req.ReceiverMsisdn,
		OriginLabel: req.OriginLabel, DestinationLabel: req.DestinationLabel, Notes: req.Notes,
	})
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcelId": parcelID, "code": code})
}

// handleGetParcelStatus — GET /v1/parcels/:code/status. Guest-safe —
// same code the sender printed/shared is the bearer credential for
// "check this parcel", same convention a pickup code follows.
func (s *Server) handleGetParcelStatus(c *gin.Context) {
	status, err := dbx.GetParcelStatus(c.Request.Context(), s.Pool, c.Param("code"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that parcel")
		return
	}
	if status == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That parcel was not found")
		return
	}
	c.JSON(http.StatusOK, status)
}

// handleScanParcelHandoff — POST /v1/parcels/:code/handoff. Auth
// required — accepting custody needs a party to attribute it to (see
// dbx.ScanHandoff's own comment on the authorization model).
func (s *Server) handleScanParcelHandoff(c *gin.Context) {
	ctx := ctxFromGin(c)
	status, err := dbx.ScanHandoff(c.Request.Context(), s.Pool, c.Param("code"), ctx.PartyID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status})
}

type deliverParcelRequest struct {
	DeliveryCode string `json:"deliveryCode" binding:"required"`
}

// handleDeliverParcel — POST /v1/parcels/:code/deliver. Auth required
// — only the parcel's current holder can close the chain (see
// dbx.DeliverParcel).
func (s *Server) handleDeliverParcel(c *gin.Context) {
	var req deliverParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	if err := dbx.DeliverParcel(c.Request.Context(), s.Pool, c.Param("code"), req.DeliveryCode, ctx.PartyID); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "DELIVERED"})
}

func (s *Server) handleListMyParcels(c *gin.Context) {
	ctx := ctxFromGin(c)
	rows, err := dbx.ListMyParcels(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your parcels")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": rows})
}

// handleListHeldParcels — GET /v1/me/parcels/holding. The handler/
// driver-facing "parcels I'm holding" list — the mobile version of
// Phases 2/6/7's own scoped-session screens.
func (s *Server) handleListHeldParcels(c *gin.Context) {
	ctx := ctxFromGin(c)
	rows, err := dbx.ListParcelsHeld(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load parcels you're holding")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": rows})
}

func writeParcelError(c *gin.Context, err error) {
	if pe, ok := err.(*dbx.ParcelError); ok {
		status := http.StatusBadRequest
		switch pe.Code {
		case "NOT_FOUND":
			status = http.StatusNotFound
		case "FORBIDDEN":
			status = http.StatusForbidden
		}
		writeError(c, status, pe.Code, pe.Message)
		return
	}
	writeError(c, http.StatusInternalServerError, "PARCEL_FAILED", "Could not complete that")
}
