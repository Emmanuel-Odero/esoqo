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
//
// Canonically mounted at /v1/parcel-orgs/me/runs since ADR-0006 merged
// dispatches and shipments into one record. The older /me/dispatch and
// /me/shipments paths still resolve here — a rider's installed PWA may
// hold either, and breaking a route to rename it would strand exactly
// the people who cannot easily update.

type runCrewRequest struct {
	Name       string  `json:"name" binding:"required"`
	Msisdn     *string `json:"msisdn"`
	Role       string  `json:"role"`
	CustomRole *string `json:"customRole"`
	StaffID    *string `json:"staffId"`
}

type runReceiverRequest struct {
	Name    string  `json:"name" binding:"required"`
	StaffID *string `json:"staffId"`
}

type createRunRequest struct {
	VehiclePlate         string                  `json:"vehiclePlate" binding:"required"`
	VehicleType          string                  `json:"vehicleType"`
	OriginStationID      *string                 `json:"originStationId"`
	DestinationStationID *string                 `json:"destinationStationId"`
	Notes                *string                 `json:"notes"`
	// Optional: an ad-hoc run cites no route (ADR-0006).
	RouteID              *string                 `json:"routeId"`
	Crew                 []runCrewRequest   `json:"crew" binding:"required"`
	Receivers            []runReceiverRequest `json:"receivers"`
}

// handleListRuns — GET /v1/parcel-orgs/me/dispatch?closed=true.
// The board: active runs by default, recently closed ones on request.
func (s *Server) handleListRuns(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	runs, err := dbx.ListRuns(c.Request.Context(), s.Pool, orgID, c.Query("closed") == "true")
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your runs")
		return
	}
	if runs == nil {
		runs = []dbx.Dispatch{}
	}
	// Both keys, same slice: "runs" is what the record is now called,
	// "dispatches" keeps a client that predates ADR-0006 working. Cheap
	// to send twice; expensive to strand an installed PWA.
	c.JSON(http.StatusOK, gin.H{"runs": runs, "dispatches": runs})
}

// handleGetRun — GET /v1/parcel-orgs/me/dispatch/:id. One run with
// its trail: what the fleet map draws.
func (s *Server) handleGetRun(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	run, err := dbx.GetRun(c.Request.Context(), s.Pool, orgID, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that run")
		return
	}
	if run == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That run isn't one of yours")
		return
	}
	c.JSON(http.StatusOK, gin.H{"run": run, "dispatch": run})
}

// handleCreateRun — POST /v1/parcel-orgs/me/dispatch. Opens a run:
// vehicle, leg, crew and receiving team. A manager/dispatcher
// operation (parcelorg.dispatch), not a rider's.
func (s *Server) handleCreateRun(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req createRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	crew := make([]dbx.RunCrewInput, 0, len(req.Crew))
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
		crew = append(crew, dbx.RunCrewInput{
			Name: m.Name, Msisdn: msisdn, Role: m.Role, CustomRole: m.CustomRole, StaffID: staffID,
		})
	}
	receivers := make([]dbx.RunReceiverInput, 0, len(req.Receivers))
	for _, r := range req.Receivers {
		staffID := r.StaffID
		if staffID != nil && strings.TrimSpace(*staffID) == "" {
			staffID = nil
		}
		receivers = append(receivers, dbx.RunReceiverInput{Name: r.Name, StaffID: staffID})
	}
	var origin, destination *string
	if req.OriginStationID != nil && strings.TrimSpace(*req.OriginStationID) != "" {
		origin = req.OriginStationID
	}
	if req.DestinationStationID != nil && strings.TrimSpace(*req.DestinationStationID) != "" {
		destination = req.DestinationStationID
	}
	var routeID *string
	if req.RouteID != nil && strings.TrimSpace(*req.RouteID) != "" {
		routeID = req.RouteID
	}
	id, err := dbx.CreateRun(c.Request.Context(), s.Pool, orgID, dbx.CreateRunInput{
		VehiclePlate: req.VehiclePlate, VehicleType: req.VehicleType,
		OriginStationID: origin, DestinationStationID: destination,
		RouteID: routeID,
		Notes:   req.Notes, Crew: crew, Receivers: receivers,
	})
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

type runPositionRequest struct {
	Lat float64 `json:"lat" binding:"required"`
	Lng float64 `json:"lng" binding:"required"`
}

// handleReportRunPosition — POST
// /v1/parcel-orgs/me/dispatch/:id/position. Moves the board marker and
// extends the trail. Whoever holds the run's phone posts it.
func (s *Server) handleReportRunPosition(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req runPositionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.ReportRunPosition(c.Request.Context(), s.Pool, orgID, c.Param("id"), req.Lat, req.Lng); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"reported": true})
}

type arriveDispatchRequest struct {
	// Who signed at the counter. Blank falls back to the named
	// receiving team (see dbx.ArriveRun).
	ReceivedBy string `json:"receivedBy"`
}

// handleArriveRun — POST /v1/parcel-orgs/me/dispatch/:id/arrive.
// The receiving team's check-in: the run is over, who signed is on the
// record.
func (s *Server) handleArriveRun(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req arriveDispatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.ArriveRun(c.Request.Context(), s.Pool, orgID, c.Param("id"), req.ReceivedBy); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"arrived": true})
}

// handleCancelRun — POST /v1/parcel-orgs/me/dispatch/:id/cancel.
// Calls a run off before it arrives.
func (s *Server) handleCancelRun(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	if err := dbx.CancelRun(c.Request.Context(), s.Pool, orgID, c.Param("id")); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cancelled": true})
}
