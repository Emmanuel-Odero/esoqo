package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/payments"
)

func (s *Server) handleListListings(c *gin.Context) {
	listings, err := dbx.ListPublicListings(c.Request.Context(), s.Pool, 50, 0)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load listings")
		return
	}
	c.JSON(http.StatusOK, gin.H{"listings": listings})
}

func (s *Server) handleGetListing(c *gin.Context) {
	listing, err := dbx.GetPublicListing(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that listing")
		return
	}
	if listing == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That listing is not available")
		return
	}
	c.JSON(http.StatusOK, listing)
}

// handleListScheduleSeats — seat labels are "{row}{column}" (e.g. "3B"),
// matching packages/domain/src/ticketing.ts's columnsForPattern
// convention exactly, so the client can render real seat positions
// instead of a flat list. "pattern" is hardcoded to "2+2" for now — the
// schema has a real per-listing SeatMap for an organiser to paint a
// different layout, but core-go doesn't serve that yet (see the plan's
// own mobile-v1 scope note); every seat this service currently
// generates (the Go seeder) uses "2+2", so this is accurate today, not
// a guess, and is a one-line change once SeatMap is wired up.
func (s *Server) handleListScheduleSeats(c *gin.Context) {
	seats, err := dbx.ListScheduleSeats(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load seats")
		return
	}
	c.JSON(http.StatusOK, gin.H{"seats": seats, "pattern": "2+2"})
}

type createBookingRequest struct {
	ScheduleID  string  `json:"scheduleId" binding:"required"`
	BuyerName   string  `json:"buyerName" binding:"required"`
	BuyerMsisdn string  `json:"buyerMsisdn" binding:"required"`
	BuyerEmail  *string `json:"buyerEmail"`
	Lines       []struct {
		TicketClassID string  `json:"ticketClassId" binding:"required"`
		SeatID        *string `json:"seatId"`
		Quantity      int     `json:"quantity"`
	} `json:"lines" binding:"required"`
}

// handleCreateBooking — guest or authenticated, same pattern as
// handleCreateOrder.
func (s *Server) handleCreateBooking(c *gin.Context) {
	var req createBookingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	lines := make([]dbx.BookingLineInput, len(req.Lines))
	for i, l := range req.Lines {
		qty := l.Quantity
		if qty == 0 {
			qty = 1 // a seated line implies one ticket even if the client omits quantity
		}
		lines[i] = dbx.BookingLineInput{TicketClassID: l.TicketClassID, SeatID: l.SeatID, Quantity: qty}
	}

	var buyerPartyID *string
	if token := bearerToken(c); token != "" {
		if ctx, _ := s.Session.CtxFromToken(c.Request.Context(), token, clientIP(c)); ctx != nil && ctx.PartyID != "" {
			buyerPartyID = &ctx.PartyID
		}
	}

	bookingID, totalKES, err := dbx.CreateBooking(c.Request.Context(), s.Pool, dbx.CreateBookingInput{
		ScheduleID:   req.ScheduleID,
		BuyerPartyID: buyerPartyID,
		BuyerName:    req.BuyerName,
		BuyerMsisdn:  req.BuyerMsisdn,
		BuyerEmail:   req.BuyerEmail,
		Lines:        lines,
	})
	if err != nil {
		writeOrderOrBookingError(c, err)
		return
	}

	resp := gin.H{"bookingId": bookingID, "totalKes": totalKES, "status": "PENDING_PAYMENT"}

	stk, err := payments.InitiateStkPush(s.Cfg, payments.StkPushRequest{
		Msisdn: req.BuyerMsisdn, AmountKES: parseKES(totalKES),
		AccountReference: bookingID[:8], Description: "Esoko booking",
	})
	if err != nil {
		resp["paymentError"] = err.Error()
		c.JSON(http.StatusOK, resp)
		return
	}
	_ = dbx.AttachBookingCheckoutRequestID(c.Request.Context(), s.Pool, bookingID, stk.CheckoutRequestID)
	resp["checkoutRequestId"] = stk.CheckoutRequestID
	if stk.AutoConfirmed {
		_ = dbx.ConfirmBookingPaymentByCheckoutID(c.Request.Context(), s.Pool, stk.CheckoutRequestID)
		resp["status"] = "PAID"
	}

	c.JSON(http.StatusOK, resp)
}

// handleGetBooking — public: the booking id is the secret, same
// convention as getBookingStatus in ticketing.ts.
func (s *Server) handleGetBooking(c *gin.Context) {
	booking, err := dbx.GetBooking(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that booking")
		return
	}
	if booking == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That booking was not found")
		return
	}
	tickets, err := dbx.ListTicketsForBooking(c.Request.Context(), s.Pool, booking.ID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load tickets for that booking")
		return
	}
	c.JSON(http.StatusOK, gin.H{"booking": booking, "tickets": tickets})
}

func (s *Server) handleListMyBookings(c *gin.Context) {
	ctx := ctxFromGin(c)
	bookings, err := dbx.ListBookingsForParty(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your bookings")
		return
	}
	tickets, err := dbx.ListTicketsForParty(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your tickets")
		return
	}
	c.JSON(http.StatusOK, gin.H{"bookings": bookings, "tickets": tickets})
}
