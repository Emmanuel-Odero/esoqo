package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/payments"
)

// Organiser console API — every route below requires a session and
// enforces via dbx.AssertOwnsOrg (owner :own match) or the AGENT
// ticketOrgId match / STAFF unqualified caps. The Next.js console
// forwards its subject/staff cookie as Bearer and maps
// {error:{code,message}} onto its existing form errors.

func writeOrgError(c *gin.Context, err error) {
	if authErr, ok := err.(*authsvc.AuthorisationError); ok {
		writeError(c, http.StatusForbidden, "DENIED", "Denied: "+authErr.Capability)
		return
	}
	if oerr, ok := err.(*dbx.OrgError); ok {
		status := http.StatusBadRequest
		switch oerr.Code {
		case "NOT_FOUND":
			status = http.StatusNotFound
		case "DENIED":
			status = http.StatusForbidden
		case "SLUG_TAKEN":
			status = http.StatusConflict
		}
		writeError(c, status, oerr.Code, oerr.Message)
		return
	}
	if err == dbx.ErrOrgNotFound {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Organiser not found")
		return
	}
	writeError(c, http.StatusInternalServerError, "FAILED", "Could not complete that request")
}

// ── orgs ─────────────────────────────────────────────────────────

type createTicketOrgRequest struct {
	EnterpriseID string  `json:"enterpriseId" binding:"required"`
	Name         string  `json:"name" binding:"required"`
	Vertical     string  `json:"vertical" binding:"required"`
	ContactPhone *string `json:"contactPhone"`
	ContactEmail *string `json:"contactEmail"`
}

func (s *Server) handleCreateTicketOrg(c *gin.Context) {
	var req createTicketOrgRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	org, err := dbx.CreateTicketOrg(c.Request.Context(), s.Pool, ctxFromGin(c),
		req.EnterpriseID, req.Name, req.Vertical, req.ContactPhone, req.ContactEmail)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"org": org})
}

func (s *Server) handleGetTicketOrg(c *gin.Context) {
	org, err := dbx.GetTicketOrg(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"org": org})
}

func (s *Server) handleGetTicketOrgBySlug(c *gin.Context) {
	org, err := dbx.GetTicketOrgBySlug(c.Request.Context(), s.Pool, c.Param("slug"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load organiser")
		return
	}
	if org == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Organiser not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"org": org})
}

// ── venues & routes ──────────────────────────────────────────────

func (s *Server) handleListVenuesRoutes(c *gin.Context) {
	venues, routes, err := dbx.ListOrgVenuesAndRoutes(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"venues": venues, "routes": routes})
}

type createVenueRequest struct {
	Name     string  `json:"name" binding:"required"`
	Address  *string `json:"address"`
	County   *string `json:"county"`
	Capacity *int    `json:"capacity"`
}

func (s *Server) handleCreateVenue(c *gin.Context) {
	var req createVenueRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	venue, err := dbx.CreateVenue(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Name, req.Address, req.County, req.Capacity)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"venue": venue})
}

type createRouteRequest struct {
	OriginName      string `json:"originName" binding:"required"`
	DestinationName string `json:"destinationName" binding:"required"`
	DistanceKM      *int   `json:"distanceKm"`
}

func (s *Server) handleCreateOrgRoute(c *gin.Context) {
	var req createRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	route, err := dbx.CreateOrgRoute(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.OriginName, req.DestinationName, req.DistanceKM)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"route": route})
}

// ── listings ─────────────────────────────────────────────────────

func (s *Server) handleListOrgListings(c *gin.Context) {
	listings, err := dbx.ListOrgListings(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"listings": listings})
}

func (s *Server) handleGetOrgListing(c *gin.Context) {
	listing, err := dbx.GetOrgListing(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), c.Param("listingId"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"listing": listing})
}

type createListingRequest struct {
	Title         string  `json:"title" binding:"required"`
	Description   *string `json:"description"`
	CoverImageURL *string `json:"coverImageUrl"`
	VenueID       *string `json:"venueId"`
	RouteID       *string `json:"routeId"`
}

