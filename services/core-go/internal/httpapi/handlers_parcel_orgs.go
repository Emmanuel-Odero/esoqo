package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/audit"
	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/notify"
)

// The courier-company operator surface.
//
// Every handler below reads its org from the SESSION (ctx.ParcelOrgID),
// never from the request. That is the entire tenancy boundary: an org
// id in a body or a path would make "whose parcels am I looking at" a
// client-supplied value, and no amount of checking downstream fixes
// that shape. The one exception is the public by-slug lookup, which
// exists precisely to be unauthenticated and returns nothing sensitive.

// orgCtx resolves the calling session's parcel org, or writes the
// error. Returns "" when the caller has no org session — which is a
// 403, not a 401: they may be perfectly well signed in, just not as
// anybody's courier company.
func (s *Server) orgCtx(c *gin.Context, capability string) string {
	ctx := ctxFromGin(c)
	if ctx.ParcelOrgID == "" {
		writeError(c, http.StatusForbidden, "DENIED", "Sign in as courier-company staff to do that")
		return ""
	}
	if err := authsvc.RequireCapability(ctx, capability, nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "Your role doesn't allow that")
		return ""
	}
	return ctx.ParcelOrgID
}

// handleGetParcelOrgBySlug — GET /v1/parcel-orgs/by-slug/:slug. Public,
// and deliberately thin: it backs the staff sign-in page, which has to
// show the company's name before anyone has authenticated. DRAFT
// companies don't resolve at all (see dbx.GetParcelOrgBySlug), so a
// half-onboarded tenant's URL isn't live before an admin says so.
func (s *Server) handleGetParcelOrgBySlug(c *gin.Context) {
	org, err := dbx.GetParcelOrgBySlug(c.Request.Context(), s.Pool, c.Param("slug"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that company")
		return
	}
	if org == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "No courier company at that address")
		return
	}
	// Name and slug only. Commission and settlement details are
	// commercial terms; a public sign-in screen has no reason to know
	// either, and this endpoint is the one place a competitor could
	// read them from without an account.
	c.JSON(http.StatusOK, gin.H{"org": gin.H{"name": org.Name, "slug": org.Slug}})
}

// handleListWalkInStations — GET /v1/parcels/stations. Public, same
// boundary as GET /v1/parcels/agents — a sender picking where they're
// standing hasn't signed in yet.
func (s *Server) handleListWalkInStations(c *gin.Context) {
	stations, err := dbx.ListWalkInStations(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load drop-off stations")
		return
	}
	c.JSON(http.StatusOK, gin.H{"stations": stations})
}

type parcelStaffSignInRequest struct {
	OrgSlug string `json:"orgSlug" binding:"required"`
	Name    string `json:"name"`
	EsoqoID string `json:"esokoId"`
	Pin     string `json:"pin" binding:"required"`
}

