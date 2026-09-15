package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
)

// Admin CRUD for the pickup-point network and the coverage rate card.
//
// Both reuse the existing parcels.* capability vocabulary rather than
// minting new ones: onboarding a shop and editing a zone are the same
// kind of act by the same kind of person, and a capability set that
// grows a string per screen stops being a permission model.

type parcelAgentRequest struct {
	Name         string  `json:"name" binding:"required"`
	PartyID      *string `json:"partyId"`
	ZoneID       *string `json:"zoneId"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	Msisdn       string  `json:"msisdn" binding:"required"`
	LocationHint string  `json:"locationHint" binding:"required"`
	OpeningHours *string `json:"openingHours"`
	Capacity     int     `json:"capacity"`
	HoldingFee   float64 `json:"holdingFeeKes"`
	Active       *bool   `json:"active"`
}

// toInput — Active defaults to true on create (an agent you just
// onboarded is one you want taking parcels) but is honoured verbatim on
// update, where a nil would otherwise silently reactivate a shop an
// admin had just switched off.
func (r parcelAgentRequest) toInput(defaultActive bool) dbx.ParcelAgentInput {
	active := defaultActive
	if r.Active != nil {
		active = *r.Active
	}
	capacity := r.Capacity
	if capacity == 0 {
		capacity = 50
	}
	return dbx.ParcelAgentInput{
		Name: r.Name, PartyID: r.PartyID, ZoneID: r.ZoneID,
		Lat: r.Lat, Lng: r.Lng, Msisdn: r.Msisdn,
		LocationHint: r.LocationHint, OpeningHours: r.OpeningHours,
		Capacity: capacity, HoldingFee: r.HoldingFee, Active: active,
	}
}

// handleAdminListParcelAgents — GET /v1/admin/parcels/agents. Returns
// inactive shops too, unlike the public list: the whole point of the
// admin view is seeing the ones that are switched off.
func (s *Server) handleAdminListParcelAgents(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	agents, err := dbx.ListParcelAgents(c.Request.Context(), s.Pool, false)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load pickup points")
		return
	}
	c.JSON(http.StatusOK, gin.H{"agents": agents})
}

func (s *Server) handleAdminCreateParcelAgent(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	var req parcelAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	var staffID *string
	if ctx.ActorID != "" {
		staffID = &ctx.ActorID
	}
	id, err := dbx.CreateParcelAgent(c.Request.Context(), s.Pool, req.toInput(true), staffID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id})
}

func (s *Server) handleAdminUpdateParcelAgent(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	var req parcelAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.UpdateParcelAgent(c.Request.Context(), s.Pool, c.Param("id"), req.toInput(true)); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": true})
}

type coverageTierRequest struct {
	Name        string       `json:"name" binding:"required"`
	MaxCoverKes money.Amount `json:"maxCoverKes"`
	FeeKes      money.Amount `json:"feeKes"`
	FeePct      float64      `json:"feePct"`
	SortOrder   int          `json:"sortOrder"`
	Active      *bool        `json:"active"`
}

func (s *Server) handleAdminListCoverageTiers(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.read", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have access to parcels")
		return
	}
	tiers, err := dbx.ListCoverageTiers(c.Request.Context(), s.Pool, false)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load cover levels")
		return
	}
	c.JSON(http.StatusOK, gin.H{"tiers": tiers})
}

// handleAdminUpsertCoverageTier — POST /v1/admin/parcels/coverage.
// Upsert by name rather than create/update by id, matching
// dbx.UpsertCoverageTier: the rate card is a small named set an admin
// edits in place, not a growing collection.
func (s *Server) handleAdminUpsertCoverageTier(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.edit", nil); err != nil {
		writeError(c, http.StatusForbidden, "DENIED", "You can't edit parcel settings")
		return
	}
	var req coverageTierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	err := dbx.UpsertCoverageTier(c.Request.Context(), s.Pool, dbx.ParcelCoverageTier{
		Name: req.Name, MaxCoverKes: req.MaxCoverKes, FeeKes: req.FeeKes,
		FeePct: req.FeePct, Active: active, SortOrder: req.SortOrder,
	}, ctx.ActorID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}
