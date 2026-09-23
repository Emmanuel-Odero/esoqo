package httpapi

// Passenger luggage endpoints.
//
// Four routes, because the crew flow has four moments: tag a bag, scan
// it aboard, hand it back, and see what is on the vehicle. Everything
// else a luggage system could grow (pricing tiers, zones, an SLA, its
// own console) belongs to the parcel domain, which already does it
// properly — see docs/proposals/parcel-and-luggage-pilot-readiness.md
// on why a bag is not a small parcel.

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// luggageErrorStatus maps a LuggageError code to its HTTP status.
//
// Pure and separately tested for the same reason parcelErrorStatus is:
// LABEL_ALREADY_SPENT is a contract an offline client branches on, and
// ALREADY_CLAIMED is one a crew screen has to be able to tell apart
// from "you typed the code wrong" without reading the sentence.
func luggageErrorStatus(code string) int {
	switch code {
	case "NOT_FOUND":
		return http.StatusNotFound
	case "DENIED":
		return http.StatusForbidden
	case "TRIP_CLOSED", "ALREADY_CLAIMED", "LABEL_ALREADY_SPENT":
		// Conflicts, not bad requests: in all three the crew member did
		// nothing wrong, the world moved. A pre-printed tag already on
		// another bag in particular is how a replayed offline tagging
		// discovers it already succeeded — the same shape the parcel
		// counter queue relies on.
		return http.StatusConflict
	}
	return http.StatusBadRequest
}

func writeLuggageError(c *gin.Context, err error) {
	if authErr, ok := err.(*authsvc.AuthorisationError); ok {
		writeError(c, http.StatusForbidden, "DENIED", "Denied: "+authErr.Capability)
		return
	}
	if le, ok := err.(*dbx.LuggageError); ok {
		writeError(c, luggageErrorStatus(le.Code), le.Code, le.Message)
		return
	}
	if err == dbx.ErrOrgNotFound {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Organiser not found")
		return
	}
	writeError(c, http.StatusInternalServerError, "LUGGAGE_FAILED", "Could not complete that")
}

// POST /v1/luggage — tag one passenger's bags onto a trip.
//
// Every piece in one call: "2 of 3" is only true if all three exist, and
// on a handset at a stage it is also one round trip instead of three on
// a connection that may not survive the second.
func (s *Server) handleTagLuggage(c *gin.Context) {
	var in dbx.TagLuggageInput
	if err := c.ShouldBindJSON(&in); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	tags, err := dbx.TagLuggage(c.Request.Context(), s.Pool, ctxFromGin(c), in)
	if err != nil {
		writeLuggageError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tags": tags})
}

// POST /v1/luggage/:code/board — the scan that puts a tagged bag on
// board. Idempotent: re-scanning an already-boarded bag succeeds, which
// is what makes it safe to replay from an offline queue and also just
// correct at a stage where the first beep got lost in traffic.
func (s *Server) handleBoardLuggage(c *gin.Context) {
	tag, err := dbx.BoardLuggage(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("code"))
	if err != nil {
		writeLuggageError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tag": tag})
}

// POST /v1/luggage/:code/claim — hand a bag back.
//
// Returns the passenger's other pieces and how many are still aboard
// alongside the claim itself, because the moment has no room for a
// second call: the passenger is at the door and the bus is moving on.
func (s *Server) handleClaimLuggage(c *gin.Context) {
	var in dbx.ClaimLuggageInput
	if err := c.ShouldBindJSON(&in); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	in.Code = c.Param("code")
	res, err := dbx.ClaimLuggage(c.Request.Context(), s.Pool, ctxFromGin(c), in)
	if err != nil {
		writeLuggageError(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GET /v1/trips/:id/luggage — what is on this vehicle, ordered by drop
// stage then passenger then piece: the order the job is actually done
// in, the same rule GetTripManifest follows for parcels.
//
// Crew-gated (luggage.read), because a luggage manifest names every
// passenger on the vehicle.
func (s *Server) handleListTripLuggage(c *gin.Context) {
	tags, err := dbx.ListTripLuggage(c.Request.Context(), s.Pool, ctxFromGin(c), c.Param("id"))
	if err != nil {
		writeLuggageError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"luggage": tags})
}
