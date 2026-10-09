package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/payments"
)

// A courier company's bus side (ParcelOrg.offersTransport): fleet,
// routes, schedules (prices/capacities) and trips, managed from the
// company's own console; bookings taken at the counter or on the
// public web. Every management handler below requires
// CapParcelOrgTransport; counter sales require the narrower
// CapParcelOrgTransportSell. Public handlers (companies/routes/trips/
// seats/bookings) carry no session at all — same boundary the parcel
// public endpoints already use.

func busBookingErrorStatus(code string) int {
	switch code {
	case "TRIP_NOT_FOUND":
		return http.StatusNotFound
	case "SEAT_TAKEN":
		return http.StatusConflict
	}
	return http.StatusBadRequest
}

func writeBusBookingError(c *gin.Context, err error) {
	if be, ok := err.(*dbx.BusBookingError); ok {
		writeError(c, busBookingErrorStatus(be.Code), be.Code, be.Message)
		return
	}
	writeParcelError(c, err)
}

// ──────────────────────── Org management (buses) ──────────────────

func (s *Server) handleListMyOrgBuses(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	buses, err := dbx.ListBuses(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your buses")
		return
	}
	c.JSON(http.StatusOK, gin.H{"buses": buses})
}

type busRequest struct {
	Name        string   `json:"name" binding:"required"`
	PlateNumber string   `json:"plateNumber" binding:"required"`
	TotalSeats  int      `json:"totalSeats" binding:"required"`
	SeatLayout  *string  `json:"seatLayout"`
	Amenities   []string `json:"amenities"`
	Status      string   `json:"status"`
}

func (s *Server) handleSaveMyOrgBus(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgTransport)
	if orgID == "" {
		return
	}
	var req busRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "Give the bus a name, plate number and seat count")
		return
	}
	id, err := dbx.SaveBus(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Param("id")), dbx.BusInput{
		Name: req.Name, PlateNumber: req.PlateNumber, TotalSeats: req.TotalSeats,
		SeatLayout: req.SeatLayout, Amenities: req.Amenities, Status: req.Status,
	})
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

func (s *Server) handleDeleteMyOrgBus(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgTransport)
	if orgID == "" {
		return
	}
	if err := dbx.DeleteBus(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Param("id"))); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ──────────────────────── Org management (routes) ─────────────────
//
// Buses no longer have a route endpoint of their own — a transport
// company's routes are its ParcelRoutes, managed from Settings →
// Routes (see handlers_parcel_routes.go) same as its parcel runs'.
// handleListMyOrgBusRoutes stays as a read-only, bus-flavoured
// projection of that same list for the schedule/trip pickers.

func (s *Server) handleListMyOrgBusRoutes(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	routes, err := dbx.ListBusRoutesForOrg(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your routes")
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": routes})
}

// ──────────────────────── Org management (schedules) ──────────────

func (s *Server) handleListMyOrgBusSchedules(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	schedules, err := dbx.ListBusSchedules(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your schedules")
		return
	}
	c.JSON(http.StatusOK, gin.H{"schedules": schedules})
}

type busScheduleRequest struct {
	BusID      string  `json:"busId" binding:"required"`
	RouteID    string  `json:"routeId" binding:"required"`
	DepartTime string  `json:"departTime" binding:"required"`
	DaysOfWeek []int32 `json:"daysOfWeek"`
	PriceKes   float64 `json:"priceKes" binding:"required"`
	Active     *bool   `json:"active"`
}

func (s *Server) handleSaveMyOrgBusSchedule(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgTransport)
	if orgID == "" {
		return
	}
	var req busScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "Choose a bus, route, time and fare")
		return
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	id, err := dbx.SaveBusSchedule(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Param("id")), dbx.BusScheduleInput{
		BusID: req.BusID, RouteID: req.RouteID, DepartTime: req.DepartTime,
		DaysOfWeek: req.DaysOfWeek, PriceKes: req.PriceKes, Active: active,
	})
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

