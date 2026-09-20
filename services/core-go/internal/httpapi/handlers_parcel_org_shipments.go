package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// A courier company's own vehicle runs, scoped to the session's org.
//
// These routes are what the counter's "receive and load onto a run"
// button needs: a parcel going IN_TRANSIT is only honest when there is
// a vehicle it has actually been put on, and until now the portal had
// no way to name one. See dbx/parcel_org_shipments.go for why the
// ownership check lives in SQL rather than in a Go pre-check.

// handleListMyOrgShipments — GET /v1/parcel-orgs/me/shipments.
// Read capability: knowing which lorries are loading is operational,
// not privileged, and a rider at the door needs it as much as the
// dispatcher does.
func (s *Server) handleListMyOrgShipments(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	runs, err := dbx.ListOpenOrgShipments(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your runs")
		return
	}
	c.JSON(http.StatusOK, gin.H{"shipments": runs})
}

type createOrgShipmentRequest struct {
	OriginLabel      string `json:"originLabel" binding:"required"`
	DestinationLabel string `json:"destinationLabel" binding:"required"`
	RouteLabel       string `json:"routeLabel"`
	VehiclePlate     string `json:"vehiclePlate"`
}

// handleCreateMyOrgShipment — POST /v1/parcel-orgs/me/shipments.
func (s *Server) handleCreateMyOrgShipment(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req createOrgShipmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	run, err := dbx.CreateOrgShipment(c.Request.Context(), s.Pool, orgID,
		req.OriginLabel, req.DestinationLabel, req.RouteLabel, req.VehiclePlate, ctx.ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"shipment": run})
}

type loadOrgShipmentRequest struct {
	Code string `json:"code" binding:"required"`
}

// handleLoadOntoMyOrgShipment — POST /v1/parcel-orgs/me/shipments/:id/load.
//
// Carry, not dispatch: the person physically putting boxes on a lorry
// is a rider or a loader, and requiring the dispatcher's capability to
// record what they just did would push the scanning onto whoever holds
// the phone with the right login — which is how manifests stop
// matching what is actually aboard.
func (s *Server) handleLoadOntoMyOrgShipment(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgCarry)
	if orgID == "" {
		return
	}
	var req loadOrgShipmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	run, err := dbx.LoadParcelOntoOrgShipment(c.Request.Context(), s.Pool, orgID,
		c.Param("id"), strings.TrimSpace(req.Code), ctx.PartyID, ctx.ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"shipment": run})
}

// handleStartMyOrgShipment — POST /v1/parcel-orgs/me/shipments/:id/start.
func (s *Server) handleStartMyOrgShipment(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	run, err := dbx.StartOrgShipment(c.Request.Context(), s.Pool, orgID, c.Param("id"))
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"shipment": run})
}