// handleParcelStaffSignIn — POST /v1/parcel-orgs/staff/signin. The
// courier-company equivalent of ticket-organiser staff sign-in, and
// deliberately identical in shape: free-typed name (never a staff
// picker — a dropdown of "who works here" is a roster anyone with the
// public slug can read), a dummy-hash verify on miss so a wrong name
// and a wrong PIN are indistinguishable, and a per-subject lockout
// because a 4-digit PIN behind a public slug is otherwise unlimited
// guesses at a named rider.
func (s *Server) handleParcelStaffSignIn(c *gin.Context) {
	var req parcelStaffSignInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	identifier := strings.TrimSpace(req.Name)
	subject := "parcelorg:" + strings.ToLower(req.OrgSlug+":"+identifier+":"+req.EsoqoID)
	if s.StaffLockout.Locked(c.Request.Context(), subject) {
		// Same message as a wrong PIN: saying "locked" would confirm the
		// company/name pair exists.
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Wrong company, name or PIN")
		return
	}

	staff, err := dbx.FindParcelStaffForSignIn(c.Request.Context(), s.Pool, req.OrgSlug, identifier)
	if strings.TrimSpace(req.EsoqoID) != "" {
		partyID, perr := dbx.PartyIDByEsoqoID(c.Request.Context(), s.Pool, req.EsoqoID)
		if perr == nil {
			staff, err = dbx.FindParcelStaffForSignInByPartyID(c.Request.Context(), s.Pool, req.OrgSlug, partyID)
		}
	}
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
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Wrong company, name or PIN")
		return
	}
	s.StaffLockout.Clear(c.Request.Context(), subject)

	caps, ok := authsvc.ParcelStaffCapabilities[staff.Role]
	if !ok {
		// Unknown role falls back to the narrowest bundle rather than
		// refusing: a role string that drifted should cost somebody the
		// dispatch screen, not their whole shift.
		caps = authsvc.ParcelStaffCapabilities["RIDER"]
	}
	var partyID string
	if staff.PartyID != nil {
		partyID = *staff.PartyID
	}
	// 12 hours — a shift, not a fortnight. Same TTL organiser staff get,
	// for the same reason: these logins live on shared devices.
	token, err := s.Session.CreateSession(c.Request.Context(), authsvc.SessionData{
		ActorType:    authsvc.ActorAgent,
		ActorID:      staff.ID,
		ParcelOrgID:  staff.OrgID,
		PartyID:      partyID,
		Capabilities: append([]string(nil), caps...),
	}, 12*time.Hour)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "Could not start a session")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"token": token, "orgId": staff.OrgID, "role": staff.Role, "name": staff.Name,
	})
}

// ── OTP staff sign-in — the public tracking page's hardened panel ──
//
// A separate credential from the name+PIN flow above, not a
// replacement for it: this exists specifically for the surface a
// stranger can already reach without knowing a company's own URL (see
// /parcels/track's "Authorized search" panel), where a shared PIN
// behind a public slug is a softer target than a code sent to a real
// phone nobody but that staffer holds. The dedicated company portal
// keeps using name+PIN.

type parcelStaffOtpRequest struct {
	OrgSlug string `json:"orgSlug" binding:"required"`
	Name    string `json:"name" binding:"required"`
}

// handleRequestParcelStaffOtp — POST /v1/parcel-orgs/staff/otp/request.
// Always answers the same way whether or not the name/org/phone
// actually resolve to anything sendable — same anti-enumeration
// convention RequestParcelClaimOtp already follows: a probe against a
// name that doesn't exist, or one whose role structurally carries no
// phone (an office-only MANAGER, see ParcelStaffMsisdn's own comment),
// gets an identical "check your phone" with nothing behind it.
func (s *Server) handleRequestParcelStaffOtp(c *gin.Context) {
	var req parcelStaffOtpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	msisdn, err := dbx.ParcelStaffMsisdn(c.Request.Context(), s.Pool, req.OrgSlug, req.Name)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "REQUEST_FAILED", "Could not send that code")
		return
	}
	if msisdn != "" {
		_, _ = s.OTP.IssueOtp(c.Request.Context(), msisdn, authsvc.OtpParcelStaffSignIn, clientIP(c))
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type parcelStaffOtpVerifyRequest struct {
	OrgSlug string `json:"orgSlug" binding:"required"`
	Name    string `json:"name" binding:"required"`
	Code    string `json:"code" binding:"required"`
}

// handleVerifyParcelStaffOtp — POST /v1/parcel-orgs/staff/otp/verify.
// Same lockout as the PIN flow (a 6-digit OTP behind a public slug is
// still a small enough space to guess without one), and a 10-hour
// session rather than the PIN flow's 12 — a deliberately shorter shift
// window for the surface reachable without knowing the company's own
// URL. expiresAt is returned here (unlike the PIN endpoint) precisely
// so this panel can render the countdown it promises.
func (s *Server) handleVerifyParcelStaffOtp(c *gin.Context) {
	var req parcelStaffOtpVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	subject := "parcelorg-otp:" + strings.ToLower(req.OrgSlug+":"+req.Name)
	if s.StaffLockout.Locked(c.Request.Context(), subject) {
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Wrong code")
		return
	}
	msisdn, err := dbx.ParcelStaffMsisdn(c.Request.Context(), s.Pool, req.OrgSlug, req.Name)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "VERIFY_FAILED", "Could not verify that code")
		return
	}
	ok := false
	if msisdn != "" {
		ok, err = s.OTP.VerifyOtp(c.Request.Context(), msisdn, authsvc.OtpParcelStaffSignIn, req.Code)
		if err != nil {
			writeError(c, http.StatusInternalServerError, "VERIFY_FAILED", "Could not verify that code")
			return
		}
	}
	if !ok {
		s.StaffLockout.RecordFailure(c.Request.Context(), subject)
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Wrong code")
		return
	}
	s.StaffLockout.Clear(c.Request.Context(), subject)

	staff, err := dbx.FindParcelStaffForSignIn(c.Request.Context(), s.Pool, req.OrgSlug, req.Name)
	if err != nil || staff == nil {
		// The OTP verified against a real msisdn a moment ago, so a miss
		// here means the staff row itself changed mid-flow (deactivated,
		// renamed) — genuinely exceptional, not a guessing attempt.
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "That account is no longer available")
		return
	}
	caps, capOk := authsvc.ParcelStaffCapabilities[staff.Role]
	if !capOk {
		caps = authsvc.ParcelStaffCapabilities["RIDER"]
	}
	var partyID string
	if staff.PartyID != nil {
		partyID = *staff.PartyID
	}
	const ttl = 10 * time.Hour
	token, err := s.Session.CreateSession(c.Request.Context(), authsvc.SessionData{
		ActorType:    authsvc.ActorAgent,
		ActorID:      staff.ID,
		ParcelOrgID:  staff.OrgID,
		PartyID:      partyID,
		Capabilities: append([]string(nil), caps...),
	}, ttl)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "Could not start a session")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"token": token, "orgId": staff.OrgID, "role": staff.Role, "name": staff.Name,
		"expiresAt": time.Now().Add(ttl).UnixMilli(),
	})
}

