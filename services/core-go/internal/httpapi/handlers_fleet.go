package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/audit"
	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/fleetqr"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/payments"
)

func tripQrPayload(secret, tripID string) string {
	return fleetqr.TripPayload(tripID, fleetqr.Sign(secret, "trip", tripID))
}

// recordFleetAudit writes one hash-chained audit row for a fleet write,
// mirroring TS dal/*'s recordAudit-after-write. Best-effort by design:
// a missing row is a traceability gap (the chain still verifies — it
// only links rows that exist), while failing the request on an audit
// error would turn the audit trail into an availability dependency.
// Pings are deliberately NOT audited (high-frequency GPS noise).
func (s *Server) recordFleetAudit(c *gin.Context, action, targetType, targetID string, payload map[string]interface{}) {
	ctx := ctxFromGin(c)
	actorType := string(ctx.ActorType)
	if !ctx.Verified || actorType == "" {
		actorType = "SYSTEM" // guest fare-pay and other unauthenticated writes
	}
	var actorID *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		actorID = &id
	}
	var ip *string
	if ctx.IP != "" {
		v := ctx.IP
		ip = &v
	}
	tt, tid := targetType, targetID
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: actorType, ActorID: actorID, IP: ip},
		audit.Input{Action: action, TargetType: &tt, TargetID: &tid, Payload: payload})
}

// ── staff sign-in (AGENT sessions — the Go port of TS
// getTicketOrgStaffPinHashForSignIn + PIN verify at the Server Action
// boundary). Resolves by org slug + name in free text (never a staff
// picker — same anti-enumeration reasoning as cashier sign-in), verifies
// against DummyPinHash on miss, mints an AGENT session whose list IS the
// TICKETING_STAFF_CAPABILITIES bundle for that role.

type staffSignInRequest struct {
	OrgSlug string `json:"orgSlug" binding:"required"`
	Name    string `json:"name" binding:"required"`
	Pin     string `json:"pin" binding:"required"`
}

func (s *Server) handleTicketStaffSignIn(c *gin.Context) {
	var req staffSignInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	// Staff PINs are short and the org slug and name are both public
	// enough to enumerate, so without a per-subject counter this endpoint
	// accepted unlimited guesses at a named till operator.
	subject := strings.ToLower(req.OrgSlug + ":" + req.Name)
	if s.StaffLockout.Locked(c.Request.Context(), subject) {
		// Same message as a wrong PIN: saying "locked" would confirm the
		// org/name pair exists.
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Wrong organisation, name or PIN")
		return
	}

	staff, err := dbx.FindTicketStaffForSignIn(c.Request.Context(), s.Pool, req.OrgSlug, req.Name)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SIGN_IN_FAILED", "Could not sign in")
		return
	}
	storedHash := authsvc.DummyPinHash
	if staff != nil {
		storedHash = staff.PinHash
	}
	if staff == nil || !staff.Active || !authsvc.VerifyPin(req.Pin, storedHash) {
		s.StaffLockout.RecordFailure(c.Request.Context(), subject)
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Wrong organisation, name or PIN")
		return
	}
	s.StaffLockout.Clear(c.Request.Context(), subject)
	caps, ok := authsvc.TicketingStaffCapabilities[staff.Role]
	if !ok {
		caps = authsvc.TicketingStaffCapabilities["SCANNER"]
	}
	token, err := s.Session.CreateSession(c.Request.Context(), authsvc.SessionData{
		ActorType:    authsvc.ActorAgent,
		ActorID:      staff.ID,
		TicketOrgID:  staff.OrgID,
		Capabilities: append([]string(nil), caps...),
	}, 12*time.Hour)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "Could not start a session")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"token": token, "orgId": staff.OrgID, "role": staff.Role, "name": staff.Name,
		"crewMemberId": staff.CrewMemberID,
	})
}

// ── fleet ────────────────────────────────────────────────────────

type createVehicleRequest struct {
	OrgID    string  `json:"orgId" binding:"required"`
	PlateNo  string  `json:"plateNo" binding:"required"`
	Capacity *int    `json:"capacity"`
	Label    *string `json:"label"`
}

func (s *Server) handleCreateVehicle(c *gin.Context) {
	var req createVehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	v, err := dbx.CreateVehicle(c.Request.Context(), s.Pool, ctxFromGin(c), req.OrgID, req.PlateNo, req.Capacity, req.Label)
	if err != nil {
		writeFleetError(c, err)
		return
	}
	s.recordFleetAudit(c, "fleet.vehicle.created", "fleet_vehicle", v.ID, map[string]interface{}{"orgId": req.OrgID, "plateNo": req.PlateNo})
	c.JSON(http.StatusCreated, gin.H{"vehicle": v})
}

