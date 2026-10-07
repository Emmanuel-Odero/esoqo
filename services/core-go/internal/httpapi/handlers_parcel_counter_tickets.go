package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// The walk-in counter ticket surface.
//
// Three endpoints are public — create, patch-draft, stream-one — the
// same "the id itself is the bearer credential" convention a parcel
// tracking code already follows (see dbx.GetCounterTicket's own
// comment): a kiosk, a counter-QR web form and the app all hit these
// with no Esoqo account behind them. The other three are parcel-org
// staff, scoped through orgCtx exactly like every other courier-company
// endpoint in handlers_parcel_orgs.go.

type createCounterTicketRequest struct {
	OrgID        string          `json:"orgId" binding:"required"`
	Msisdn       string          `json:"msisdn" binding:"required"`
	Channel      string          `json:"channel" binding:"required"`
	DraftDetails json.RawMessage `json:"draftDetails"`
}

// handleCreateCounterTicket — POST /v1/parcels/counter-tickets. Rate
// limited like every other unauthenticated write in this file (see
// book:parcel) — a kiosk left running is still one device, not a
// reason to let it mint unlimited tickets.
func (s *Server) handleCreateCounterTicket(c *gin.Context) {
	var req createCounterTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.Msisdn, "Phone number") {
		return
	}
	t, err := dbx.CreateCounterTicket(c.Request.Context(), s.Pool, req.OrgID, req.Msisdn, req.Channel, req.DraftDetails)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": t})
}

type patchCounterTicketDraftRequest struct {
	DraftDetails json.RawMessage `json:"draftDetails"`
}

// handlePatchCounterTicketDraft — PATCH /v1/parcels/counter-tickets/:id/draft.
// Lets a customer keep saving send-parcel form progress while they
// wait, so a clerk's intake screen has something to prefill from at
// claim time (see ParcelCounterTicket.draftDetails's own comment).
func (s *Server) handlePatchCounterTicketDraft(c *gin.Context) {
	var req patchCounterTicketDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.UpdateCounterTicketDraft(c.Request.Context(), s.Pool, c.Param("id"), req.DraftDetails); err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"saved": true})
}

// handleGetCounterTicket — GET /v1/parcels/counter-tickets/:id. The
// non-streaming fallback (and what the stream handler's own first
// event is built from) — a client that can't hold an SSE connection
// open still has to be able to check in.
func (s *Server) handleGetCounterTicket(c *gin.Context) {
	t, err := dbx.GetCounterTicket(c.Request.Context(), s.Pool, c.Param("id"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that ticket")
		return
	}
	if t == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "No ticket with that id")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": t})
}

// handleStreamCounterTicket — GET /v1/parcels/counter-tickets/:id/stream.
// SSE, public, the ticket id itself the only credential — pushes the
// full ticket row (not just an event name) on every change relevant to
// it, so the customer's own "you'll be served shortly" screen flips to
// "you're being served" the moment a clerk claims it, without a poll
// loop.
func (s *Server) handleStreamCounterTicket(c *gin.Context) {
	id := c.Param("id")
	first, err := dbx.GetCounterTicket(c.Request.Context(), s.Pool, id)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that ticket")
		return
	}
	if first == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "No ticket with that id")
		return
	}
	s.streamCounterTicketEvents(c, func(ev dbx.CounterTicketEvent) bool {
		return ev.TicketID == id
	}, func(w *sseWriter) {
		w.writeJSON("ticket", first)
	}, func(w *sseWriter, ev dbx.CounterTicketEvent) {
		t, err := dbx.GetCounterTicket(c.Request.Context(), s.Pool, id)
		if err != nil || t == nil {
			return
		}
		w.writeJSON("ticket", t)
	})
}

// handleListCounterTicketQueue — GET /v1/parcel-orgs/me/counter-tickets/queue.
// The clerk board's initial paint: the waiting queue, oldest ticket
// first, plus every case the company currently has claimed — see
// dbx.ListCounterTicketQueue for why the second list has to ride along
// (a CLAIMED ticket was the one status no screen ever read, which is
// how a refresh mid-service used to make a case disappear entirely).
func (s *Server) handleListCounterTicketQueue(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgIntake)
	if orgID == "" {
		return
	}
	ctx := ctxFromGin(c)
	board, err := dbx.ListCounterTicketQueue(c.Request.Context(), s.Pool, orgID, ctx.ActorID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load the queue")
		return
	}
	c.JSON(http.StatusOK, gin.H{"tickets": board.Waiting, "active": board.Active})
}

