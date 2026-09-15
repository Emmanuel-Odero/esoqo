package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/notify"
)

// Parcels riding the passenger fleet.
//
// The conductor-facing half is gated on two separate facts, never one:
// custody of the parcel (a normal scan handoff, same as any courier)
// AND being crew on that specific trip. Boarding is an additional fact
// about where the holder currently is, not a substitute for the chain —
// see dbx.BoardParcelOnTrip.

// handleListDepartingTrips — GET /v1/parcels/trips?q=. Public, same
// boundary the booking form's other pickers sit on: a sender choosing
// which bus to send something on hasn't signed in yet.
func (s *Server) handleListDepartingTrips(c *gin.Context) {
	limit := 20
	if v := c.Query("limit"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	trips, err := dbx.ListDepartingTrips(c.Request.Context(), s.Pool, c.Query("q"), limit)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load departing buses")
		return
	}
	c.JSON(http.StatusOK, gin.H{"trips": trips})
}

// handleListTripStages — GET /v1/parcels/trips/:tripId/stages. Public
// for the same reason: picking where a parcel comes off is part of
// choosing the bus.
func (s *Server) handleListTripStages(c *gin.Context) {
	stages, err := dbx.ListTripStages(c.Request.Context(), s.Pool, c.Param("tripId"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load that route's stops")
		return
	}
	c.JSON(http.StatusOK, gin.H{"stages": stages})
}

type boardParcelRequest struct {
	TripID      string  `json:"tripId" binding:"required"`
	DropStageID *string `json:"dropStageId"`
}

// handleBoardParcelOnTrip — POST /v1/parcels/:code/board.
func (s *Server) handleBoardParcelOnTrip(c *gin.Context) {
	var req boardParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	code := c.Param("code")
	if err := dbx.BoardParcelOnTrip(c.Request.Context(), s.Pool, code, req.TripID, ctx.PartyID, req.DropStageID); err != nil {
		writeParcelError(c, err)
		return
	}
	// Both parties hear which bus it's on. This is the message the whole
	// feature exists for: a plate number turns "somewhere in transit"
	// into something a person can picture, and — uniquely here — go and
	// stand next to.
	if info, ierr := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code); ierr == nil && info != nil {
		trip, terr := dbx.GetParcelTripInfo(c.Request.Context(), s.Pool, code)
		if terr == nil && trip != nil {
			var stage string
			if trip.DropStageName != nil {
				stage = *trip.DropStageName
			}
			msg := notify.ParcelOnBus(code, trip.VehiclePlate, trip.RouteName, stage)
			if info.ReceiverMsisdn != "" {
				_ = authsvc.SendSms(info.ReceiverMsisdn, msg, "PARCEL_ON_BUS")
			}
			if info.SenderMsisdn != "" {
				_ = authsvc.SendSms(info.SenderMsisdn, msg, "PARCEL_ON_BUS")
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"boarded": true})
}

// handleDropParcelFromTrip — POST /v1/parcels/:code/drop. Takes a
// parcel off at a stage; custody deliberately stays with the conductor
// until it reaches a receiver or a pickup point.
func (s *Server) handleDropParcelFromTrip(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := dbx.DropParcelFromTrip(c.Request.Context(), s.Pool, c.Param("code"), ctx.PartyID); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"dropped": true})
}

// handleGetTripManifest — GET /v1/parcels/trips/:tripId/manifest. What
// is still in this conductor's boot, in the order it comes off.
//
// Crew-gated on the trip itself: a manifest names every receiver and
// their phone number, which is a passenger list for freight and has no
// business being readable by anyone who isn't crewing that vehicle.
func (s *Server) handleGetTripManifest(c *gin.Context) {
	ctx := ctxFromGin(c)
	tripID := c.Param("tripId")
	onCrew, err := dbx.IsCrewOnTrip(c.Request.Context(), s.Pool, tripID, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that trip")
		return
	}
	if !onCrew {
		writeError(c, http.StatusForbidden, "DENIED", "You aren't crewing that trip")
		return
	}
	rows, err := dbx.GetTripManifest(c.Request.Context(), s.Pool, tripID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load the manifest")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": rows})
}

// handleAdminGetTripManifest — GET /v1/admin/parcels/trips/:id/manifest.
//
// The same manifest, for the dispatcher who has to hand the vehicle a
// printed run sheet rather than the crew who read it on a phone.
//
// A sibling of the crew route rather than a widening of it, because the
// two authorise on completely different grounds: the crew route asks
// "are you on this trip", which a dispatcher standing in the depot
// never is. Loosening that check to admit staff would weaken the
// custody rule the crew route exists to enforce.
func (s *Server) handleAdminGetTripManifest(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	rows, err := dbx.GetTripManifest(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load the manifest")
		return
	}
	c.JSON(http.StatusOK, gin.H{"parcels": rows})
}