func (s *Server) handleListVehicles(c *gin.Context) {
	vehicles, err := dbx.ListVehicles(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("orgId"))
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"vehicles": vehicles})
}

type setVehicleStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

func (s *Server) handleSetVehicleStatus(c *gin.Context) {
	var req setVehicleStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.SetVehicleStatus(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Status); err != nil {
		writeFleetError(c, err)
		return
	}
	s.recordFleetAudit(c, "fleet.vehicle.status_changed", "fleet_vehicle", c.Param("id"), map[string]interface{}{"status": req.Status})
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── crew ─────────────────────────────────────────────────────────

type createCrewRequest struct {
	OrgID  string  `json:"orgId" binding:"required"`
	Name   string  `json:"name" binding:"required"`
	Role   string  `json:"role" binding:"required"`
	Msisdn *string `json:"msisdn"`
}

func (s *Server) handleCreateCrew(c *gin.Context) {
	var req createCrewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !optionalMsisdn(c, &req.Msisdn, "That phone number") {
		return
	}
	cr, err := dbx.CreateCrew(c.Request.Context(), s.Pool, ctxFromGin(c), req.OrgID, req.Name, req.Role, req.Msisdn)
	if err != nil {
		writeFleetError(c, err)
		return
	}
	s.recordFleetAudit(c, "fleet.crew.created", "crew_member", cr.ID, map[string]interface{}{"orgId": req.OrgID, "role": req.Role})
	c.JSON(http.StatusCreated, gin.H{"crew": cr})
}

func (s *Server) handleListCrew(c *gin.Context) {
	crew, err := dbx.ListCrew(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("orgId"))
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"crew": crew})
}

type setCrewActiveRequest struct {
	Active bool `json:"active"`
}

func (s *Server) handleSetCrewActive(c *gin.Context) {
	var req setCrewActiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.SetCrewActive(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Active); err != nil {
		writeFleetError(c, err)
		return
	}
	action := "fleet.crew.reactivated"
	if !req.Active {
		action = "fleet.crew.deactivated"
	}
	s.recordFleetAudit(c, action, "crew_member", c.Param("id"), nil)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── short routes ─────────────────────────────────────────────────

type createShortRouteRequest struct {
	OrgID  string `json:"orgId" binding:"required"`
	Name   string `json:"name" binding:"required"`
	Stages []struct {
		Name    string       `json:"name" binding:"required"`
		FareKES money.Amount `json:"fareKes" binding:"required"`
	} `json:"stages" binding:"required"`
}

func (s *Server) handleCreateShortRoute(c *gin.Context) {
	var req createShortRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	stages := make([]dbx.StageInput, len(req.Stages))
	for i, st := range req.Stages {
		stages[i] = dbx.StageInput{Name: st.Name, FareKES: st.FareKES.KES()}
	}
	route, err := dbx.CreateShortRoute(c.Request.Context(), s.Pool, ctxFromGin(c), req.OrgID, req.Name, stages)
	if err != nil {
		writeFleetError(c, err)
		return
	}
	s.recordFleetAudit(c, "fleet.short_route.created", "short_route", route.ID, map[string]interface{}{"orgId": req.OrgID, "stages": len(stages)})
	c.JSON(http.StatusCreated, gin.H{"route": route})
}

func (s *Server) handleListShortRoutes(c *gin.Context) {
	routes, err := dbx.ListShortRoutes(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("orgId"))
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": routes})
}

// ── trips ────────────────────────────────────────────────────────

type createTripRequest struct {
	OrgID        string  `json:"orgId" binding:"required"`
	VehicleID    string  `json:"vehicleId" binding:"required"`
	DriverID     *string `json:"driverId"`
	ConductorID  *string `json:"conductorId"`
	ShortRouteID *string `json:"shortRouteId"`
}

func (s *Server) handleCreateTrip(c *gin.Context) {
	var req createTripRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	t, err := dbx.CreateTrip(c.Request.Context(), s.Pool, ctxFromGin(c), req.OrgID, req.VehicleID, req.DriverID, req.ConductorID, req.ShortRouteID)
	if err != nil {
		writeFleetError(c, err)
		return
	}
	s.recordFleetAudit(c, "fleet.trip.started", "trip", t.ID, map[string]interface{}{"orgId": req.OrgID, "vehicleId": req.VehicleID})
	var shortCode *string
	_ = s.Pool.QueryRow(c.Request.Context(), `SELECT "qrShortCode" FROM trip WHERE id = $1`, t.ID).Scan(&shortCode)
	c.JSON(http.StatusCreated, gin.H{"trip": t, "qr": gin.H{
		"payload":   tripQrPayload(s.Cfg.FleetQrSecret, t.ID),
		"shortCode": shortCode,
	}})
}

func (s *Server) handleListTrips(c *gin.Context) {
	trips, err := dbx.ListTrips(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("orgId"), c.Query("active") == "true")
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"trips": trips})
}

