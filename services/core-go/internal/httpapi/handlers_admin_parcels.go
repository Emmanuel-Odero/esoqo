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
	"github.com/esoqo/core-go/internal/notify"
)

// Admin parcels console API — proxied to by the Next.js admin app's
// adminGo() the same way apps/admin/src/app/(dashboard)/ticketing
// already proxies to handlers_ticket_orgs.go, since Parcel is a
// Go-owned model. Every route requires a session (s.authRequired())
// and enforces via authsvc.RequireCapability — same
// "AuthorisationError → 403 DENIED" shape writeOrgError already uses.

// requireAnyCapability — a handful of admin GETs (courier list, zone
// list, the distance rate) should be visible to anyone who can see the
// parcels section at all, not gated behind the narrower capability
// that lets someone actually onboard a courier or edit pricing — same
// "parcels.read views, parcels.assign/cancel/refund act" split the
// main parcels list already follows. Denies only once none of the
// given capabilities are held.
func requireAnyCapability(ctx authsvc.Ctx, capabilities ...string) error {
	var lastErr error
	for _, capability := range capabilities {
		if err := authsvc.RequireCapability(ctx, capability, nil); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	return lastErr
}

func writeParcelAdminError(c *gin.Context, err error) {
	if authErr, ok := err.(*authsvc.AuthorisationError); ok {
		writeError(c, http.StatusForbidden, "DENIED", "Denied: "+authErr.Capability)
		return
	}
	writeParcelError(c, err)
}

// handleAdminListParcels — GET /v1/admin/parcels?status=&q=.
func (s *Server) handleAdminListParcels(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	params := dbx.AdminParcelListParams{Limit: 50}
	if v := c.Query("status"); v != "" {
		params.Status = &v
	}
	if v := c.Query("q"); v != "" {
		params.Q = &v
	}
	if v := c.Query("queue"); v != "" {
		params.Queue = &v
		// A queue is a worklist, so it defaults to longest-waiting
		// first; the unfiltered ledger stays newest-first, which is what
		// browsing wants. Either can be overridden with ?sort=.
		params.Oldest = true
	}
	switch c.Query("sort") {
	case "oldest":
		params.Oldest = true
	case "newest":
		params.Oldest = false
	}
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		params.Limit = v
	}
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		params.Offset = v
	}
	rows, total, err := dbx.AdminListParcels(c.Request.Context(), s.Pool, params)
	if err != nil {
		// An unknown queue slug is the caller's mistake, not ours —
		// writeParcelAdminError maps the BAD_INPUT ParcelError to a 400
		// rather than reporting a server failure for a bad query string.
		writeParcelAdminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"parcels": rows, "total": total,
		"limit": params.Limit, "offset": params.Offset,
	})
}

// handleAdminParcelStats — GET /v1/admin/parcels/stats. The overview
// panel every other admin section already has (registrations, stores,
// ticketing) — parcels didn't, and this is that.
func (s *Server) handleAdminParcelStats(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	stats, err := dbx.GetAdminParcelStats(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "STATS_FAILED", "Could not load parcel stats")
		return
	}
	c.JSON(http.StatusOK, stats)
}

// handleAdminSearchCollectors — GET /v1/admin/parcels/collectors?q=.
// Scoped to active ParcelCouriers (see dbx.SearchActiveCouriers's own
// comment) — the assign panel used to search "any Party with a phone"
// (dbx.CollectorLite/SearchCollectorParties), which is what let the
// admin "assign a collector" feature schedule someone who was never a
// real, vetted courier in the first place.
func (s *Server) handleAdminSearchCollectors(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	q := c.Query("q")
	if q == "" {
		c.JSON(http.StatusOK, gin.H{"collectors": []dbx.CollectorLite{}})
		return
	}
	rows, err := dbx.SearchActiveCouriers(c.Request.Context(), s.Pool, q)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SEARCH_FAILED", "Could not search collectors")
		return
	}
	c.JSON(http.StatusOK, gin.H{"collectors": rows})
}

type assignParcelCollectorRequest struct {
	CollectorPartyID string  `json:"collectorPartyId" binding:"required"`
	ScheduledAt      string  `json:"scheduledAt" binding:"required"` // RFC3339
	Note             *string `json:"note"`
}

