package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/notify"
)

// Courier teams console API — a dispatch-planning layer on top of the
// existing individual-courier role (handlers_admin_parcels.go's own
// courier onboarding). Same capability, parcels.couriers.manage,
// throughout: creating/growing a team, adding a fleet, and assigning
// parcels to one are all the same trust tier as onboarding a courier
// in the first place.

func writeCourierTeamError(c *gin.Context, err error) {
	if te, ok := err.(*dbx.CourierTeamError); ok {
		status := http.StatusBadRequest
		if te.Code == "NOT_FOUND" {
			status = http.StatusNotFound
		}
		writeError(c, status, te.Code, te.Message)
		return
	}
	writeParcelAdminError(c, err)
}

type courierTeamMemberRequest struct {
	Name   string `json:"name" binding:"required"`
	Msisdn string `json:"msisdn" binding:"required"`
	Role   string `json:"role"`
}

type createCourierTeamRequest struct {
	Name    string                   `json:"name" binding:"required"`
	Manager courierTeamMemberRequest `json:"manager" binding:"required"`
}

// handleCreateCourierTeam — POST /v1/admin/parcels/courier-teams.
func (s *Server) handleCreateCourierTeam(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.couriers.manage", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req createCourierTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	var staffID *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		staffID = &id
	}
	teamID, _, esokoID, err := dbx.CreateCourierTeam(c.Request.Context(), s.Pool, req.Name, dbx.CourierTeamMemberInput{
		Name: req.Manager.Name, Msisdn: req.Manager.Msisdn, Role: req.Manager.Role,
	}, staffID)
	if err != nil {
		writeCourierTeamError(c, err)
		return
	}
	role := req.Manager.Role
	if role == "" {
		role = "MANAGER"
	}
	_ = authsvc.SendSms(req.Manager.Msisdn, notify.CourierTeamMemberAdded(req.Manager.Name, req.Name, role, esokoID), "COURIER_TEAM_ADDED")
	c.JSON(http.StatusOK, gin.H{"teamId": teamID, "esokoId": esokoID})
}

// handleListCourierTeams — GET /v1/admin/parcels/courier-teams.
func (s *Server) handleListCourierTeams(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := requireAnyCapability(ctx, "parcels.read", "parcels.couriers.manage"); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	rows, err := dbx.ListCourierTeams(c.Request.Context(), s.Pool)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load courier teams")
		return
	}
	c.JSON(http.StatusOK, gin.H{"teams": rows})
}

// handleGetCourierTeam — GET /v1/admin/parcels/courier-teams/:id.
func (s *Server) handleGetCourierTeam(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := requireAnyCapability(ctx, "parcels.read", "parcels.couriers.manage"); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	name, members, fleets, err := dbx.GetCourierTeamDetail(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that team")
		return
	}
	if name == "" {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That team was not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"name": name, "members": members, "fleets": fleets})
}

// handleAddCourierTeamMember — POST /v1/admin/parcels/courier-teams/:id/members.
func (s *Server) handleAddCourierTeamMember(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.couriers.manage", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req courierTeamMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	teamID := c.Param("id")
	_, esokoID, err := dbx.AddCourierTeamMember(c.Request.Context(), s.Pool, teamID, dbx.CourierTeamMemberInput{
		Name: req.Name, Msisdn: req.Msisdn, Role: req.Role,
	})
	if err != nil {
		writeCourierTeamError(c, err)
		return
	}
	teamName, _, _, terr := dbx.GetCourierTeamDetail(c.Request.Context(), s.Pool, teamID)
	if terr == nil && teamName != "" {
		role := req.Role
		if role == "" {
			role = "MEMBER"
		}
		_ = authsvc.SendSms(req.Msisdn, notify.CourierTeamMemberAdded(req.Name, teamName, role, esokoID), "COURIER_TEAM_ADDED")
	}
	c.JSON(http.StatusOK, gin.H{"esokoId": esokoID})
}

type updateCourierTeamRequest struct {
	Name string `json:"name" binding:"required"`
}