func (s *Server) handleDeleteMyOrgBusSchedule(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgTransport)
	if orgID == "" {
		return
	}
	if err := dbx.DeleteBusSchedule(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Param("id"))); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ──────────────────────── Org management (trips) ──────────────────

// handleListMyOrgBusTrips — GET /v1/parcel-orgs/me/transport/trips.
// Ensures the next 14 days of recurring schedules exist as concrete
// trips before listing, so a console opened for the first time in a
// while isn't staring at an empty calendar.
func (s *Server) handleListMyOrgBusTrips(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	if err := dbx.EnsureBusTripsGenerated(c.Request.Context(), s.Pool, orgID, 14); err != nil {
		writeError(c, http.StatusInternalServerError, "GENERATE_FAILED", "Could not prepare upcoming trips")
		return
	}
	trips, err := dbx.ListBusTripsForOrg(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Query("routeId")))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your trips")
		return
	}
	c.JSON(http.StatusOK, gin.H{"trips": trips})
}

type oneOffTripRequest struct {
	BusID    string  `json:"busId" binding:"required"`
	RouteID  string  `json:"routeId" binding:"required"`
	DepartAt string  `json:"departAt" binding:"required"` // RFC3339
	PriceKes float64 `json:"priceKes" binding:"required"`
}

func (s *Server) handleCreateMyOrgBusTrip(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgTransport)
	if orgID == "" {
		return
	}
	var req oneOffTripRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "Choose a bus, route, departure time and fare")
		return
	}
	departAt, err := time.Parse(time.RFC3339, req.DepartAt)
	if err != nil {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "That departure time isn't valid")
		return
	}
	id, err := dbx.CreateOneOffBusTrip(c.Request.Context(), s.Pool, orgID, dbx.OneOffBusTripInput{
		BusID: req.BusID, RouteID: req.RouteID, DepartAt: departAt, PriceKes: req.PriceKes,
	})
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

func (s *Server) handleCancelMyOrgBusTrip(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgTransport)
	if orgID == "" {
		return
	}
	if err := dbx.CancelBusTrip(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Param("id"))); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cancelled": true})
}

func (s *Server) handleListMyOrgBusTripBookings(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	bookings, err := dbx.ListBusBookingsForTrip(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Param("id")))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load this trip's bookings")
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bookings})
}

// ──────────────────────── Counter (walk-in) booking ────────────────

type counterBusBookingRequest struct {
	TripID            string  `json:"tripId" binding:"required"`
	SeatNumber        int     `json:"seatNumber" binding:"required"`
	PassengerName     string  `json:"passengerName" binding:"required"`
	PassengerMsisdn   string  `json:"passengerMsisdn" binding:"required"`
	PassengerIDNumber *string `json:"passengerIdNumber"`
}

// handleCounterBookBus — POST /v1/parcel-orgs/me/transport/counter/book.
// Always CASH, always PAID on commit — a clerk at the counter has
// already taken the fare in hand, same "no STK round trip for a
// till sale" shape the ticketing CASH path follows. One seat per
// counter sale — see handleCreatePublicBusBooking for the multi-seat
// web checkout.
func (s *Server) handleCounterBookBus(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgTransportSell)
	if orgID == "" {
		return
	}
	var req counterBusBookingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "Give the passenger's name, phone and seat")
		return
	}
	if !requireMsisdn(c, &req.PassengerMsisdn, "The passenger's phone number") {
		return
	}
	ctx := ctxFromGin(c)
	var staffID *string
	if ctx.ActorID != "" {
		staffID = &ctx.ActorID
	}
	bookingIDs, code, totalKES, err := dbx.CreateBusBooking(c.Request.Context(), s.Pool, dbx.CreateBusBookingInput{
		TripID: req.TripID, SeatNumbers: []int{req.SeatNumber},
		PassengerName: req.PassengerName, PassengerMsisdn: req.PassengerMsisdn, PassengerIDNumber: req.PassengerIDNumber,
		PaymentMethod: "CASH", Channel: "COUNTER", CreatedByStaffID: staffID,
	})
	if err != nil {
		writeBusBookingError(c, err)
		return
	}
	// CASH is PAID on commit (see dbx.CreateBusBooking), so the payout
	// row already exists — dispatch it the same way a parcel's does
	// right after its own cash settlement.
	s.dispatchParcelOrgPayoutForBusBooking(bookingIDs[0])
	c.JSON(http.StatusOK, gin.H{
		"bookingId": bookingIDs[0], "code": code, "totalKes": totalKES, "status": "PAID",
	})
}