// handleAssignParcelCollector — POST /v1/admin/parcels/:id/assign.
// Schedules who's coming to collect a paid, BOOKED parcel and sends
// the sender the "someone is coming" SMS immediately — distinct from
// the pickup SMS, which only fires once that collector actually scans
// the code (see handleScanParcelHandoff).
func (s *Server) handleAssignParcelCollector(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req assignParcelCollectorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	scheduledAt, err := time.Parse(time.RFC3339, req.ScheduledAt)
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "scheduledAt must be RFC3339")
		return
	}
	parcelID := c.Param("id")
	code, collectorName, err := s.assignOneParcel(c, parcelID, req.CollectorPartyID, scheduledAt, req.Note)
	if err != nil {
		writeParcelAdminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": code, "collectorName": collectorName, "scheduledAt": req.ScheduledAt})
}

// assignOneParcel is the whole of "schedule a collector": the DB write,
// the two SMS it triggers, and the audit record.
//
// Extracted so the single and bulk endpoints are the same action
// performed once or many times, rather than two implementations that
// will eventually disagree about whether the courier gets texted.
func (s *Server) assignOneParcel(
	c *gin.Context, parcelID, collectorPartyID string, scheduledAt time.Time, note *string,
) (code, collectorName string, err error) {
	ctx := ctxFromGin(c)
	code, collectorName, collectorMsisdn, senderMsisdn, senderName, originLabel, err :=
		dbx.AssignParcelCollector(c.Request.Context(), s.Pool, parcelID, collectorPartyID, scheduledAt, note)
	if err != nil {
		return "", "", err
	}

	scheduledWindow := scheduledAt.Format("15:04 on 2 Jan")
	if senderMsisdn != "" {
		_ = authsvc.SendSms(senderMsisdn, notify.ParcelCollectionScheduled(code, collectorName, collectorMsisdn, scheduledWindow), "PARCEL_COLLECTION_SCHEDULED")
	}
	// The courier themselves previously never heard about this — only
	// the sender was texted "someone is coming". A fleet driver isn't
	// necessarily watching the app's job list the way a gig courier
	// claiming their own jobs is, so they need their own alert.
	if collectorMsisdn != "" {
		_ = authsvc.SendSms(collectorMsisdn, notify.ParcelPickupAssigned(code, senderName, originLabel, scheduledWindow), "PARCEL_PICKUP_ASSIGNED")
	}

	var actorID *string
	if ctx.ActorID != "" {
		actorID = &ctx.ActorID
	}
	var ip *string
	if v := clientIP(c); v != "" {
		ip = &v
	}
	targetType := "parcel"
	// One audit row per parcel even in a bulk assign — the record of who
	// touched a given parcel must be findable from that parcel, not from
	// knowing which batch it happened to be swept into.
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: string(ctx.ActorType), ActorID: actorID, IP: ip},
		audit.Input{
			Action:     "parcel.collection_scheduled",
			TargetType: &targetType,
			TargetID:   &parcelID,
			Payload: map[string]interface{}{
				"collectorPartyId": collectorPartyID,
				"collectorName":    collectorName,
				"scheduledAt":      scheduledAt.Format(time.RFC3339),
			},
		})
	return code, collectorName, nil
}

type bulkAssignParcelsRequest struct {
	ParcelIDs        []string `json:"parcelIds" binding:"required"`
	CollectorPartyID string   `json:"collectorPartyId" binding:"required"`
	ScheduledAt      string   `json:"scheduledAt" binding:"required"` // RFC3339
	Note             *string  `json:"note"`
}

// handleBulkAssignParcels — POST /v1/admin/parcels/bulk-assign.
//
// Dispatching a rider for a morning round means assigning them eight
// parcels, which until now was eight trips through a modal. This is
// that, once.
//
// Partial success is reported, not rolled back. Each assignment sends
// real SMS to a sender and a courier the moment it succeeds — those
// cannot be recalled, so failing the whole batch because parcel six was
// already cancelled would leave five people told a rider is coming and
// an operator told nothing happened. "Six assigned, two skipped, here's
// why" is the honest report.
func (s *Server) handleBulkAssignParcels(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req bulkAssignParcelsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	// Bounded so one request can't hold a connection open sending
	// hundreds of SMS; 100 is far above a realistic round.
	if len(req.ParcelIDs) == 0 || len(req.ParcelIDs) > 100 {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Select between 1 and 100 parcels")
		return
	}
	scheduledAt, err := time.Parse(time.RFC3339, req.ScheduledAt)
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "scheduledAt must be RFC3339")
		return
	}

	type bulkResult struct {
		ParcelID string `json:"parcelId"`
		Code     string `json:"code,omitempty"`
		Error    string `json:"error,omitempty"`
	}
	assigned := make([]bulkResult, 0, len(req.ParcelIDs))
	failed := make([]bulkResult, 0)
	for _, id := range req.ParcelIDs {
		code, _, err := s.assignOneParcel(c, id, req.CollectorPartyID, scheduledAt, req.Note)
		if err != nil {
			failed = append(failed, bulkResult{ParcelID: id, Error: safeErrorMessage(err, "Could not assign that parcel")})
			continue
		}
		assigned = append(assigned, bulkResult{ParcelID: id, Code: code})
	}
	c.JSON(http.StatusOK, gin.H{"assigned": assigned, "failed": failed})
}

type cancelParcelRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// handleCancelParcel — POST /v1/admin/parcels/:id/cancel. Stops a
// draft or paid-but-not-yet-collected parcel; refunds Esoqo points
// automatically, flags an M-Pesa payment for manual refund (no
// Safaricom B2C integration here — see dbx.CancelParcel), and always
// tells the sender why.
func (s *Server) handleCancelParcel(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.cancel", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req cancelParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	parcelID := c.Param("id")
	result, err := dbx.CancelParcel(c.Request.Context(), s.Pool, parcelID, ctx.ActorID, req.Reason)
	if err != nil {
		writeParcelAdminError(c, err)
		return
	}

	if result.SenderMsisdn != "" {
		refundNote := ""
		if result.PointsRefunded {
			refundNote = "Your Esoqo points have been refunded."
		} else if result.NeedsManualRefund {
			refundNote = "Your M-Pesa payment will be refunded separately — expect a follow-up."
		}
		_ = authsvc.SendSms(result.SenderMsisdn, notify.ParcelCancelled(result.Code, req.Reason, refundNote), "PARCEL_CANCELLED")
	}

	var actorID *string
	if ctx.ActorID != "" {
		actorID = &ctx.ActorID
	}
	var ip *string
	if v := clientIP(c); v != "" {
		ip = &v
	}
	targetType := "parcel"
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: string(ctx.ActorType), ActorID: actorID, IP: ip},
		audit.Input{
			Action:     "parcel.cancelled",
			TargetType: &targetType,
			TargetID:   &parcelID,
			Payload: map[string]interface{}{
				"reason":            req.Reason,
				"pointsRefunded":    result.PointsRefunded,
				"needsManualRefund": result.NeedsManualRefund,
			},
		})

	c.JSON(http.StatusOK, gin.H{
		"code": result.Code, "status": "CANCELLED",
		"pointsRefunded": result.PointsRefunded, "needsManualRefund": result.NeedsManualRefund,
	})
}

type flagParcelExceptionRequest struct {
	Note string `json:"note" binding:"required"`
}

// handleFlagParcelException — POST /v1/admin/parcels/:id/exception.
// Uses the same "parcels.cancel" capability the other live-parcel
// admin interventions (cancel) already require — flagging an exception
// is a lighter-weight cousin of cancelling, not a separate permission
// worth its own capability.
func (s *Server) handleFlagParcelException(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.cancel", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req flagParcelExceptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	parcelID := c.Param("id")
	if err := dbx.FlagParcelException(c.Request.Context(), s.Pool, parcelID, req.Note, ctx.ActorID); err != nil {
		writeParcelAdminError(c, err)
		return
	}

	var actorID *string
	if ctx.ActorID != "" {
		actorID = &ctx.ActorID
	}
	var ip *string
	if v := clientIP(c); v != "" {
		ip = &v
	}
	targetType := "parcel"
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: string(ctx.ActorType), ActorID: actorID, IP: ip},
		audit.Input{
			Action:     "parcel.exception_flagged",
			TargetType: &targetType,
			TargetID:   &parcelID,
			Payload:    map[string]interface{}{"note": req.Note},
		})

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type updateParcelDetailsRequest struct {
	ReceiverName     string  `json:"receiverName" binding:"required"`
	ReceiverMsisdn   string  `json:"receiverMsisdn" binding:"required"`
	DestinationLabel string  `json:"destinationLabel" binding:"required"`
	Notes            *string `json:"notes"`
}