// handleGetMyParcelOrg — GET /v1/parcel-orgs/me. The dashboard header:
// who am I signed in as, and what does today look like.
func (s *Server) handleGetMyParcelOrg(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	org, err := dbx.GetParcelOrg(c.Request.Context(), s.Pool, orgID)
	if err != nil || org == nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load your company")
		return
	}
	stats, err := dbx.GetParcelOrgStats(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load your figures")
		return
	}
	ctx := ctxFromGin(c)
	// Earnings are a manager's business, not a rider's — zeroed rather
	// than omitted so the client renders one shape either way.
	if !authsvc.Can(ctx, authsvc.CapParcelOrgEarnings, nil) {
		stats.EarningsKes = 0
		stats.EarningsTodayKes = 0
	}
	c.JSON(http.StatusOK, gin.H{
		"org": gin.H{
			"id": org.ID, "name": org.Name, "slug": org.Slug, "status": org.Status,
		},
		"stats":        stats,
		"role":         ctx.ActorType,
		"capabilities": ctx.Capabilities,
		// expiresAt — unix millis, so a client can render "signed in
		// for another Xh Ym" without a separate call. 0 for a session
		// minted before this field existed.
		"expiresAt": ctx.ExpiresAt,
	})
}

// handleListMyOrgParcels — GET /v1/parcel-orgs/me/parcels?status=&originMethod=.
func (s *Server) handleListMyOrgParcels(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	var status *string
	if v := c.Query("status"); v != "" {
		status = &v
	}
	var originMethod *string
	if v := c.Query("originMethod"); v != "" {
		originMethod = &v
	}
	rows, err := dbx.ListOrgParcels(c.Request.Context(), s.Pool, orgID, status, originMethod)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your parcels")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": rows})
}

type assignOrgParcelRequest struct {
	RiderPartyID string `json:"riderPartyId" binding:"required"`
}

// handleAssignOrgParcel — POST /v1/parcel-orgs/me/parcels/:code/assign.
// A dispatcher handing one of their own parcels to one of their own
// riders. Both halves are org-checked (the parcel here, the rider
// inside dbx.AssignOrgParcel) so neither can point outside the company.
func (s *Server) handleAssignOrgParcel(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req assignOrgParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	code := c.Param("code")
	owns, err := dbx.ParcelBelongsToOrg(c.Request.Context(), s.Pool, code, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "ASSIGN_FAILED", "Could not load that parcel")
		return
	}
	if !owns {
		// Same answer for "doesn't exist" and "belongs to a competitor" —
		// anything else turns this into an oracle for whether an
		// arbitrary code is a real Esoqo parcel.
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That parcel isn't one of yours")
		return
	}
	if err := dbx.AssignOrgParcel(c.Request.Context(), s.Pool, code, orgID, req.RiderPartyID); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"assigned": true})
}