func (s *Server) handleCounterCancelBusBooking(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgTransportSell)
	if orgID == "" {
		return
	}
	if err := dbx.CancelBusBooking(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Param("id"))); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cancelled": true})
}

// ──────────────────────────── Public ───────────────────────────────

// handleListTransportCompanies — GET /v1/transport/companies. The top
// of the public booking funnel: every courier company that also runs
// buses, unauthenticated by design (same boundary as every other
// parcel public picker).
func (s *Server) handleListTransportCompanies(c *gin.Context) {
	companies, err := dbx.ListTransportCompanies(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load transport companies")
		return
	}
	c.JSON(http.StatusOK, gin.H{"companies": companies})
}

// handleListPublicBusRoutes — GET /v1/transport/companies/:orgId/routes.
func (s *Server) handleListPublicBusRoutes(c *gin.Context) {
	routes, err := dbx.ListPublicBusRoutes(c.Request.Context(), s.Pool, strings.TrimSpace(c.Param("orgId")))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load that company's routes")
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": routes})
}

// handleFindPublicBusRoutes — GET
// /v1/transport/companies/:orgId/routes/search?from=&to=. The
// traveller-facing search: pick where you board and where you alight
// (both one of this company's own stations — see
// handleListPublicOrgStations) and get back every route that visits
// both, in that order, with no need to already know which route it is.
func (s *Server) handleFindPublicBusRoutes(c *gin.Context) {
	orgID := strings.TrimSpace(c.Param("orgId"))
	from := strings.TrimSpace(c.Query("from"))
	to := strings.TrimSpace(c.Query("to"))
	if from == "" || to == "" {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "from and to are required")
		return
	}
	routes, err := dbx.FindPublicBusRoutesBetweenStations(c.Request.Context(), s.Pool, orgID, from, to)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not search that company's routes")
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": routes})
}

// handleListPublicBusTrips — GET /v1/transport/trips?orgId=&routeId=.
// Ensures near-future trips exist for that company before listing —
// the public equivalent of handleListMyOrgBusTrips's own generation
// step.
func (s *Server) handleListPublicBusTrips(c *gin.Context) {
	orgID := strings.TrimSpace(c.Query("orgId"))
	routeID := strings.TrimSpace(c.Query("routeId"))
	if orgID == "" || routeID == "" {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "orgId and routeId are required")
		return
	}
	if err := dbx.EnsureBusTripsGenerated(c.Request.Context(), s.Pool, orgID, 14); err != nil {
		writeError(c, http.StatusInternalServerError, "GENERATE_FAILED", "Could not prepare upcoming trips")
		return
	}
	trips, err := dbx.ListPublicBusTrips(c.Request.Context(), s.Pool, orgID, routeID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load upcoming trips")
		return
	}
	c.JSON(http.StatusOK, gin.H{"trips": trips})
}

// handleGetPublicBusTrip — GET /v1/transport/trips/:id. One trip's own
// detail for the seat-selection page — the trip id is the secret, same
// convention GetBooking's own comment uses.
func (s *Server) handleGetPublicBusTrip(c *gin.Context) {
	trip, err := dbx.GetPublicBusTrip(c.Request.Context(), s.Pool, strings.TrimSpace(c.Param("id")))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that trip")
		return
	}
	if trip == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That trip was not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"trip": trip})
}