// handleUpdateParcelDetails — PATCH /v1/admin/parcels/:id. Correcting
// receiver contact info, destination, or notes — see
// dbx.UpdateParcelDetails's own comment on why this is its own
// capability, not folded into parcels.assign/cancel.
func (s *Server) handleUpdateParcelDetails(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.edit", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req updateParcelDetailsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.ReceiverMsisdn, "The receiver's phone number") {
		return
	}
	parcelID := c.Param("id")
	if err := dbx.UpdateParcelDetails(c.Request.Context(), s.Pool, parcelID, req.ReceiverName, req.ReceiverMsisdn, req.DestinationLabel, req.Notes); err != nil {
		writeParcelAdminError(c, err)
		return
	}

	var actorID *string
	if ctx.ActorID != "" {
		actorID = &ctx.ActorID
	}
	var ip *string
	if v := clientIP(c); v != "" {
		ip = &v
	}
	targetType := "parcel"
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: string(ctx.ActorType), ActorID: actorID, IP: ip},
		audit.Input{
			Action:     "parcel.details_updated",
			TargetType: &targetType,
			TargetID:   &parcelID,
			Payload: map[string]interface{}{
				"receiverName": req.ReceiverName, "receiverMsisdn": req.ReceiverMsisdn, "destinationLabel": req.DestinationLabel,
			},
		})

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleClearParcelException — POST /v1/admin/parcels/:id/exception/clear.
func (s *Server) handleClearParcelException(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.cancel", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	parcelID := c.Param("id")
	if err := dbx.ClearParcelException(c.Request.Context(), s.Pool, parcelID); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleMarkParcelRefunded — POST /v1/admin/parcels/:id/refund. Closes
// out a cancelled parcel's PENDING M-Pesa refund once an admin has
// actually processed it out of band (see dbx.MarkParcelRefunded) —
// previously CancelParcel's NeedsManualRefund flag was mentioned once
// in an SMS and then never tracked again.
func (s *Server) handleMarkParcelRefunded(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.refund", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	parcelID := c.Param("id")
	code, senderMsisdn, _, priceKes, err := dbx.MarkParcelRefunded(c.Request.Context(), s.Pool, parcelID, ctx.ActorID)
	if err != nil {
		writeParcelAdminError(c, err)
		return
	}
	if senderMsisdn != "" && priceKes != nil {
		_ = authsvc.SendSms(senderMsisdn, notify.ParcelRefunded(code, *priceKes), "PARCEL_REFUNDED")
	}

	var actorID *string
	if ctx.ActorID != "" {
		actorID = &ctx.ActorID
	}
	var ip *string
	if v := clientIP(c); v != "" {
		ip = &v
	}
	targetType := "parcel"
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: string(ctx.ActorType), ActorID: actorID, IP: ip},
		audit.Input{
			Action:     "parcel.refunded",
			TargetType: &targetType,
			TargetID:   &parcelID,
			Payload:    map[string]interface{}{"code": code},
		})

	c.JSON(http.StatusOK, gin.H{"code": code, "refundStatus": "REFUNDED"})
}

// ── Live dispatch map ──

// handleAdminGetLiveDispatch — GET /v1/admin/parcels/live. Active
// couriers' latest positions plus every parcel that needs one or is
// running late — see dbx.GetLiveDispatchView.
func (s *Server) handleAdminGetLiveDispatch(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	couriers, parcels, err := dbx.GetLiveDispatchView(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load the live view")
		return
	}
	c.JSON(http.StatusOK, gin.H{"couriers": couriers, "parcels": parcels})
}

// ── Zones & distance pricing ──

// handleAdminListParcelZones — GET /v1/admin/parcels/zones. Includes
// inactive zones (activeOnly=false), unlike the public listing — an
// admin editing the rate card needs to see (and reactivate) a retired
// zone, a booking form never should.
func (s *Server) handleAdminListParcelZones(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := requireAnyCapability(ctx, "parcels.read", "parcel_pricing.write"); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	zones, err := dbx.ListParcelZones(c.Request.Context(), s.Pool, false)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load zones")
		return
	}
	c.JSON(http.StatusOK, gin.H{"zones": zones})
}

type upsertParcelZoneRequest struct {
	Name   string  `json:"name" binding:"required"`
	Lat    float64 `json:"lat" binding:"required"`
	Lng    float64 `json:"lng" binding:"required"`
	Active *bool   `json:"active"`
}