// handleListMyOrgStaff — GET /v1/parcel-orgs/me/staff.
func (s *Server) handleListMyOrgStaff(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgStaff)
	if orgID == "" {
		return
	}
	staff, err := dbx.ListParcelOrgStaff(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your team")
		return
	}
	c.JSON(http.StatusOK, gin.H{"staff": staff})
}

// handleListMyOrgPricing — GET /v1/parcel-orgs/me/pricing. Returns
// exactly what dbx.GetParcelPricing would resolve for this org on a real
// booking — the company sees its own override where it's set one, the
// platform default everywhere else — so there's no separate "preview"
// arithmetic to drift from what a sender's quote will actually use.
func (s *Server) handleListMyOrgPricing(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgWrite)
	if orgID == "" {
		return
	}
	pricing, err := dbx.ListParcelPricing(c.Request.Context(), s.Pool, &orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your pricing")
		return
	}
	c.JSON(http.StatusOK, gin.H{"pricing": pricing})
}

type upsertOrgPricingRequest struct {
	ParcelType string  `json:"parcelType" binding:"required"`
	MinKes     float64 `json:"minKes" binding:"required"`
	MaxKes     float64 `json:"maxKes" binding:"required"`
}

// handleUpsertMyOrgPricing — POST /v1/parcel-orgs/me/pricing. Manager-
// only (see CapParcelOrgWrite's own placement in ParcelStaffCapabilities)
// — a company's own rate is a commercial decision, the same tier as
// hiring staff, not something a dispatcher or rider can change. orgID
// comes from the session, same reasoning handleUpsertMyOrgStaff's own
// comment gives: a manager cannot price another company's parcels
// however the body is shaped.
func (s *Server) handleUpsertMyOrgPricing(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgWrite)
	if orgID == "" {
		return
	}
	var req upsertOrgPricingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.UpsertOrgParcelPricingRule(c.Request.Context(), s.Pool, orgID, req.ParcelType, req.MinKes, req.MaxKes); err != nil {
		writeParcelError(c, err)
		return
	}

	// A rate change is a commercial act, and the row it writes is an
	// in-place upsert that keeps no history of its own — ParcelPricingRule
	// carries updatedById, but that column is a StaffUser FK, so a
	// courier company's own manager has nowhere to sign. Without this
	// there was no way to answer "who dropped our envelope rate, and
	// when" after the fact. Best-effort, same as every other
	// RecordAudit caller: losing the audit row must not fail the save
	// the operator already saw succeed.
	ctx := ctxFromGin(c)
	var actorID, ip *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		actorID = &id
	}
	if v := clientIP(c); v != "" {
		ip = &v
	}
	targetType := "parcel_org"
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: string(ctx.ActorType), ActorID: actorID, IP: ip},
		audit.Input{
			Action:     "parcel_org.pricing_changed",
			TargetType: &targetType,
			TargetID:   &orgID,
			Payload: map[string]interface{}{
				"parcelType": req.ParcelType,
				"minKes":     req.MinKes,
				"maxKes":     req.MaxKes,
			},
		})
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

type upsertOrgStaffRequest struct {
	ID      *string `json:"id"`
	Name    string  `json:"name" binding:"required"`
	Role    string  `json:"role" binding:"required"`
	Pin     string  `json:"pin"`
	PartyID *string `json:"partyId"`
	Active  *bool   `json:"active"`
	// Msisdn — admin-invite-by-phone (see handleAdminUpsertParcelOrgStaff's
	// own comment). Only honoured on the admin endpoint; a manager
	// self-serving their own team still issues a PIN.
	Msisdn    *string `json:"msisdn"`
	EsoqoID   *string `json:"esokoId"`
	StationID *string `json:"stationId"`
}