// handleListCounterTicketHistory — GET /v1/parcel-orgs/me/counter-tickets/history.
// The counter's register of closed cases: discarded, aged out, or
// completed (booked and paid). Kept separate from the queue endpoint
// because it answers a different question — not "who is waiting right
// now" but "what happened to every case that is no longer live" — and
// because a busy desk's queue should not carry fifty rows of history
// through it on every SSE-triggered refresh.
func (s *Server) handleListCounterTicketHistory(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgIntake)
	if orgID == "" {
		return
	}
	rows, err := dbx.ListCounterTicketHistory(c.Request.Context(), s.Pool, orgID, 50)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load the register")
		return
	}
	c.JSON(http.StatusOK, gin.H{"tickets": rows})
}

// handleStreamCounterTicketQueue — GET /v1/admin/parcels/counter-tickets/stream.
// SSE, staff. Deliberately signal-only ("something in your queue
// changed, go re-fetch") rather than pushing ticket rows itself: the
// queue is a list, and re-deriving "what should the list look like
// now" from a stream of individual insert/claim/expire events on the
// client is exactly the kind of state-reconciliation bug a single
// source of truth (the GET above) avoids for free. One extra small
// request per change is a fair trade for never drifting.
func (s *Server) handleStreamCounterTicketQueue(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgIntake)
	if orgID == "" {
		return
	}
	s.streamCounterTicketEvents(c, func(ev dbx.CounterTicketEvent) bool {
		return ev.OrgID == orgID
	}, func(w *sseWriter) {
		w.writeJSON("ready", gin.H{})
	}, func(w *sseWriter, ev dbx.CounterTicketEvent) {
		w.writeJSON("queue-changed", gin.H{"event": ev.Event})
	})
}

// handleClaimCounterTicket — POST /v1/admin/parcels/counter-tickets/:id/claim.
// A clerk tapping "Serve" — see dbx.ClaimCounterTicket's own comment on
// why the org scope rides in the UPDATE itself, not a check after.
func (s *Server) handleClaimCounterTicket(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgIntake)
	if orgID == "" {
		return
	}
	ctx := ctxFromGin(c)
	t, err := dbx.ClaimCounterTicket(c.Request.Context(), s.Pool, c.Param("id"), ctx.ActorID, orgID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": t})
}

type cancelCounterTicketRequest struct {
	Reason *string `json:"reason"`
}

// handleCancelCounterTicket — POST
// /v1/parcel-orgs/me/counter-tickets/:id/cancel. A clerk discarding a
// ticket — a sender who never showed at the counter, or one who walked
// away mid-service, before BookParcelFromCounterTicket ever ran (see
// dbx.CancelCounterTicket for why that's the hard line).
func (s *Server) handleCancelCounterTicket(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgIntake)
	if orgID == "" {
		return
	}
	var req cancelCounterTicketRequest
	_ = c.ShouldBindJSON(&req) // optional body — reason is never required
	ctx := ctxFromGin(c)
	t, err := dbx.CancelCounterTicket(c.Request.Context(), s.Pool, c.Param("id"), ctx.ActorID, orgID, req.Reason)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": t})
}

// handleReleaseCounterTicket — POST
// /v1/parcel-orgs/me/counter-tickets/:id/release. A clerk putting an
// in-progress case back in the queue — wrong claim, or the sender
// needs someone else — instead of leaving it CLAIMED where no queue
// ever looked. Only the claimer can do this, and only before a parcel
// exists (see dbx.ReleaseCounterTicket).
func (s *Server) handleReleaseCounterTicket(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgIntake)
	if orgID == "" {
		return
	}
	ctx := ctxFromGin(c)
	t, err := dbx.ReleaseCounterTicket(c.Request.Context(), s.Pool, c.Param("id"), ctx.ActorID, orgID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": t})
}

type bookCounterTicketRequest struct {
	SenderName             string   `json:"senderName" binding:"required"`
	SenderMsisdn           string   `json:"senderMsisdn" binding:"required"`
	ReceiverName           string   `json:"receiverName" binding:"required"`
	ReceiverMsisdn         string   `json:"receiverMsisdn" binding:"required"`
	ParcelType             string   `json:"parcelType"`
	WeightKg               *float64 `json:"weightKg"`
	DestinationLabel       string   `json:"destinationLabel" binding:"required"`
	SenderDeclaredContents *string  `json:"senderDeclaredContents"`
	DeclaredValueKes       *float64 `json:"declaredValueKes"`
	LabelCode              *string  `json:"labelCode"`
}