// handleMyActiveTrip — GET /v1/fleet/my-trip. Crew-scoped "which trip
// am I on right now", not gated by a capability the CREW bundle
// deliberately doesn't hold (trip.read) — see dbx.MyActiveTrip.
func (s *Server) handleMyActiveTrip(c *gin.Context) {
	trip, err := dbx.MyActiveTrip(c.Request.Context(), s.Pool, ctxFromGin(c))
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"trip": trip})
}

type closeTripRequest struct {
	// Both optional — a manager closing on someone's behalf may still
	// send neither, exactly as before this field existed.
	Note      *string `json:"note"`
	EndStatus *string `json:"endStatus"`
}

func (s *Server) handleCloseTrip(c *gin.Context) {
	var req closeTripRequest
	// No `binding:"required"` fields on this body — an empty/absent
	// body is valid (manager close, no note), so a bind error here can
	// only mean malformed JSON, not a missing field.
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
			return
		}
	}
	if err := dbx.CloseTrip(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Note, req.EndStatus); err != nil {
		writeFleetError(c, err)
		return
	}
	s.recordFleetAudit(c, "fleet.trip.closed", "trip", c.Param("id"), map[string]interface{}{"endStatus": req.EndStatus})
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── pings ────────────────────────────────────────────────────────

type postPingRequest struct {
	Lat float64 `json:"lat" binding:"required"`
	Lng float64 `json:"lng" binding:"required"`
}

func (s *Server) handlePostPing(c *gin.Context) {
	var req postPingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.PostPing(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Lat, req.Lng); err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) handleLatestPositions(c *gin.Context) {
	positions, err := dbx.LatestPositions(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("orgId"))
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"positions": positions})
}

// handleFleetOverview — GET /v1/fleet/orgs/:orgId/overview. The console
// header: one round trip for the day's counts and money.
func (s *Server) handleFleetOverview(c *gin.Context) {
	overview, err := dbx.GetFleetOverview(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("orgId"))
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"overview": overview})
}

// handleActiveTrails — GET /v1/fleet/orgs/:orgId/trails?minutes=60.
// The ordered recent pings behind the live map's route lines.
func (s *Server) handleActiveTrails(c *gin.Context) {
	minutes := 60
	if v := c.Query("minutes"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			minutes = n
		}
	}
	trails, err := dbx.ActiveTrails(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("orgId"), minutes)
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"trails": trails})
}

// ── fares ────────────────────────────────────────────────────────

type createFareRequest struct {
	TripID      string       `json:"tripId"`
	TripQrCode  string       `json:"tripQrCode"`
	StageFromID *string      `json:"stageFromId"`
	StageToID   *string      `json:"stageToId"`
	AmountKES   money.Amount `json:"amountKes"`
	Method      string       `json:"method" binding:"required"`
	BuyerMsisdn *string      `json:"buyerMsisdn"`
	BuyerName   *string      `json:"buyerName"`
	VoucherID   *string      `json:"voucherId"`
}