// handleUpsertMyOrgStaff — POST /v1/parcel-orgs/me/staff. A manager
// issuing or editing a PIN login. orgID comes from the session, so a
// manager cannot create staff at another company however the body is
// shaped.
func (s *Server) handleUpsertMyOrgStaff(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgStaff)
	if orgID == "" {
		return
	}
	var req upsertOrgStaffRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !optionalMsisdn(c, &req.Msisdn, "That phone number") {
		return
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	// Hashed here, never stored or logged in the clear. An empty PIN on
	// an update means "leave it alone" (see dbx.UpsertParcelOrgStaff) —
	// making someone retype a PIN to change a role is the kind of
	// friction that ends with a whole depot sharing one login.
	var pinHash string
	if strings.TrimSpace(req.Pin) != "" {
		if len(req.Pin) < 4 {
			writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "A PIN needs at least 4 digits")
			return
		}
		h, err := authsvc.HashPin(req.Pin)
		if err != nil {
			writeError(c, http.StatusInternalServerError, "SAVE_FAILED", "Could not save that PIN")
			return
		}
		pinHash = h
	}
	if err := dbx.UpsertParcelOrgStaff(c.Request.Context(), s.Pool, req.ID, orgID,
		strings.TrimSpace(req.Name), req.Role, pinHash, req.PartyID, active, req.StationID); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

type orgStationRequest struct {
	Name         string  `json:"name" binding:"required"`
	Msisdn       string  `json:"msisdn" binding:"required"`
	LocationHint string  `json:"locationHint" binding:"required"`
	OpeningHours *string `json:"openingHours"`
	Lat          float64 `json:"lat" binding:"required"`
	Lng          float64 `json:"lng" binding:"required"`
	Capacity     int     `json:"capacity"`
	Active       *bool   `json:"active"`
}

func stationInput(req orgStationRequest) dbx.ParcelAgentInput {
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	if req.Capacity == 0 {
		req.Capacity = 50
	}
	return dbx.ParcelAgentInput{Name: req.Name, Msisdn: req.Msisdn, LocationHint: req.LocationHint, OpeningHours: req.OpeningHours, Lat: req.Lat, Lng: req.Lng, Capacity: req.Capacity, Active: active}
}

func (s *Server) handleListMyOrgStations(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgStations)
	if orgID == "" {
		return
	}
	stations, err := dbx.ListParcelOrgStations(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your stations")
		return
	}
	c.JSON(http.StatusOK, gin.H{"stations": stations})
}

func (s *Server) handleCreateMyOrgStation(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgStations)
	if orgID == "" {
		return
	}
	var req orgStationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.Msisdn, "The station phone number") {
		return
	}
	ctx := ctxFromGin(c)
	id, err := dbx.CreateParcelOrgStation(c.Request.Context(), s.Pool, orgID, stationInput(req), &ctx.ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

func (s *Server) handleUpdateMyOrgStation(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgStations)
	if orgID == "" {
		return
	}
	var req orgStationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.Msisdn, "The station phone number") {
		return
	}
	if err := dbx.UpdateParcelOrgStation(c.Request.Context(), s.Pool, orgID, c.Param("id"), stationInput(req)); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

// ── Esoqo admin: onboarding the companies themselves ─────────────────

type parcelOrgRequest struct {
	EnterpriseID    string  `json:"enterpriseId"`
	Name            string  `json:"name" binding:"required"`
	Slug            string  `json:"slug" binding:"required"`
	Status          string  `json:"status"`
	ContactPerson   *string `json:"contactPerson"`
	ContactPhone    *string `json:"contactPhone"`
	ContactEmail    *string `json:"contactEmail"`
	SettlementPhone *string `json:"settlementPhone"`
	CommissionPct   float64 `json:"commissionPct"`

	// AcceptsWalkIn/Lat/Lng/LocationHint/OpeningHours — see
	// ParcelOrg.acceptsWalkIn's own schema comment.
	AcceptsWalkIn bool     `json:"acceptsWalkIn"`
	Lat           *float64 `json:"lat"`
	Lng           *float64 `json:"lng"`
	LocationHint  *string  `json:"locationHint"`
	OpeningHours  *string  `json:"openingHours"`
}