func (s *Server) handleCreateListing(c *gin.Context) {
	var req createListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	listing, err := dbx.CreateListing(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"),
		req.Title, req.Description, req.CoverImageURL, req.VenueID, req.RouteID)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"listing": listing})
}

type publishListingRequest struct {
	Status string `json:"status" binding:"required"`
}

func (s *Server) handlePublishListing(c *gin.Context) {
	var req publishListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.PublishListing(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Status); err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type createTicketClassRequest struct {
	Name        string   `json:"name" binding:"required"`
	PriceKES    float64  `json:"priceKes" binding:"required"`
	Capacity    int      `json:"capacity" binding:"required"`
	Seated      bool     `json:"seated"`
	Amenities   []string `json:"amenities"`
	AmenityNote *string  `json:"amenityNote"`
}

func (s *Server) handleCreateTicketClass(c *gin.Context) {
	var req createTicketClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	tc, err := dbx.CreateTicketClass(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"),
		req.Name, req.PriceKES, req.Capacity, req.Seated, req.Amenities, req.AmenityNote)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ticketClass": tc})
}

type createScheduleRequest struct {
	DepartAt           *string `json:"departAt"`
	ArriveAt           *string `json:"arriveAt"`
	GateInfo           *string `json:"gateInfo"`
	VehicleOrHallLabel *string `json:"vehicleOrHallLabel"`
}

func (s *Server) handleCreateSchedule(c *gin.Context) {
	var req createScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	sched, err := dbx.CreateSchedule(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"),
		req.DepartAt, req.ArriveAt, req.GateInfo, req.VehicleOrHallLabel)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"schedule": sched})
}

type saveSeatMapRequest struct {
	Rows    int    `json:"rows" binding:"required"`
	Pattern string `json:"pattern" binding:"required"`
	Seats   []struct {
		Label         string `json:"label" binding:"required"`
		TicketClassID string `json:"ticketClassId" binding:"required"`
	} `json:"seats" binding:"required"`
}

func (s *Server) handleSaveSeatMap(c *gin.Context) {
	var req saveSeatMapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	seats := make([]dbx.SeatMapSeatInput, len(req.Seats))
	for i, st := range req.Seats {
		seats[i] = dbx.SeatMapSeatInput{Label: st.Label, TicketClassID: st.TicketClassID}
	}
	if err := dbx.SaveSeatMap(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Rows, req.Pattern, seats); err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (s *Server) handleGetSeatMap(c *gin.Context) {
	m, err := dbx.GetSeatMap(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"seatMap": m})
}

type createAddonRequest struct {
	Name     string  `json:"name" binding:"required"`
	PriceKES float64 `json:"priceKes" binding:"required"`
}

func (s *Server) handleCreateAddon(c *gin.Context) {
	var req createAddonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	addon, err := dbx.CreateAddon(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Name, req.PriceKES)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"addon": addon})
}

// ── staff ────────────────────────────────────────────────────────

func (s *Server) handleListOrgStaff(c *gin.Context) {
	staff, err := dbx.ListTicketOrgStaff(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"staff": staff})
}

type createOrgStaffRequest struct {
	Name string `json:"name" binding:"required"`
	Pin  string `json:"pin" binding:"required"`
	Role string `json:"role"`
}

func (s *Server) handleCreateOrgStaff(c *gin.Context) {
	var req createOrgStaffRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	// PIN hashing happens at this boundary (never stored raw) — the Go
	// side of packages/auth/src/pin.ts's contract. Weak PINs are refused
	// like the subject flow.
	if authsvc.IsWeakPin(req.Pin) {
		writeError(c, http.StatusBadRequest, "WEAK_PIN", "Choose a less guessable PIN")
		return
	}
	hash, err := authsvc.HashPin(req.Pin)
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_PIN", err.Error())
		return
	}
	role := req.Role
	if role == "" {
		role = "SCANNER"
	}
	staff, err := dbx.CreateTicketOrgStaff(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Name, hash, role)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"staff": staff})
}

type setStaffActiveRequest struct {
	Active bool `json:"active"`
}