// handleAdminCreateParcelZone — POST /v1/admin/parcels/zones.
func (s *Server) handleAdminCreateParcelZone(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcel_pricing.write", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req upsertParcelZoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	id, err := dbx.CreateParcelZone(c.Request.Context(), s.Pool, req.Name, req.Lat, req.Lng)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "CREATE_FAILED", "Could not create that zone")
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

// handleAdminUpdateParcelZone — PATCH /v1/admin/parcels/zones/:id.
func (s *Server) handleAdminUpdateParcelZone(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcel_pricing.write", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req upsertParcelZoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	if err := dbx.UpdateParcelZone(c.Request.Context(), s.Pool, c.Param("id"), req.Name, req.Lat, req.Lng, active); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleAdminGetDistanceRate — GET /v1/admin/parcels/distance-rate.
func (s *Server) handleAdminGetDistanceRate(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := requireAnyCapability(ctx, "parcels.read", "parcel_pricing.write"); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	rate, err := dbx.GetParcelDistanceRate(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load the distance rate")
		return
	}
	c.JSON(http.StatusOK, gin.H{"rate": rate})
}

type setDistanceRateRequest struct {
	PerKmKes        money.Amount `json:"perKmKes" binding:"required"`
	MinChargeableKm float64      `json:"minChargeableKm"`
}

// handleAdminSetDistanceRate — POST /v1/admin/parcels/distance-rate.
func (s *Server) handleAdminSetDistanceRate(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcel_pricing.write", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req setDistanceRateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	minKm := req.MinChargeableKm
	if minKm <= 0 {
		minKm = 1
	}
	if err := dbx.SetParcelDistanceRate(c.Request.Context(), s.Pool, req.PerKmKes.KES(), minKm, ctx.ActorID); err != nil {
		writeError(c, http.StatusInternalServerError, "SAVE_FAILED", "Could not save the distance rate")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Courier fleet management ──

// handleAdminSearchOnboardCandidates — GET /v1/admin/parcels/couriers/candidates?q=.
// Any Party with a phone (dbx.SearchCollectorParties — the same lookup
// AssignPanel's collector search used to be before it was scoped to
// active couriers only, see handleAdminSearchCollectors's own comment)
// — onboarding has to start from "anyone", not just existing couriers.
func (s *Server) handleAdminSearchOnboardCandidates(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := requireAnyCapability(ctx, "parcels.read", "parcels.couriers.manage"); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	q := c.Query("q")
	if q == "" {
		c.JSON(http.StatusOK, gin.H{"candidates": []dbx.CollectorLite{}})
		return
	}
	rows, err := dbx.SearchCollectorParties(c.Request.Context(), s.Pool, q)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SEARCH_FAILED", "Could not search")
		return
	}
	c.JSON(http.StatusOK, gin.H{"candidates": rows})
}

// handleAdminListCouriers — GET /v1/admin/parcels/couriers?status=&q=.
func (s *Server) handleAdminListCouriers(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := requireAnyCapability(ctx, "parcels.read", "parcels.couriers.manage"); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var status, q *string
	if v := c.Query("status"); v != "" {
		status = &v
	}
	if v := c.Query("q"); v != "" {
		q = &v
	}
	rows, err := dbx.ListCouriers(c.Request.Context(), s.Pool, status, q)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load couriers")
		return
	}
	c.JSON(http.StatusOK, gin.H{"couriers": rows})
}

type onboardCourierRequest struct {
	PartyID     string `json:"partyId" binding:"required"`
	VehicleType string `json:"vehicleType" binding:"required"`
}

// handleOnboardCourier — POST /v1/admin/parcels/couriers. Onboards an
// existing Party (found via the same collector search the assign panel
// already uses) as PENDING_VETTING.
func (s *Server) handleOnboardCourier(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.couriers.manage", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req onboardCourierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	courierID, err := dbx.OnboardCourier(c.Request.Context(), s.Pool, req.PartyID, req.VehicleType)
	if err != nil {
		writeParcelCourierError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"courierId": courierID, "status": "PENDING_VETTING"})
}

type adminAddCourierRequest struct {
	Name        string  `json:"name" binding:"required"`
	Msisdn      string  `json:"msisdn" binding:"required"`
	Email       *string `json:"email"`
	VehicleType string  `json:"vehicleType" binding:"required"`
}

// handleAdminAddCourier — POST /v1/admin/parcels/couriers/add. The
// "just add them" path for a courier team member who's never signed
// up on their own — same capability as onboarding an existing Party
// (parcels.couriers.manage), since it ends at the same PENDING_VETTING
// state either way. Texts the new courier their Esoqo ID the moment
// the account exists — see notify.CourierOnboarded — best-effort: a
// missing text is a communication gap, not a reason to fail an
// account that already exists (same reasoning notifyContributionConfirmed
// already follows for its own best-effort broadcast).
func (s *Server) handleAdminAddCourier(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.couriers.manage", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req adminAddCourierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.Msisdn, "The courier's phone number") {
		return
	}
	courierID, _, esoqoID, err := dbx.AdminAddCourier(c.Request.Context(), s.Pool, dbx.AdminAddCourierInput{
		Name: req.Name, Msisdn: req.Msisdn, Email: req.Email, VehicleType: req.VehicleType,
	})
	if err != nil {
		writeParcelCourierError(c, err)
		return
	}
	_ = authsvc.SendSms(req.Msisdn, notify.CourierOnboarded(req.Name, esoqoID), "COURIER_ONBOARDED")
	c.JSON(http.StatusOK, gin.H{"courierId": courierID, "esoqoId": esoqoID, "status": "PENDING_VETTING"})
}

