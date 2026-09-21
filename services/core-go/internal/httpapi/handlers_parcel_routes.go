package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// A courier company's own routes — the ordered lists of stations it
// serves (ADR-0006). Defining one is configuration a manager does
// monthly, which is why writes sit behind the same capability as the
// rate card rather than behind dispatch: a route is a commercial
// statement about where the company goes, not a shift decision.
//
// Reading is open to any session that can read the company, because a
// clerk opening a run has to pick from the list.

type routeRequest struct {
	Name string  `json:"name" binding:"required"`
	Code *string `json:"code"`
	// Station ids in travel order — the array order IS the route, so a
	// reorder on the client is a resend, not a separate endpoint.
	StationIDs []string `json:"stationIds" binding:"required"`
	Active     *bool    `json:"active"`
}

// handleListMyOrgRoutes — GET /v1/parcel-orgs/me/routes.
func (s *Server) handleListMyOrgRoutes(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	routes, err := dbx.ListRoutes(c.Request.Context(), s.Pool, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your routes")
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": routes})
}

// handleSaveMyOrgRoute — POST /v1/parcel-orgs/me/routes (create) and
// POST /v1/parcel-orgs/me/routes/:id (replace).
//
// One handler for both because a route is small and positional: saving
// it is always "here is the whole thing", and splitting create from
// update would duplicate the station-ownership check that is the only
// interesting part.
func (s *Server) handleSaveMyOrgRoute(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgWrite)
	if orgID == "" {
		return
	}
	var req routeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "BAD_INPUT", "Give the route a name and its stops")
		return
	}
	stops := make([]string, 0, len(req.StationIDs))
	for _, id := range req.StationIDs {
		if t := strings.TrimSpace(id); t != "" {
			stops = append(stops, t)
		}
	}
	// Absent means active: a manager adding a route is adding one they
	// intend to run.
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	id, err := dbx.SaveRoute(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Param("id")), dbx.RouteInput{
		Name: req.Name, Code: req.Code, StationIDs: stops, Active: active,
	})
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

// handleDeleteMyOrgRoute — DELETE /v1/parcel-orgs/me/routes/:id.
func (s *Server) handleDeleteMyOrgRoute(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgWrite)
	if orgID == "" {
		return
	}
	if err := dbx.DeleteRoute(c.Request.Context(), s.Pool, orgID, strings.TrimSpace(c.Param("id"))); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
