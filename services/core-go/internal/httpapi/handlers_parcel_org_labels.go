package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/fleetqr"
)

// A courier company's own label stock.
//
// Stock became owned when parcel_label_stock gained parcelOrgId, and
// BookParcel refuses a code belonging to another company. Pads are
// issued to a company by Esoqo admin — a company never mints its own —
// and every handler here takes its org from the session, never the
// request (see this package's handlers_parcel_orgs.go on why that
// shape is the whole tenancy boundary).

// handleSearchOrgLabels — GET /v1/parcel-orgs/me/labels/search?q=.
//
// The custom-parcel picker's lookup: a desk holding a physical sticker
// types its last few characters and picks the full code. Suffix match
// over the company's own blank stock only — spent, filled-in or
// withdrawn labels are never offered, because attaching spends the
// label and only a genuinely unused sticker can be spent.
func (s *Server) handleSearchOrgLabels(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgRead)
	if orgID == "" {
		return
	}
	rows, err := dbx.SearchOrgLabels(c.Request.Context(), s.Pool, orgID, c.Query("q"), 15)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SEARCH_FAILED", "Could not search your labels")
		return
	}
	c.JSON(http.StatusOK, gin.H{"labels": rows})
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
	// Signed here for the same reason the stock endpoint signs (see
	// handleAdminListParcelLabelStock): the company reprints its own
	// pads from this register, and a reprinted QR must verify as
	// genuine. The org is the session's own, batch ids ride on the rows.
	for i := range rows {
		var batchID string
		if rows[i].BatchID != nil {
			batchID = *rows[i].BatchID
		}
		orgForSig := orgID
		if rows[i].ParcelOrgID != "" {
			orgForSig = rows[i].ParcelOrgID
		}
		rows[i].Sig = fleetqr.SignLabel(s.Cfg.FleetQrSecret, rows[i].Code, orgForSig, batchID)
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

// handleOrgVoidLabels — POST /v1/parcel-orgs/me/labels/void.
//
// A desk discarding one misprinted sticker or a handful of them,
// without voiding the whole pad. Scoped by session org exactly like
// the batch void below, so the selection can never reach into another
// company's stock. Live-only: spent codes stay on their parcels and
// unknown codes are ignored; the response says how many went.
func (s *Server) handleOrgVoidLabels(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgDispatch)
	if orgID == "" {
		return
	}
	var req struct {
		Codes  []string `json:"codes" binding:"required"`
		Reason string   `json:"reason" binding:"required"`
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
	voided, err := dbx.VoidParcelLabelsByCodes(c.Request.Context(), s.Pool, req.Codes, &orgID, req.Reason, staffID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"voided": voided})
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