type setCourierStatusRequest struct {
	Status string  `json:"status" binding:"required"` // ACTIVE | SUSPENDED | REJECTED | PENDING_VETTING
	Note   *string `json:"note"`
}

// handleSetCourierStatus — POST /v1/admin/parcels/couriers/:id/status.
func (s *Server) handleSetCourierStatus(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.couriers.manage", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req setCourierStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.SetCourierStatus(c.Request.Context(), s.Pool, c.Param("id"), req.Status, req.Note); err != nil {
		writeParcelCourierError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": req.Status})
}

// handleGetCourierPerformance — GET /v1/admin/parcels/couriers/:id/performance.
// Keyed by partyId (query param), not the courier row id — the caller
// already has both from the list response, and every downstream
// join (parcel.currentHolderPartyId) is keyed on partyId.
func (s *Server) handleGetCourierPerformance(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := requireAnyCapability(ctx, "parcels.read", "parcels.couriers.manage"); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	perf, err := dbx.GetCourierPerformance(c.Request.Context(), s.Pool, c.Query("partyId"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load performance")
		return
	}
	c.JSON(http.StatusOK, perf)
}

func writeParcelCourierError(c *gin.Context, err error) {
	if ce, ok := err.(*dbx.ParcelCourierError); ok {
		status := http.StatusBadRequest
		if ce.Code == "NOT_FOUND" {
			status = http.StatusNotFound
		}
		writeError(c, status, ce.Code, ce.Message)
		return
	}
	writeParcelAdminError(c, err)
}

// handleAdminListParcelHandoffs — GET /v1/admin/parcels/:id/handoffs.
// The admin console's unscoped equivalent of handleListParcelHandoffs —
// the parcel_handoff log was write-only until now (nothing ever read
// it back), so an operator had no way to see who's actually held a
// parcel and when.
func (s *Server) handleAdminListParcelHandoffs(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	rows, err := dbx.ListParcelHandoffs(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load handling history")
		return
	}
	c.JSON(http.StatusOK, gin.H{"handoffs": rows})
}

// ── Pre-printed label stock ──
// A pool of blank PKG-… codes minted ahead of any booking — see
// dbx.ParcelLabelStock's own comment. Print a batch, stick them on
// envelopes/boxes in advance, then BookParcel's ExistingCode binds one
// to a real shipment the moment it's needed.

type generateParcelLabelsRequest struct {
	Count int `json:"count" binding:"required"`
	// ParcelOrgID — the company this pad is printed for. Omitted mints
	// into the shared Esoqo pool. Trustworthy here only because the
	// route already requires platform staff; see the handler.
	ParcelOrgID *string `json:"parcelOrgId"`
}

// handleAdminGenerateParcelLabels — POST /v1/admin/parcels/labels/generate.
// Same trust tier as scheduling a collector (parcels.assign) — this is
// an operational/dispatch task, not a pricing or cancellation one.
func (s *Server) handleAdminGenerateParcelLabels(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req generateParcelLabelsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	var staffID *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		staffID = &id
	}
	// Platform staff may mint for any company; an omitted parcelOrgId
	// mints into the shared Esoqo pool, which is every label to date.
	// A company minting its own pad goes through the org-scoped route
	// instead, where the org is taken from the session rather than the
	// body — see BookParcelInput.BinderOrgID on why a body field can
	// never be the one that decides ownership.
	var orgID *string
	if req.ParcelOrgID != nil && strings.TrimSpace(*req.ParcelOrgID) != "" {
		trimmed := strings.TrimSpace(*req.ParcelOrgID)
		orgID = &trimmed
	}
	codes, batchID, err := dbx.GenerateParcelLabelStock(c.Request.Context(), s.Pool, req.Count, staffID, orgID)
	if err != nil {
		writeParcelAdminError(c, err)
		return
	}
	// Sign immediately so the first print is already genuine — the mint
	// response used to return codes only, which printed unsigned until
	// reload. orgID/batchID are what SignLabel binds, both known here.
	orgStr := ""
	if orgID != nil {
		orgStr = *orgID
	}
	labels := make([]gin.H, 0, len(codes))
	for _, code := range codes {
		labels = append(labels, gin.H{
			"code": code,
			"sig":  fleetqr.SignLabel(s.Cfg.FleetQrSecret, code, orgStr, batchID),
		})
	}
	c.JSON(http.StatusOK, gin.H{"codes": codes, "labels": labels, "batchId": batchID})
}