// handleUpdateCourierTeam — PATCH /v1/admin/parcels/courier-teams/:id.
// Renames the team; the roster/fleets underneath are untouched (edit
// a member's own details via handleUpdateCourierTeamMember instead).
func (s *Server) handleUpdateCourierTeam(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.couriers.manage", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req updateCourierTeamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.UpdateCourierTeamName(c.Request.Context(), s.Pool, c.Param("id"), req.Name); err != nil {
		writeCourierTeamError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleUpdateCourierTeamMember — PATCH
// /v1/admin/parcels/courier-teams/:id/members/:partyId. A different
// HTTP method (PATCH) than the POST .../members route above, so this
// gets its own tree in gin's router — no risk of the static/param
// clash a shared method would (see this file's other routes' own
// comments on that class of bug).
func (s *Server) handleUpdateCourierTeamMember(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.couriers.manage", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req courierTeamMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	teamID := c.Param("id")
	esokoID, err := dbx.UpdateCourierTeamMember(c.Request.Context(), s.Pool, teamID, c.Param("partyId"), dbx.CourierTeamMemberUpdate{
		Name: req.Name, Msisdn: req.Msisdn, Role: req.Role,
	})
	if err != nil {
		writeCourierTeamError(c, err)
		return
	}
	teamName, _, _, terr := dbx.GetCourierTeamDetail(c.Request.Context(), s.Pool, teamID)
	if terr == nil && teamName != "" {
		role := req.Role
		if role == "" {
			role = "MEMBER"
		}
		_ = authsvc.SendSms(req.Msisdn, notify.CourierTeamMemberUpdated(req.Name, teamName, role, esokoID), "COURIER_TEAM_UPDATED")
	}
	c.JSON(http.StatusOK, gin.H{"esokoId": esokoID})
}

type addCourierFleetRequest struct {
	FleetNumber string `json:"fleetNumber" binding:"required"`
	VehicleType string `json:"vehicleType" binding:"required"`
}

// handleAddCourierFleet — POST /v1/admin/parcels/courier-teams/:id/fleets.
func (s *Server) handleAddCourierFleet(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.couriers.manage", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req addCourierFleetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	fleetID, err := dbx.AddCourierFleet(c.Request.Context(), s.Pool, c.Param("id"), req.FleetNumber, req.VehicleType)
	if err != nil {
		writeCourierTeamError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"fleetId": fleetID})
}

type assignParcelsToFleetRequest struct {
	Codes []string `json:"codes" binding:"required"`
}

// handleAssignParcelsToFleet — POST /v1/admin/parcels/fleets/:id/assign.
func (s *Server) handleAssignParcelsToFleet(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var req assignParcelsToFleetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	tripID, assigned, err := dbx.AssignParcelsToFleet(c.Request.Context(), s.Pool, c.Param("id"), req.Codes)
	if err != nil {
		writeCourierTeamError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tripId": tripID, "assigned": assigned})
}

// handleCompleteCourierTrip — POST /v1/admin/parcels/trips/:id/complete.
// Texts every member of the fleet's team (manager included) once the
// trip actually flips to COMPLETE — never on a replayed call against
// an already-complete trip, same "no duplicate SMS on a retried
// action" reasoning ScanHandoff's own wasFirstPickup follows.
func (s *Server) handleCompleteCourierTrip(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeParcelAdminError(c, err)
		return
	}
	var staffID *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		staffID = &id
	}
	tripID := c.Param("id")
	alreadyComplete, err := dbx.CompleteTrip(c.Request.Context(), s.Pool, tripID, staffID)
	if err != nil {
		writeCourierTeamError(c, err)
		return
	}
	if !alreadyComplete {
		if info, ierr := dbx.GetCourierTripCompletionInfo(c.Request.Context(), s.Pool, tripID); ierr == nil && info != nil {
			message := notify.CourierTripCompleted(info.FleetNumber, info.ParcelCount)
			for _, m := range info.Recipients {
				if m.Msisdn == nil || *m.Msisdn == "" {
					continue
				}
				_ = authsvc.SendSms(*m.Msisdn, message, "COURIER_TRIP_COMPLETED")
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
