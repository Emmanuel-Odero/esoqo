package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// A courier company's own label stock.
//
// Stock became owned when parcel_label_stock gained parcelOrgId, and
// BookParcel refuses a code belonging to another company — but until
// now the only screen that could mint or print a pad lived under Esoqo
// admin. A company that is supposed to own its stock had no way to get
// any, which made the ownership rule true on paper and useless in
// practice.
//
// Every handler here takes its org from the session, never the request
// — see this package's handlers_parcel_orgs.go on why that shape is the
// whole tenancy boundary. That also means minting cannot be aimed at
// somebody else's pool even by a caller who tries: there is no field to
// aim it with.

// handleOrgGenerateLabels — POST /v1/parcel-orgs/me/labels/generate.
//
// Gated on dispatch rather than read: printing stock is committing the
// company to a range of codes it will be accountable for, which is an
// operational act, not a lookup. Same reasoning that puts the Esoqo-side
// mint behind parcels.assign.
func (s *Server) handleOrgGenerateLabels(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req struct {
		Count int `json:"count" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	var staffID *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		staffID = &id
	}
	codes, batchID, err := dbx.GenerateParcelLabelStock(c.Request.Context(), s.Pool, req.Count, staffID, &orgID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"codes": codes, "batchId": batchID})
}

// handleOrgListLabelRegister — GET /v1/parcel-orgs/me/labels?state=.
// The company's own register, scoped by the session's org so it can
// never show another's codes — reprinting someone else's stock is how
// one pad ends up in two places at once.
func (s *Server) handleOrgListLabelRegister(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	state := c.Query("state")
	if state == "" {
		state = "blank"
	}
	rows, err := dbx.ListParcelLabelRegister(c.Request.Context(), s.Pool, state, &orgID, 200)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	counts, err := dbx.CountParcelLabelStates(c.Request.Context(), s.Pool, &orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not count your labels")
		return
	}
	c.JSON(http.StatusOK, gin.H{"labels": rows, "counts": counts})
}

// handleOrgListLabelBatches — GET /v1/parcel-orgs/me/labels/batches.
func (s *Server) handleOrgListLabelBatches(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	rows, err := dbx.ListParcelLabelBatches(c.Request.Context(), s.Pool, &orgID, 100)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load your batches")
		return
	}
	c.JSON(http.StatusOK, gin.H{"batches": rows})
}

// handleOrgVoidLabelBatch — POST /v1/parcel-orgs/me/labels/batches/:id/void.
//
// A company withdrawing its own stolen pad, without having to phone
// Esoqo to do it. Scoped by session org, so the void can never reach
// across into another company's batch even given its id.
func (s *Server) handleOrgVoidLabelBatch(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	var staffID *string
	if ctx.ActorID != "" {
		id := ctx.ActorID
		staffID = &id
	}
	voided, err := dbx.VoidParcelLabelBatch(c.Request.Context(), s.Pool, c.Param("id"), &orgID, req.Reason, staffID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"voided": voided})
}