func (r parcelOrgRequest) toInput() dbx.ParcelOrgInput {
	return dbx.ParcelOrgInput{
		EnterpriseID: r.EnterpriseID, Name: strings.TrimSpace(r.Name),
		Slug: strings.ToLower(strings.TrimSpace(r.Slug)), Status: r.Status,
		ContactPerson: r.ContactPerson, ContactPhone: r.ContactPhone,
		ContactEmail: r.ContactEmail, SettlementPhone: r.SettlementPhone,
		CommissionPct: r.CommissionPct,
		AcceptsWalkIn: r.AcceptsWalkIn, Lat: r.Lat, Lng: r.Lng,
		LocationHint: r.LocationHint, OpeningHours: r.OpeningHours,
	}
}

func (s *Server) handleAdminListParcelOrgs(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	orgs, err := dbx.ListParcelOrgs(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load courier companies")
		return
	}
	c.JSON(http.StatusOK, gin.H{"orgs": orgs})
}

func (s *Server) handleAdminCreateParcelOrg(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	var req parcelOrgRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if req.EnterpriseID == "" {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Pick the enterprise that runs this company")
		return
	}
	var staffID *string
	if ctx.ActorID != "" {
		staffID = &ctx.ActorID
	}
	id, err := dbx.CreateParcelOrg(c.Request.Context(), s.Pool, req.toInput(), staffID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

func (s *Server) handleAdminUpdateParcelOrg(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	var req parcelOrgRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.UpdateParcelOrg(c.Request.Context(), s.Pool, c.Param("id"), req.toInput()); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

// handleAdminUpsertParcelOrgStaff — the admin-side equivalent of
// handleUpsertMyOrgStaff, for onboarding a company's first manager
// before anyone there can sign in to create the rest themselves.
//
// Two ways in on create, and an admin picks one: a PIN for the
// dedicated company portal's name+PIN sign-in, or a phone number to
// invite this person by OTP instead — the harder-to-guess path
// handleRequestParcelStaffOtp already gates on a partyId/msisdn being
// on file (see ParcelStaffMsisdn's own comment), which today nothing
// ever sets. Providing Msisdn here is what actually invites someone:
// it resolves (or creates) their Party the same way admin-adding an
// independent courier does (dbx.FindOrCreatePersonWithName, mirroring
// AdminAddCourier), and texts them the sign-in link. Best-effort, same
// "don't fail account creation over a text" convention
// handleAdminAddCourier already follows for notify.CourierOnboarded.
func (s *Server) handleAdminUpsertParcelOrgStaff(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	var req upsertOrgStaffRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !optionalMsisdn(c, &req.Msisdn, "That phone number") {
		return
	}
	var pinHash string
	if strings.TrimSpace(req.Pin) != "" {
		if len(req.Pin) < 4 {
			writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "A PIN needs at least 4 digits")
			return
		}
		h, err := authsvc.HashPin(req.Pin)
		if err != nil {
			writeError(c, http.StatusInternalServerError, "SAVE_FAILED", "Could not save that PIN")
			return
		}
		pinHash = h
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}

	name := strings.TrimSpace(req.Name)
	partyID := req.PartyID
	if req.EsoqoID != nil && strings.TrimSpace(*req.EsoqoID) != "" {
		resolved, err := dbx.PartyIDByEsoqoID(c.Request.Context(), s.Pool, *req.EsoqoID)
		if err != nil {
			writeParcelError(c, err)
			return
		}
		partyID = &resolved
	}
	invite := req.Msisdn != nil && strings.TrimSpace(*req.Msisdn) != ""
	var msisdn string
	if invite {
		msisdn = strings.TrimSpace(*req.Msisdn)
		if !authsvc.IsAllowedPrefix(msisdn) {
			writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "That is not a Kenyan mobile number we can invite")
			return
		}
		resolvedPartyID, err := dbx.FindOrCreatePersonWithName(c.Request.Context(), s.Pool, name, msisdn, nil)
		if err != nil {
			writeError(c, http.StatusInternalServerError, "SAVE_FAILED", "Could not invite that person")
			return
		}
		partyID = &resolvedPartyID
	}

	if err := dbx.UpsertParcelOrgStaff(c.Request.Context(), s.Pool, req.ID, c.Param("id"),
		name, req.Role, pinHash, partyID, active, nil); err != nil {
		writeParcelError(c, err)
		return
	}

	if invite {
		if orgName, orgSlug, err := dbx.GetParcelOrgNameSlug(c.Request.Context(), s.Pool, c.Param("id")); err == nil {
			_ = authsvc.SendSms(msisdn, notify.ParcelStaffInvited(orgName, name, req.Role, notify.ParcelStaffInviteURL(orgSlug, name)), "PARCEL_STAFF_INVITE")
		}
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

type assignParcelOrgRequest struct {
	// Empty string means "take it back to Esoqo-operated dispatch" —
	// distinct from the field being absent, which JSON can't express
	// with a *string alone. A pointer to "" is the explicit unassign.
	ParcelOrgID *string `json:"parcelOrgId"`
}

// handleAdminAssignParcelOrg — POST /v1/admin/parcels/:id/org. Hands a
// parcel to a courier company (or takes it back).
//
// Only before pickup, and only before payment splits the money. Once
// paidAt is set, platformFeeKes/orgEarningsKes are frozen against a
// specific company (see dbx.SplitParcelRevenue) — moving the parcel
// after that would leave one company holding another's earnings, and
// silently corrupt every settlement report built on those two columns.
func (s *Server) handleAdminAssignParcelOrg(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.assign", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't assign parcels")
		return
	}
	var req assignParcelOrgRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	var orgID *string
	if req.ParcelOrgID != nil && strings.TrimSpace(*req.ParcelOrgID) != "" {
		trimmed := strings.TrimSpace(*req.ParcelOrgID)
		org, err := dbx.GetParcelOrg(c.Request.Context(), s.Pool, trimmed)
		if err != nil {
			writeError(c, http.StatusInternalServerError, "ASSIGN_FAILED", "Could not load that company")
			return
		}
		if org == nil || org.Status != dbx.ParcelOrgActive {
			writeError(c, http.StatusBadRequest, "BAD_INPUT", "That company isn't active")
			return
		}
		orgID = &trimmed
	}
	if err := dbx.AssignParcelToOrg(c.Request.Context(), s.Pool, c.Param("id"), orgID); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"assigned": true})
}

