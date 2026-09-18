package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// The dispatch board's HTTP surface — a company's own runs, behind its
// own session. Every handler reads the org from the session (see
// orgCtx), never from the request: a run id from another company reads
// as not-found, never as somebody else's run.

type dispatchCrewRequest struct {
	Name       string  `json:"name" binding:"required"`
	Msisdn     *string `json:"msisdn"`
	Role       string  `json:"role"`
	CustomRole *string `json:"customRole"`
	StaffID    *string `json:"staffId"`
}

type dispatchReceiverRequest struct {
	Name    string  `json:"name" binding:"required"`
	StaffID *string `json:"staffId"`
}

type createDispatchRequest struct {
	VehiclePlate         string                  `json:"vehiclePlate" binding:"required"`
	VehicleType          string                  `json:"vehicleType"`
	OriginStationID      *string                 `json:"originStationId"`
	DestinationStationID *string                 `json:"destinationStationId"`
	Notes                *string                 `json:"notes"`
	Crew                 []dispatchCrewRequest   `json:"crew" binding:"required"`
	Receivers            []dispatchReceiverRequest `json:"receivers"`
}

// handleListDispatches — GET /v1/parcel-orgs/me/dispatch?closed=true.
// The board: active runs by default, recently closed ones on request.
func (s *Server) handleListDispatches(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	runs, err := dbx.ListDispatches(c.Request.Context(), s.Pool, orgID, c.Query("closed") == "true")
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your runs")
		return
	}
	if runs == nil {
		runs = []dbx.Dispatch{}
	}
	c.JSON(http.StatusOK, gin.H{"dispatches": runs})
}

// handleGetDispatch — GET /v1/parcel-orgs/me/dispatch/:id. One run with
// its trail: what the fleet map draws.
func (s *Server) handleGetDispatch(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	run, err := dbx.GetDispatch(c.Request.Context(), s.Pool, orgID, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that run")
		return
	}
	if run == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That run isn't one of yours")
		return
	}
	c.JSON(http.StatusOK, gin.H{"dispatch": run})
}

// handleCreateDispatch — POST /v1/parcel-orgs/me/dispatch. Opens a run:
// vehicle, leg, crew and receiving team. A manager/dispatcher
// operation (parcelorg.dispatch), not a rider's.
func (s *Server) handleCreateDispatch(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req createDispatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	crew := make([]dbx.DispatchCrewInput, 0, len(req.Crew))
	for _, m := range req.Crew {
		msisdn := m.Msisdn
		if msisdn != nil && strings.TrimSpace(*msisdn) != "" {
			if !optionalMsisdn(c, &msisdn, m.Name+"'s phone number") {
				return
			}
		} else {
			msisdn = nil
		}
		// A roster link carries the verified identity; a typed row is
		// just a name on the run. Either is fine — the run is an
		// operational record, not an authentication decision.
		staffID := m.StaffID
		if staffID != nil && strings.TrimSpace(*staffID) == "" {
			staffID = nil
		}
		crew = append(crew, dbx.DispatchCrewInput{
			Name: m.Name, Msisdn: msisdn, Role: m.Role, CustomRole: m.CustomRole, StaffID: staffID,
		})
	}
	receivers := make([]dbx.DispatchReceiverInput, 0, len(req.Receivers))
	for _, r := range req.Receivers {
		staffID := r.StaffID
		if staffID != nil && strings.TrimSpace(*staffID) == "" {
			staffID = nil
		}
		receivers = append(receivers, dbx.DispatchReceiverInput{Name: r.Name, StaffID: staffID})
	}
	var origin, destination *string
	if req.OriginStationID != nil && strings.TrimSpace(*req.OriginStationID) != "" {
		origin = req.OriginStationID
	}
	if req.DestinationStationID != nil && strings.TrimSpace(*req.DestinationStationID) != "" {
		destination = req.DestinationStationID
	}
	id, err := dbx.CreateDispatch(c.Request.Context(), s.Pool, orgID, dbx.CreateDispatchInput{
		VehiclePlate: req.VehiclePlate, VehicleType: req.VehicleType,
		OriginStationID: origin, DestinationStationID: destination,
		Notes: req.Notes, Crew: crew, Receivers: receivers,
	})
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

type dispatchPositionRequest struct {
	Lat float64 `json:"lat" binding:"required"`
	Lng float64 `json:"lng" binding:"required"`
}

// handleReportDispatchPosition — POST
// /v1/parcel-orgs/me/dispatch/:id/position. Moves the board marker and
// extends the trail. Whoever holds the run's phone posts it.
func (s *Server) handleReportDispatchPosition(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req dispatchPositionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.ReportDispatchPosition(c.Request.Context(), s.Pool, orgID, c.Param("id"), req.Lat, req.Lng); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"reported": true})
}

type arriveDispatchRequest struct {
	// Who signed at the counter. Blank falls back to the named
	// receiving team (see dbx.ArriveDispatch).
	ReceivedBy string `json:"receivedBy"`
}

// handleArriveDispatch — POST /v1/parcel-orgs/me/dispatch/:id/arrive.
// The receiving team's check-in: the run is over, who signed is on the
// record.
func (s *Server) handleArriveDispatch(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req arriveDispatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.ArriveDispatch(c.Request.Context(), s.Pool, orgID, c.Param("id"), req.ReceivedBy); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"arrived": true})
}

// handleCancelDispatch — POST /v1/parcel-orgs/me/dispatch/:id/cancel.
// Calls a run off before it arrives.
func (s *Server) handleCancelDispatch(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	if err := dbx.CancelDispatch(c.Request.Context(), s.Pool, orgID, c.Param("id")); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cancelled": true})
}