// handleGetPublicBusTripSeats — GET /v1/transport/trips/:id/seats.
func (s *Server) handleGetPublicBusTripSeats(c *gin.Context) {
	seatsTotal, taken, err := dbx.BusTripSeats(c.Request.Context(), s.Pool, strings.TrimSpace(c.Param("id")))
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"seatsTotal": seatsTotal, "takenSeats": taken})
}

type publicBusBookingRequest struct {
	TripID string `json:"tripId" binding:"required"`
	// One or more seats in a single checkout — a passenger booking for
	// their family picks several and pays once.
	SeatNumbers       []int   `json:"seatNumbers" binding:"required"`
	PassengerName     string  `json:"passengerName" binding:"required"`
	PassengerMsisdn   string  `json:"passengerMsisdn" binding:"required"`
	PassengerIDNumber *string `json:"passengerIdNumber"`
}

// handleCreatePublicBusBooking — POST /v1/transport/bookings. Guest
// checkout, M-Pesa STK only — same shape handleCreateBooking follows
// for a ticketing booking. One STK push for every seat's combined fare.
func (s *Server) handleCreatePublicBusBooking(c *gin.Context) {
	var req publicBusBookingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.PassengerMsisdn, "The passenger's phone number") {
		return
	}

	bookingIDs, code, totalKES, err := dbx.CreateBusBooking(c.Request.Context(), s.Pool, dbx.CreateBusBookingInput{
		TripID: req.TripID, SeatNumbers: req.SeatNumbers,
		PassengerName: req.PassengerName, PassengerMsisdn: req.PassengerMsisdn, PassengerIDNumber: req.PassengerIDNumber,
		PaymentMethod: "MPESA_STK", Channel: "WEB",
	})
	if err != nil {
		writeBusBookingError(c, err)
		return
	}

	resp := gin.H{"bookingId": bookingIDs[0], "code": code, "totalKes": totalKES, "status": "PENDING_PAYMENT"}
	stk, err := payments.ParcelStkPush(s.Cfg, payments.StkPushRequest{
		Msisdn: req.PassengerMsisdn, AmountKES: parseKES(totalKES),
		AccountReference: code, Description: "Esoqo bus ticket",
	})
	if err != nil {
		resp["paymentError"] = err.Error()
		c.JSON(http.StatusOK, resp)
		return
	}
	_ = dbx.AttachBusBookingCheckoutRequestID(c.Request.Context(), s.Pool, code, stk.CheckoutRequestID)
	resp["checkoutRequestId"] = stk.CheckoutRequestID
	if stk.AutoConfirmed {
		// Console mode only — the push already settled inline, so the
		// payout can dispatch immediately rather than waiting on a
		// webhook that will never arrive.
		if confirmedIDs, justConfirmed, cerr := dbx.ConfirmBusBookingByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID); cerr == nil && justConfirmed {
			for _, id := range confirmedIDs {
				s.dispatchParcelOrgPayoutForBusBooking(id)
			}
		}
		resp["status"] = "PAID"
	}
	c.JSON(http.StatusOK, resp)
}

// handleGetPublicBusBooking — GET /v1/transport/bookings/:code. Public:
// the code is the secret, same convention handleGetBooking follows.
// Every seat booked in the same checkout shares the code, so this
// returns all of them.
func (s *Server) handleGetPublicBusBooking(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	// A Co-op push has no inbound confirm we can trust, so the
	// passenger's own status poll doubles as the settlement check
	// (throttled per checkout in settleCoopForBusBookingCode).
	s.settleCoopForBusBookingCode(c, code)
	bookings, err := dbx.ListBusBookingsByCode(c.Request.Context(), s.Pool, code)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that booking")
		return
	}
	if len(bookings) == 0 {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That booking was not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bookings})
}