// handleBookCounterTicket — POST
// /v1/parcel-orgs/me/counter-tickets/:id/book. Fired from the "1.
// Confirm" step once the clerk has fixed up whatever the sender typed,
// right before attaching a label — see dbx.BookParcelFromCounterTicket
// for why this has to exist at all.
func (s *Server) handleBookCounterTicket(c *gin.Context) {
	orgID := s.orgCtx(c, authsvc.CapParcelOrgIntake)
	if orgID == "" {
		return
	}
	var req bookCounterTicketRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	parcelID, code, serviceTicketNumber, err := dbx.BookParcelFromCounterTicket(
		c.Request.Context(), s.Pool, c.Param("id"), orgID, ctx.ActorID,
		dbx.CounterTicketBookingInput{
			SenderName: req.SenderName, SenderMsisdn: req.SenderMsisdn,
			ReceiverName: req.ReceiverName, ReceiverMsisdn: req.ReceiverMsisdn,
			ParcelType: req.ParcelType, WeightKg: req.WeightKg,
			DestinationLabel:       req.DestinationLabel,
			SenderDeclaredContents: req.SenderDeclaredContents,
			DeclaredValueKes:       req.DeclaredValueKes,
			LabelCode:              req.LabelCode,
		})
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"parcelId": parcelID, "code": code, "serviceTicketNumber": serviceTicketNumber,
	})
}

// ── SSE plumbing ────────────────────────────────────────────────────
//
// One Postgres LISTEN per connected client, not one per org/ticket —
// see dbx's own package comment on why CounterTicketChannel is a
// single channel with a filtered payload rather than N sanitized
// channel names. Kept here, not in dbx, because it's gin/pgxpool
// wiring, not a data-access concern.

type sseWriter struct{ c *gin.Context }

func (w *sseWriter) writeJSON(event string, payload any) {
	w.c.SSEvent(event, payload)
	w.c.Writer.Flush()
}

// streamCounterTicketEvents holds one SSE connection open, LISTENing
// on dbx.CounterTicketChannel for as long as the client stays
// connected. `match` filters the shared channel down to what this
// particular subscriber (one org's queue, or one ticket) cares about;
// `onEvent` decides what to actually send when a match arrives.
// `sendFirst` writes whatever the connection's opening frame should be
// (a full ticket snapshot, or a bare "ready") before the loop starts,
// so a client never has to wonder whether its first render is current.
//
// A keep-alive comment line goes out every 20s regardless of real
// events — the payload-less kind SSE clients are required to ignore —
// purely so an intermediate proxy with its own idle-connection timeout
// doesn't decide this connection is dead.
func (s *Server) streamCounterTicketEvents(
	c *gin.Context,
	match func(dbx.CounterTicketEvent) bool,
	sendFirst func(*sseWriter),
	onEvent func(*sseWriter, dbx.CounterTicketEvent),
) {
	ctx := c.Request.Context()
	conn, err := s.NotifyPool.Acquire(ctx)
	if err != nil {
		writeError(c, http.StatusServiceUnavailable, "STREAM_UNAVAILABLE", "Could not open a live connection")
		return
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN "+dbx.CounterTicketChannel); err != nil {
		writeError(c, http.StatusServiceUnavailable, "STREAM_UNAVAILABLE", "Could not open a live connection")
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no") // nginx: don't buffer an SSE body

	events := make(chan dbx.CounterTicketEvent, 16)
	listenErr := make(chan error, 1)
	go func() {
		defer close(events)
		for {
			notif, err := conn.Conn().WaitForNotification(ctx)
			if err != nil {
				listenErr <- err
				return
			}
			var ev dbx.CounterTicketEvent
			if json.Unmarshal([]byte(notif.Payload), &ev) != nil {
				continue
			}
			select {
			case events <- ev:
			case <-ctx.Done():
				return
			}
		}
	}()

	w := &sseWriter{c: c}
	sendFirst(w)
	c.Writer.Flush()

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-listenErr:
			return
		case ev, ok := <-events:
			if !ok {
				return
			}
			if match(ev) {
				onEvent(w, ev)
			}
		case <-ticker.C:
			_, _ = c.Writer.Write([]byte(": keep-alive\n\n"))
			c.Writer.Flush()
		}
	}
}