func (s *Server) handleCreateFare(c *gin.Context) {
	var req createFareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !optionalMsisdn(c, &req.BuyerMsisdn, "The buyer's phone number") {
		return
	}
	tripID := req.TripID
	if tripID == "" && req.TripQrCode != "" {
		// Scan-to-pay: resolve signed QR / BUS-XXXXXX to the active trip.
		resolved, err := dbx.ResolveTripQr(c.Request.Context(), s.Pool, req.TripQrCode, s.Cfg.FleetQrSecret)
		if err != nil {
			writeFleetError(c, err)
			return
		}
		tripID = resolved.TripID
	}
	if tripID == "" {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "tripId or tripQrCode is required")
		return
	}
	ctx := ctxFromGin(c)
	if !ctx.Verified {
		// Guest fare-pay (same as guest booking): an anonymous but
		// verified context so dbx can tell "public passenger" apart from
		// "no credentials at all".
		ctx = authsvc.AnonCtx(clientIP(c))
	}
	var buyerParty *string
	if ctx.PartyID != "" {
		buyerParty = &ctx.PartyID
	}
	fare, err := dbx.CreateFare(c.Request.Context(), s.Pool, ctx, dbx.CreateFareInput{
		TripID: tripID, StageFromID: req.StageFromID, StageToID: req.StageToID,
		AmountKES: req.AmountKES.KES(), Method: req.Method, BuyerMsisdn: req.BuyerMsisdn,
		BuyerName: req.BuyerName, BuyerPartyID: buyerParty, VoucherID: req.VoucherID,
	})
	if err != nil {
		writeFleetError(c, err)
		return
	}
	// VOUCHER fares are CONFIRMED inline (no STK) — return receipt QR.
	if req.Method == "VOUCHER" {
		s.recordFleetAudit(c, "fleet.fare.created", "fare_payment", fare.ID, map[string]interface{}{"tripId": tripID, "method": "VOUCHER", "totalKes": fare.AmountKES})
		c.JSON(http.StatusOK, gin.H{"fareId": fare.ID, "totalKes": fare.AmountKES, "status": fare.Status, "method": "VOUCHER", "receiptCode": fare.ID[:8]})
		return
	}
	s.recordFleetAudit(c, "fleet.fare.created", "fare_payment", fare.ID, map[string]interface{}{"tripId": req.TripID, "method": req.Method, "totalKes": fare.AmountKES})
	resp := gin.H{"fareId": fare.ID, "totalKes": fare.AmountKES, "status": fare.Status}
	if req.Method == "MPESA_STK" {
		msisdn := ""
		if req.BuyerMsisdn != nil {
			msisdn = *req.BuyerMsisdn
		}
		if msisdn == "" {
			resp["paymentError"] = "buyerMsisdn required for M-Pesa"
			c.JSON(http.StatusOK, resp)
			return
		}
		stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
			Msisdn: msisdn, AmountKES: parseKES(fare.AmountKES),
			AccountReference: fare.ID[:8], Description: "Esoqo fare",
		})
		if err != nil {
			resp["paymentError"] = err.Error()
			c.JSON(http.StatusOK, resp)
			return
		}
		// Not echoed — see handlePayParcel's note on the same field.
		_ = dbx.AttachFareCheckoutRequestID(c.Request.Context(), s.Pool, fare.ID, stk.CheckoutRequestID)
		if stk.AutoConfirmed {
			_ = dbx.ConfirmFarePaymentByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, "", s.Cfg.LoyaltyEarnEnabled)
			resp["status"] = "CONFIRMED"
		}
	}
	c.JSON(http.StatusOK, resp)
}

func (s *Server) handleGetFare(c *gin.Context) {
	fare, err := dbx.GetFare(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that fare")
		return
	}
	if fare == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Fare not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"fare": fare})
}

// ── declarations ─────────────────────────────────────────────────

type declareRequest struct {
	CrewID          string       `json:"crewId" binding:"required"`
	DeclaredCashKES money.Amount `json:"declaredCashKes"`
}

func (s *Server) handleDeclare(c *gin.Context) {
	var req declareRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.DeclareCollection(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.CrewID, req.DeclaredCashKES.KES()); err != nil {
		writeFleetError(c, err)
		return
	}
	s.recordFleetAudit(c, "fleet.collection.declared", "trip", c.Param("id"), map[string]interface{}{"crewId": req.CrewID, "declaredCashKes": req.DeclaredCashKES.KES()})
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) handleTripCollections(c *gin.Context) {
	summary, err := dbx.TripCollections(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"))
	if err != nil {
		writeFleetError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"summary": summary})
}

func writeFleetError(c *gin.Context, err error) {
	if authErr, ok := err.(*authsvc.AuthorisationError); ok {
		writeError(c, http.StatusForbidden, "DENIED", "Denied: "+authErr.Capability)
		return
	}
	if ferr, ok := err.(*dbx.FleetError); ok {
		status := http.StatusBadRequest
		switch ferr.Code {
		case "NOT_FOUND":
			status = http.StatusNotFound
		case "DENIED":
			status = http.StatusForbidden
		case "VEHICLE_BUSY", "VEHICLE_EXISTS", "TRIP_CLOSED":
			status = http.StatusConflict
		}
		writeError(c, status, ferr.Code, ferr.Message)
		return
	}
	if err == dbx.ErrOrgNotFound {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Organiser not found")
		return
	}
	writeError(c, http.StatusInternalServerError, "FAILED", "Could not complete that request")
}