func (s *Server) handleSetOrgStaffActive(c *gin.Context) {
	var req setStaffActiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.SetTicketOrgStaffActive(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Active); err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── bookings / check-in / cancel ─────────────────────────────────

func (s *Server) handleListOrgBookings(c *gin.Context) {
	bookings, err := dbx.ListOrgBookings(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bookings})
}

type checkInRequest struct {
	Code string `json:"code" binding:"required"`
}

func (s *Server) handleCheckInTicket(c *gin.Context) {
	var req checkInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	result, err := dbx.CheckInTicket(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"), req.Code)
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticketId": result.TicketID})
}

func (s *Server) handleCancelBooking(c *gin.Context) {
	if err := dbx.CancelBooking(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id")); err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleRetryBookingPayment — authenticated buyer re-push. Fires a
// fresh STK push against the same booking (seats stay claimed) and
// attaches the new checkout id, autoconfirming in console mode.
func (s *Server) handleRetryBookingPayment(c *gin.Context) {
	msisdn, totalKES, err := dbx.RetryBookingPayment(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	resp := gin.H{"status": "PENDING_PAYMENT"}
	stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
		Msisdn: msisdn, AmountKES: parseKES(totalKES),
		AccountReference: c.Param("id")[:8], Description: "Esoko ticket",
	})
	if err != nil {
		resp["paymentError"] = err.Error()
		c.JSON(http.StatusOK, resp)
		return
	}
	_ = dbx.AttachBookingCheckoutRequestID(c.Request.Context(), s.Pool, c.Param("id"), stk.CheckoutRequestID)
	resp["checkoutRequestId"] = stk.CheckoutRequestID
	if stk.AutoConfirmed {
		_ = dbx.ConfirmBookingPaymentByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID, s.Cfg.LoyaltyEarnEnabled)
		resp["status"] = "PAID"
	}
	c.JSON(http.StatusOK, resp)
}

// ── buyer reads (rich) ───────────────────────────────────────────

func (s *Server) handleListMyBookingsRich(c *gin.Context) {
	bookings, err := dbx.ListMyBookingsRich(c.Request.Context(), s.Pool, ctxFromGin(c))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bookings})
}

// handleGetBookingStatus — public with the same trust model as TS
// getBookingStatus: party-owned bookings need a matching bearer,
// guest bookings treat the id as the secret.
func (s *Server) handleGetBookingStatus(c *gin.Context) {
	// Optional bearer: party-owned bookings need a matching session,
	// guest bookings treat the id as the secret (dbx enforces both).
	ctx := ctxFromGin(c)
	if token := bearerToken(c); token != "" {
		if full, _ := s.Session.CtxFromToken(c.Request.Context(), token, clientIP(c)); full != nil {
			ctx = *full
		}
	}
	status, err := dbx.GetBookingStatus(c.Request.Context(), s.Pool, ctx, c.Param("id"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": status})
}

func (s *Server) handleGetBookingBalanceView(c *gin.Context) {
	view, err := dbx.GetBookingBalanceView(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeOrgError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"booking": view})
}

// ── GET /v1/me/orgs (authenticated) ──────────────────────────────
// Ticketing companies the signed-in subject owns — drives the mobile
// manager switcher. Empty (not 403) for non-owners.

func (s *Server) handleListMyOrgs(c *gin.Context) {
	orgs, err := dbx.ListMyTicketOrgs(c.Request.Context(), s.Pool, ctxFromGin(c))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your companies")
		return
	}
	c.JSON(http.StatusOK, gin.H{"orgs": orgs})
}

// ── GET /v1/fleet/active-trips (public) ──────────────────────────
// Open duty trips for one company by slug — what a passenger picks
// from to pay a fare. Crew names and GPS are deliberately excluded;
// managers get those from the authenticated positions endpoint.

func (s *Server) handleListPublicActiveTrips(c *gin.Context) {
	orgSlug := c.Query("orgSlug")
	if orgSlug == "" {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "orgSlug is required")
		return
	}
	trips, err := dbx.ListPublicActiveTrips(c.Request.Context(), s.Pool, orgSlug)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load trips")
		return
	}
	c.JSON(http.StatusOK, gin.H{"trips": trips})
}