// handleAdminSearchCounterParties — GET /v1/admin/parcels/parties?q=.
//
// The counter's address book. Gated on parcels.assign rather than
// parcels.read: this returns names paired with phone numbers across
// every customer the network has, which is a contact list, not a
// lookup — it belongs with the people who take parcels in, not with
// everyone who can view the parcels section.
func (s *Server) handleAdminSearchCounterParties(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	rows, err := dbx.SearchCounterParties(c.Request.Context(), s.Pool, c.Query("q"), 8)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SEARCH_FAILED", "Could not search")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parties": rows})
}

// handleAdminListParcelLabelRegister — GET /v1/admin/parcels/labels/register?state=&parcelOrgId=.
//
// Every label, in whatever state it has reached. The pool listing this
// sits beside only ever showed never-touched stock, which meant filling
// a label in made it disappear from the product — see
// dbx.ListParcelLabelRegister on the write-only data that created.
func (s *Server) handleAdminListParcelLabelRegister(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	state := c.Query("state")
	if state == "" {
		state = "blank"
	}
	var orgID *string
	if v := c.Query("parcelOrgId"); v != "" {
		orgID = &v
	}
	rows, err := dbx.ListParcelLabelRegister(c.Request.Context(), s.Pool, state, orgID, 200)
	if err != nil {
		writeParcelAdminError(c, err)
		return
	}
	// Sign every row so reprints from the register are genuine without a
	// second fetch — same secret/fields as the stock endpoint.
	for i := range rows {
		batch := ""
		if rows[i].BatchID != nil {
			batch = *rows[i].BatchID
		}
		rows[i].Sig = fleetqr.SignLabel(s.Cfg.FleetQrSecret, rows[i].Code, rows[i].ParcelOrgID, batch)
	}
	counts, err := dbx.CountParcelLabelStates(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not count label states")
		return
	}
	c.JSON(http.StatusOK, gin.H{"labels": rows, "counts": counts})
}

// handleAdminListParcelLabelBatches — GET /v1/admin/parcels/labels/batches.
// The pads, not the stickers: how many were printed, how many are
// still usable, and how many have been spent or withdrawn since.
func (s *Server) handleAdminListParcelLabelBatches(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var orgID *string
	if v := c.Query("parcelOrgId"); v != "" {
		orgID = &v
	}
	rows, err := dbx.ListParcelLabelBatches(c.Request.Context(), s.Pool, orgID, 100)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load label batches")
		return
	}
	c.JSON(http.StatusOK, gin.H{"batches": rows})
}

type voidParcelLabelBatchRequest struct {
	Reason      string  `json:"reason" binding:"required"`
	ParcelOrgID *string `json:"parcelOrgId"`
}

