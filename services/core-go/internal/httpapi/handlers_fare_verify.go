package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/payments"
)

type verifyFareRequest struct {
	Code        string `json:"code" binding:"required"`
	ScopeTripID string `json:"scopeTripId"`
}

// POST /v1/fares/verify — tout scans receipt QR or types M-Pesa code.
// Authed (SCANNER/CREW/MANAGER or owner). 90-min TTL from config.
func (s *Server) handleVerifyFare(c *gin.Context) {
	var req verifyFareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	// Crew/staff see any fare; passengers only their own (enforced in
	// dbx.VerifyFare — the UI hides the entry point, this is the lock).
	privileged := authsvc.Can(ctx, authsvc.CapFareVerify, nil) ||
		authsvc.Can(ctx, "ticketorg.read", nil)
	requesterMsisdn := ""
	if profile, _ := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID); profile != nil && profile.Msisdn != nil {
		requesterMsisdn = *profile.Msisdn
	}
	res, err := dbx.VerifyFare(c.Request.Context(), s.Pool, req.Code, req.ScopeTripID, s.Cfg.FareProofTTLMin, ctx.PartyID, ctx.ActorID, ctx.PartyID, requesterMsisdn, privileged)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "VERIFY_FAILED", "Could not verify")
		return
	}
	out := gin.H{
		"status": res.Status, "fareId": res.FareID, "amountKes": res.AmountKES,
		"method": res.Method, "buyerMsisdn": res.BuyerMsisdn, "receiptCode": res.ReceiptCode,
		"ageMinutes": res.AgeMinutes, "tripId": res.TripID, "vehiclePlate": res.VehiclePlate,
		"routeName": res.RouteName, "driverName": res.DriverName, "conductorName": res.ConductorName,
		"orgName": res.OrgName, "verifyCount": res.VerifyCount,
	}
	// Local miss: best-effort Daraja status for external till receipts.
	if res.Status == "NOT_FOUND" {
		st := payments.QueryTransactionStatus(s.Cfg, req.Code)
		out["external"] = gin.H{"found": st.Found, "receipt": st.Receipt, "detail": st.ResultDesc}
	}
	s.recordFleetAudit(c, "fare.verified", "fare_payment", res.FareID, map[string]interface{}{"result": res.Status})
	c.JSON(http.StatusOK, gin.H{"verification": out})
}

// GET /v1/trips/resolve?code=esoko://t?... or BUS-XXXXXX — public trip card.
func (s *Server) handleResolveTrip(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		code = c.Query("payload")
	}
	if code == "" {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "code is required")
		return
	}
	r, err := dbx.ResolveTripQr(c.Request.Context(), s.Pool, code, s.Cfg.FleetQrSecret)
	if err != nil {
		writeFleetError(c, err)
		return
	}
	stages := make([]gin.H, 0, len(r.Stages))
	for _, st := range r.Stages {
		stages = append(stages, gin.H{"id": st.ID, "name": st.Name, "order": st.Order, "fareKes": st.FareKES})
	}
	c.JSON(http.StatusOK, gin.H{"trip": gin.H{
		"tripId": r.TripID, "orgId": r.OrgID, "orgName": r.OrgName, "orgSlug": r.OrgSlug,
		"vehiclePlate": r.VehiclePlate, "routeName": r.RouteName,
		"driverName": r.DriverName, "conductorName": r.ConductorName,
		"status": r.Status, "stages": stages,
	}})
}

// GET /v1/fleet/trips/:id/qr — manager/crew printable boarding QR.
func (s *Server) handleTripQr(c *gin.Context) {
	qr, err := dbx.RotateTripQr(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), s.Cfg.FleetQrSecret)
	if err != nil {
		writeFleetError(c, err)
		return
	}
	// NOTE: rotate-on-view keeps codes fresh; sticker reprint uses latest.
	c.JSON(http.StatusOK, gin.H{"qr": gin.H{"tripId": qr.TripID, "payload": qr.Payload, "shortCode": qr.ShortCode, "rotatedAt": qr.RotatedAt}})
}

// GET /v1/fares/:id/status — cheap STK poll (vs full fare row).
func (s *Server) handleFareStatus(c *gin.Context) {
	fare, err := dbx.GetFare(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil || fare == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Fare not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"fareId": fare.ID, "status": fare.Status, "totalKes": fare.AmountKES, "method": fare.Method})
}

// GET /v1/me/fares — payer history for wallet/receipts.
func (s *Server) handleListMyFares(c *gin.Context) {
	ctx := ctxFromGin(c)
	rows, err := s.Pool.Query(c.Request.Context(), `
		SELECT id::text, "tripId"::text, "amountKes"::text, method, status::text, "createdAt"::text
		FROM fare_payment WHERE "buyerPartyId"::text = $1 ORDER BY "createdAt" DESC LIMIT 50`, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load fares")
		return
	}
	defer rows.Close()
	out := []gin.H{}
	for rows.Next() {
		var id, trip, amt, method, status, at string
		if err := rows.Scan(&id, &trip, &amt, &method, &status, &at); err != nil {
			continue
		}
		out = append(out, gin.H{"fareId": id, "tripId": trip, "totalKes": amt, "method": method, "status": status, "createdAt": at})
	}
	c.JSON(http.StatusOK, gin.H{"fares": out})
}