// handleAdminSearchEnterprises — GET /v1/admin/parcels/enterprises?q=.
// Backs the onboarding form's owner picker: a courier company hangs off
// an Enterprise exactly as a Store and a TicketOrg do, so creating one
// means naming which business runs it.
func (s *Server) handleAdminSearchEnterprises(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		// A blank query returns nothing rather than everything: this is a
		// picker, and the enterprise table is every business on the
		// platform.
		c.JSON(http.StatusOK, gin.H{"enterprises": []dbx.EnterpriseLite{}})
		return
	}
	list, err := dbx.SearchEnterprises(c.Request.Context(), s.Pool, q)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not search businesses")
		return
	}
	c.JSON(http.StatusOK, gin.H{"enterprises": list})
}

type createEnterpriseRequest struct {
	Name string `json:"name" binding:"required"`
}

// handleAdminCreateEnterprise — POST /v1/admin/parcels/enterprises. The
// other half of handleAdminSearchEnterprises: when no existing business
// matches, staff onboarding a courier company can register the owning
// business on the spot instead of being stuck (see
// dbx.CreateEnterpriseForCourierOrg's own comment on why the search
// alone was previously a dead end).
func (s *Server) handleAdminCreateEnterprise(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	var req createEnterpriseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	id, err := dbx.CreateEnterpriseForCourierOrg(c.Request.Context(), s.Pool, req.Name)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "name": strings.TrimSpace(req.Name)})
}

func (s *Server) handleAdminListParcelOrgStaff(c *gin.Context) {
	if err := authsvc.RequireCapability(ctxFromGin(c), "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	staff, err := dbx.ListParcelOrgStaff(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load that company's team")
		return
	}
	c.JSON(http.StatusOK, gin.H{"staff": staff})
}