// handleVoidParcelLabelBatch — POST /v1/admin/parcels/labels/batches/:id/void.
//
// The "a pad walked out of the branch" button. parcels.assign rather
// than parcels.read: withdrawing stock is the inverse of minting it and
// belongs at the same trust tier.
func (s *Server) handleVoidParcelLabelBatch(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req voidParcelLabelBatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	var staffID *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		staffID = &id
	}
	var orgID *string
	if req.ParcelOrgID != nil && strings.TrimSpace(*req.ParcelOrgID) != "" {
		trimmed := strings.TrimSpace(*req.ParcelOrgID)
		orgID = &trimmed
	}
	batchID := c.Param("id")
	voided, err := dbx.VoidParcelLabelBatch(c.Request.Context(), s.Pool, batchID, orgID, req.Reason, staffID)
	if err != nil {
		writeParcelAdminError(c, err)
		return
	}
	// Withdrawing stock is a loss event — somebody will want to know who
	// called it and why, long after the pad itself is forgotten.
	var actorID *string
	if ctx.ActorID != "" {
		actorID = &ctx.ActorID
	}
	var ip *string
	if v := clientIP(c); v != "" {
		ip = &v
	}
	targetType := "parcel_label_batch"
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: string(ctx.ActorType), ActorID: actorID, IP: ip},
		audit.Input{
			Action:     "parcel.label_batch_voided",
			TargetType: &targetType,
			TargetID:   &batchID,
			Payload:    map[string]interface{}{"reason": req.Reason, "voided": voided},
		})
	c.JSON(http.StatusOK, gin.H{"voided": voided})
}

// handleAdminListParcelLabelStock — GET /v1/admin/parcels/labels?limit=.
func (s *Server) handleAdminListParcelLabelStock(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	limit := 200
	if v := c.Query("limit"); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil {
			limit = parsed
		}
	}
	var orgID *string
	if v := c.Query("parcelOrgId"); v != "" {
		orgID = &v
	}
	rows, err := dbx.ListUnusedParcelLabelStock(c.Request.Context(), s.Pool, limit, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load label stock")
		return
	}
	// Signed here rather than in dbx: the secret belongs to the service,
	// not the data layer, and this is the only place that needs to put
	// one on a label. See fleetqr.SignLabel on what the signature is
	// and — more importantly — what it is not.
	for i := range rows {
		rows[i].Sig = fleetqr.SignLabel(s.Cfg.FleetQrSecret, rows[i].Code, rows[i].ParcelOrgID, rows[i].BatchID)
	}
	c.JSON(http.StatusOK, gin.H{"labels": rows})
}

type attachParcelLabelInfoRequest struct {
	ItemDescription  string   `json:"itemDescription" binding:"required"`
	Destination      *string  `json:"destination"`
	SenderName       *string  `json:"senderName"`
	SenderMsisdn     *string  `json:"senderMsisdn"`
	ReceiverName     *string  `json:"receiverName"`
	ReceiverMsisdn   *string  `json:"receiverMsisdn"`
	ItemType         *string  `json:"itemType"`
	WeightRangeKg    *string  `json:"weightRangeKg"`
	LengthCm         *float64 `json:"lengthCm"`
	WidthCm          *float64 `json:"widthCm"`
	HeightCm         *float64 `json:"heightCm"`
}

// handleAttachParcelLabelInfo — POST /v1/admin/parcels/labels/:code/info.
// Same trust tier as generating labels in the first place
// (parcels.assign) — writing what a pre-printed label is now stuck on
// is the same operational/dispatch class of action.
func (s *Server) handleAttachParcelLabelInfo(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req attachParcelLabelInfoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	var staffID *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		staffID = &id
	}
	in := dbx.ParcelLabelInfoInput{
		ItemDescription: req.ItemDescription,
		Destination:     req.Destination,
		SenderName:      req.SenderName,
		SenderMsisdn:    req.SenderMsisdn,
		ReceiverName:    req.ReceiverName,
		ReceiverMsisdn:  req.ReceiverMsisdn,
		ItemType:        req.ItemType,
		WeightRangeKg:   req.WeightRangeKg,
		LengthCm:        req.LengthCm,
		WidthCm:         req.WidthCm,
		HeightCm:        req.HeightCm,
	}
	if err := dbx.AttachParcelLabelInfo(c.Request.Context(), s.Pool, c.Param("code"), in, staffID); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleGetParcelLabelInfo — GET /v1/admin/parcels/labels/info/:code.
// The read half of the attach flow, so an edit form loads what's
// already on a label instead of opening blank over it — see
// dbx.GetParcelLabelStockInfo on why the overwrite semantics make this
// load mandatory rather than a nicety. Same parcels.assign tier as the
// write: this returns a handler's own field notes, including sender
// and receiver names and contacts, which is not public-scan material.
//
// `info` is null for a real but still-blank label — the ordinary
// first-attach case, and a 200 rather than a 404, since the label
// itself was found.
func (s *Server) handleGetParcelLabelInfo(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	info, err := dbx.GetParcelLabelStockInfo(c.Request.Context(), s.Pool, c.Param("code"))
	if err != nil {
		writeParcelAdminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"info": info})
}
