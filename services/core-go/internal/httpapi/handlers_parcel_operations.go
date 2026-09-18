package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/notify"
)

type parcelIntakeRequest struct {
	ItemCategory       string     `json:"itemCategory" binding:"required"`
	ItemDescription    string     `json:"itemDescription" binding:"required"`
	Perishable         bool       `json:"perishable"`
	PerishableHandling *string    `json:"perishableHandling"`
	ExpiryAt           *time.Time `json:"expiryAt"`
	Condition          string     `json:"condition" binding:"required"`
	DeclaredValueKes   *float64   `json:"declaredValueKes"`
}

func (s *Server) requireParcelOperations(c *gin.Context) bool {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.assign", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You are not authorised for parcel operations")
		return false
	}
	return true
}

func (s *Server) handleCaptureParcelIntake(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	var req parcelIntakeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.CaptureParcelIntake(c.Request.Context(), s.Pool, c.Param("code"), ctxFromGin(c).ActorID, dbx.ParcelIntakeInput{
		ItemCategory: req.ItemCategory, ItemDescription: req.ItemDescription, Perishable: req.Perishable,
		PerishableHandling: req.PerishableHandling, ExpiryAt: req.ExpiryAt, Condition: req.Condition,
		DeclaredValueKes: req.DeclaredValueKes,
	}); err != nil {
		writeParcelError(c, err)
		return
	}
	if info, ierr := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, c.Param("code")); ierr == nil && info != nil && info.SenderMsisdn != "" {
		_ = authsvc.SendSms(info.SenderMsisdn,
			notify.ParcelIntakeConfirmed(c.Param("code"), info.CarrierOrgName, info.OriginLabel, info.ReceiverName, info.ReceiverMsisdn),
			"PARCEL_INTAKE_CONFIRMED")
	}
	c.JSON(http.StatusOK, gin.H{"status": "RECEIVED_AT_COUNTER", "code": c.Param("code")})
}

func (s *Server) handleRejectParcelAtDropoff(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	result, err := dbx.RejectParcelAtDropoff(c.Request.Context(), s.Pool, c.Param("code"), ctxFromGin(c).ActorID, req.Reason)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	if result.SenderMsisdn != "" {
		_ = authsvc.SendSms(result.SenderMsisdn, notify.ParcelRejectedAtDropoff(result.Code, result.Reason), "PARCEL_REJECTED_AT_DROPOFF")
	}
	c.JSON(http.StatusOK, gin.H{"status": "REJECTED_AT_DROPOFF", "code": result.Code})
}

type createParcelShipmentRequest struct {
	OriginLabel      string `json:"originLabel" binding:"required"`
	DestinationLabel string `json:"destinationLabel" binding:"required"`
	RouteLabel       string `json:"routeLabel"`
	VehiclePlate     string `json:"vehiclePlate"`
	DriverPartyID    string `json:"driverPartyId"`
	ConductorPartyID string `json:"conductorPartyId"`
}

func (s *Server) handleCreateParcelShipment(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	var req createParcelShipmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	shipment, err := dbx.CreateParcelShipment(c.Request.Context(), s.Pool, req.OriginLabel, req.DestinationLabel, req.RouteLabel, req.VehiclePlate, req.DriverPartyID, req.ConductorPartyID, ctx.ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, shipment)
}

func (s *Server) handleGetParcelShipment(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	shipment, err := dbx.GetParcelShipment(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, shipment)
}

func (s *Server) handleListParcelOpsQueue(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	rows, err := dbx.ListParcelOpsQueue(c.Request.Context(), s.Pool, c.DefaultQuery("queue", "all"), 100)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load the parcel operations queue")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": rows})
}

func (s *Server) handleLoadParcelToShipment(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	ctx := ctxFromGin(c)
	shipment, err := dbx.LoadParcelToShipment(c.Request.Context(), s.Pool, c.Param("id"), strings.TrimSpace(c.Param("code")), ctx.PartyID, ctx.ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, shipment)
}

func (s *Server) handleStartParcelShipment(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	shipment, err := dbx.StartParcelShipment(c.Request.Context(), s.Pool, c.Param("id"), ctxFromGin(c).ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, shipment)
}

func (s *Server) handleOffloadParcelFromShipment(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	ctx := ctxFromGin(c)
	shipment, err := dbx.OffloadParcelFromShipment(c.Request.Context(), s.Pool, c.Param("id"), strings.TrimSpace(c.Param("code")), ctx.PartyID, ctx.ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, shipment)
}

func (s *Server) handleFinishParcelShipment(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	shipment, err := dbx.FinishParcelShipment(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, shipment)
}

func (s *Server) handleSendPickupReminder(c *gin.Context) {
	if !s.requireParcelOperations(c) {
		return
	}
	result, err := dbx.RecordPickupReminder(c.Request.Context(), s.Pool, c.Param("code"))
	if err != nil {
		writeParcelError(c, err)
		return
	}
	if result.ReceiverMsisdn != "" {
		_ = authsvc.SendSms(result.ReceiverMsisdn, notify.ParcelPickupReminder(result.Code, result.Count), "PARCEL_PICKUP_REMINDER")
	}
	c.JSON(http.StatusOK, gin.H{"sent": true, "count": result.Count})
}
