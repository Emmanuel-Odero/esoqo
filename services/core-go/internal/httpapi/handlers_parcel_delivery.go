package httpapi

import (
	"io"
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/notify"
	"github.com/esoqo/core-go/internal/storage"
)

// The courier-facing half of the parcel lifecycle that isn't a clean
// success: recording a failed attempt, dropping at a pickup point,
// giving up and returning to sender — plus the proof-of-delivery photo
// upload all of them lean on.
//
// Every one of these is gated on custody, never on capability: the
// person who can act on a parcel is whoever physically has it (see
// dbx.RecordDeliveryAttempt's own comment on why possession, not a
// role, is the right check here). The single exception is the
// staff-override return, which exists precisely for the case where the
// holder has stopped responding.

// ── Proof-of-delivery photo ──────────────────────────────────────────

// handleUploadPodPhoto — POST /v1/parcels/:code/pod-photo. Auth
// required and gated on custody: only the courier currently holding
// this parcel can attach a photo to it.
//
// Returns a storage key, not a URL. The key is what goes on the parcel
// row and what the read handler below resolves; handing out a direct
// bucket URL would make delivery photos publicly enumerable, which is
// the one thing a photo of somebody's doorway must never be.
func (s *Server) handleUploadPodPhoto(c *gin.Context) {
	ctx := ctxFromGin(c)
	code := c.Param("code")

	isHandler, err := dbx.IsParcelHandler(c.Request.Context(), s.Pool, code, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "UPLOAD_FAILED", "Could not load that parcel")
		return
	}
	if !isHandler {
		writeError(c, http.StatusForbidden, "DENIED", "You don't have this parcel in your custody")
		return
	}

	file, err := c.FormFile("photo")
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Attach a photo")
		return
	}
	// Size is refused from the declared length before a byte is read,
	// then again below from what was actually read — a multipart header
	// is a claim, not a measurement.
	if file.Size > storage.MaxImageBytes {
		writeError(c, http.StatusBadRequest, "TOO_LARGE", "That photo is too large - keep it under 5MB")
		return
	}
	opened, err := file.Open()
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Could not read that photo")
		return
	}
	defer opened.Close()

	body, err := io.ReadAll(io.LimitReader(opened, storage.MaxImageBytes+1))
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Could not read that photo")
		return
	}
	if len(body) > storage.MaxImageBytes {
		writeError(c, http.StatusBadRequest, "TOO_LARGE", "That photo is too large - keep it under 5MB")
		return
	}

	// The declared content type is ignored entirely — magic bytes
	// decide, same rule packages/db/src/storage.ts states first among
	// its own. A .jpg that starts with MZ is an executable.
	mime := storage.Sniff(body)
	if mime == "" {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "That file isn't a photo")
		return
	}
	key, err := storage.Key(mime)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "UPLOAD_FAILED", "Could not save that photo")
		return
	}
	if err := s.Storage.Put(c.Request.Context(), key, mime, body); err != nil {
		// The real error names buckets and endpoints — logged, never
		// returned, same split handlePayParcel keeps for Daraja failures.
		log.Printf("pod photo upload failed for %s: %v", code, err)
		writeError(c, http.StatusInternalServerError, "UPLOAD_FAILED", "Could not save that photo. Please try again.")
		return
	}
	c.JSON(http.StatusOK, gin.H{"photoKey": key})
}

// handleGetPodPhoto — GET /v1/parcels/:code/pod-photo. Deliberately
// serves the bytes through this handler rather than redirecting to the
// bucket, so the authorization below is the only way to the image.
//
// Readable by anyone holding the tracking code, which is the same
// bearer-credential model handleGetParcelStatus already uses: the
// sender and the receiver are precisely the two people who need to see
// where their parcel was left, and they are the two people the code was
// ever given to. The key is read from the parcel row, never from the
// query string — a client-supplied key would turn this into a reader
// for every photo in the bucket.
func (s *Server) handleGetPodPhoto(c *gin.Context) {
	status, err := dbx.GetParcelStatus(c.Request.Context(), s.Pool, c.Param("code"))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that parcel")
		return
	}
	if status == nil || status.PodPhotoURL == nil || *status.PodPhotoURL == "" {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "There's no delivery photo for that parcel")
		return
	}
	body, mime, err := s.Storage.Get(c.Request.Context(), *status.PodPhotoURL)
	if err != nil {
		log.Printf("pod photo read failed for %s: %v", c.Param("code"), err)
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That delivery photo is no longer available")
		return
	}
	if mime == "" {
		// Re-sniffed on read and rejected if it no longer looks like an
		// image — a stored object that changed shape is not something to
		// hand a browser a content type for.
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That delivery photo is no longer available")
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "inline")
	c.Header("Cache-Control", "private, max-age=300")
	c.Data(http.StatusOK, mime, body)
}

// ── Failed attempts ──────────────────────────────────────────────────

type recordAttemptRequest struct {
	Reason string   `json:"reason" binding:"required"`
	Note   *string  `json:"note"`
	Lat    *float64 `json:"lat"`
	Lng    *float64 `json:"lng"`
}

// handleRecordDeliveryAttempt — POST /v1/parcels/:code/attempt. The
// courier-side "I got there and couldn't hand it over".
//
// The SMS this sends is the entire point of the feature. Before it, a
// receiver who was out heard nothing at all: the courier kept carrying
// the parcel, it aged past its SLA, and the first anybody knew of a
// problem was a complaint days later.
func (s *Server) handleRecordDeliveryAttempt(c *gin.Context) {
	var req recordAttemptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	code := c.Param("code")
	attempts, err := dbx.RecordDeliveryAttempt(c.Request.Context(), s.Pool, code, ctx.PartyID, req.Reason, req.Note, req.Lat, req.Lng)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	if info, ierr := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code); ierr == nil && info != nil {
		text := dbx.AttemptReasonText(req.Reason, req.Note)
		if info.ReceiverMsisdn != "" {
			_ = authsvc.SendSms(info.ReceiverMsisdn, notify.ParcelDeliveryAttemptFailed(code, text, attempts), "PARCEL_ATTEMPT_FAILED")
		}
		// The sender hears about it too, but only once it's genuinely
		// going wrong. Texting a sender about every single missed
		// doorstep would train them to ignore the channel, which is the
		// fastest way to make the message that actually matters (the
		// third one, where their parcel is about to come back) invisible.
		if attempts >= 2 && info.SenderMsisdn != "" {
			_ = authsvc.SendSms(info.SenderMsisdn, notify.ParcelDeliveryAttemptFailed(code, text, attempts), "PARCEL_ATTEMPT_FAILED")
		}
	}
	c.JSON(http.StatusOK, gin.H{"status": "FAILED_DELIVERY", "attempts": attempts})
}

// handleListDeliveryAttempts — GET /v1/parcels/:code/attempts. Scoped
// to the parcel's own sender, exactly as handleListParcelHandoffs is
// and for the same reason: the log names the courier who tried.
func (s *Server) handleListDeliveryAttempts(c *gin.Context) {
	ctx := ctxFromGin(c)
	parcelID, senderPartyID, err := dbx.GetParcelSenderPartyID(c.Request.Context(), s.Pool, c.Param("code"))
	if err != nil {
		writeParcelError(c, err)
		return
	}
	if senderPartyID == nil || *senderPartyID != ctx.PartyID {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "You can only view your own parcel's delivery attempts")
		return
	}
	rows, err := dbx.ListDeliveryAttempts(c.Request.Context(), s.Pool, parcelID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load delivery attempts")
		return
	}
	c.JSON(http.StatusOK, gin.H{"attempts": rows})
}

// ── Pickup points ────────────────────────────────────────────────────

// handleListParcelAgents — GET /v1/parcels/agents?lat=&lng=&radiusKm=.
// Public, same reasoning handleListParcelZones is: the booking form
// needs somewhere for the receiver to collect from before the sender
// has signed in, let alone paid.
//
// With coordinates it returns the nearest shops with shelf space; with
// none it returns the whole active list (what an "all pickup points"
// browse screen wants).
func (s *Server) handleListParcelAgents(c *gin.Context) {
	latRaw, lngRaw := c.Query("lat"), c.Query("lng")
	if latRaw != "" && lngRaw != "" {
		lat, latErr := strconv.ParseFloat(latRaw, 64)
		lng, lngErr := strconv.ParseFloat(lngRaw, 64)
		if latErr != nil || lngErr != nil {
			writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "lat and lng must be numbers")
			return
		}
		radiusKm := 25.0
		if v := c.Query("radiusKm"); v != "" {
			if parsed, err := strconv.ParseFloat(v, 64); err == nil && parsed > 0 {
				radiusKm = parsed
			}
		}
		agents, err := dbx.ListParcelAgentsNear(c.Request.Context(), s.Pool, lat, lng, radiusKm, 20)
		if err != nil {
			writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load pickup points")
			return
		}
		c.JSON(http.StatusOK, gin.H{"agents": agents})
		return
	}
	agents, err := dbx.ListParcelAgents(c.Request.Context(), s.Pool, true)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load pickup points")
		return
	}
	c.JSON(http.StatusOK, gin.H{"agents": agents})
}

type holdAtAgentRequest struct {
	AgentID string `json:"agentId" binding:"required"`
}

// handleHoldParcelAtAgent — POST /v1/parcels/:code/hold-at-agent. The
// courier dropping a parcel on a shop's shelf.
//
// The SMS carries the shop's name, location text and opening hours
// because a status of "waiting at a pickup point" is worthless without
// them — the receiver's next action is a walk to a specific door.
func (s *Server) handleHoldParcelAtAgent(c *gin.Context) {
	var req holdAtAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	code := c.Param("code")
	drop, err := dbx.HoldParcelAtAgent(c.Request.Context(), s.Pool, code, req.AgentID, ctx.PartyID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	if info, ierr := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code); ierr == nil && info != nil {
		var hours string
		if drop.OpeningHours != nil {
			hours = *drop.OpeningHours
		}
		if info.ReceiverMsisdn != "" {
			_ = authsvc.SendSms(info.ReceiverMsisdn,
				notify.ParcelAtAgent(code, drop.AgentName, drop.LocationHint, hours, info.DeliveryCode, info.CarrierOrgName),
				"PARCEL_AT_AGENT")
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"status": "HELD_AT_AGENT", "agentName": drop.AgentName,
		"locationHint": drop.LocationHint, "holdingFeeKes": drop.HoldingFeeKes,
	})
}

// ── Returns ──────────────────────────────────────────────────────────

type returnParcelRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// handleReturnParcel — POST /v1/parcels/:code/return. The give-up path.
//
// Dispatch staff (parcels.cancel) can close a parcel this way even
// without holding it: a courier who has stopped answering their phone
// is exactly the situation that needs somebody else able to end the
// journey, and it was previously unrepresentable.
func (s *Server) handleReturnParcel(c *gin.Context) {
	var req returnParcelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	ctx := ctxFromGin(c)
	code := c.Param("code")
	isStaff := authsvc.RequireCapability(ctx, "parcels.cancel", nil) == nil
	if err := dbx.ReturnParcelToSender(c.Request.Context(), s.Pool, code, ctx.PartyID, req.Reason, isStaff); err != nil {
		writeParcelError(c, err)
		return
	}
	if info, ierr := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code); ierr == nil && info != nil && info.SenderMsisdn != "" {
		_ = authsvc.SendSms(info.SenderMsisdn, notify.ParcelReturnedToSender(code, req.Reason), "PARCEL_RETURNED")
	}
	c.JSON(http.StatusOK, gin.H{"status": "RETURNED_TO_SENDER"})
}

// handleGetParcelCourierPosition — GET /v1/parcels/:code/position.
// Public, code-gated, exactly like /status: the sender and the receiver
// are the two people who hold the code and the two people who want to
// know where their parcel is right now.
//
// Returns 200 with a null position rather than 404 when there's nothing
// to show. "Not moving right now" is a normal state for a parcel
// (booked, at an agent, delivered, or simply a courier whose phone
// hasn't pinged recently), and a client polling this shouldn't have to
// treat the common case as an error.
func (s *Server) handleGetParcelCourierPosition(c *gin.Context) {
	code := c.Param("code")

	// A parcel riding a passenger bus is tracked by the bus, not by the
	// conductor's phone. That vehicle is already reporting its position
	// for the passengers sitting in it, so it is both fresher and far
	// more reliable than a ping loop running on a handset in somebody's
	// pocket — and it costs nothing extra to use. Tried first for
	// exactly that reason; a parcel on no trip falls through to the
	// courier's own ping unchanged.
	if pos, err := dbx.GetParcelTripPosition(c.Request.Context(), s.Pool, code); err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that parcel")
		return
	} else if pos != nil {
		trip, terr := dbx.GetParcelTripInfo(c.Request.Context(), s.Pool, code)
		if terr != nil {
			// The position is the useful half; losing the route label
			// shouldn't cost the map.
			log.Printf("parcel %s trip info lookup failed: %v", code, terr)
		}
		c.JSON(http.StatusOK, gin.H{"position": pos, "trip": trip})
		return
	}

	pos, err := dbx.GetParcelCourierPosition(c.Request.Context(), s.Pool, code)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "GET_FAILED", "Could not load that parcel")
		return
	}
	c.JSON(http.StatusOK, gin.H{"position": pos})
}

// ── Coverage ─────────────────────────────────────────────────────────

// handleListCoverageTiers — GET /v1/parcels/coverage?declaredValueKes=.
// Public, same reasoning the pricing endpoint is.
//
// With a declared value it quotes each tier's actual fee and what a
// claim would actually pay out, rather than making the client
// re-implement the formula. That's the same rule handleSetParcelPrice
// follows for the dispatch price: the server owns the arithmetic, the
// client only renders it.
func (s *Server) handleListCoverageTiers(c *gin.Context) {
	tiers, err := dbx.ListCoverageTiers(c.Request.Context(), s.Pool, true)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LIST_FAILED", "Could not load cover options")
		return
	}
	var declaredValue money.Cents
	if v := c.Query("declaredValueKes"); v != "" {
		if parsed, perr := money.ParseKES(v); perr == nil && parsed.IsPositive() {
			declaredValue = parsed
		}
	}
	type quoted struct {
		dbx.ParcelCoverageTier
		FeeForValueKes     money.Amount `json:"feeForValueKes"`
		CoveredAmountKes   money.Amount `json:"coveredAmountKes"`
		CapsDeclaredAmount bool         `json:"capsDeclaredAmount"`
	}
	out := make([]quoted, 0, len(tiers))
	for _, t := range tiers {
		out = append(out, quoted{
			ParcelCoverageTier: t,
			FeeForValueKes:     money.AmountOf(t.CoverageFee(declaredValue)),
			CoveredAmountKes:   money.AmountOf(t.CoveredAmount(declaredValue)),
			// Surfaced explicitly so the UI can say "covers KES 25,000 of
			// the KES 40,000 you declared" instead of quietly showing a
			// smaller number than the sender typed.
			CapsDeclaredAmount: declaredValue > t.MaxCoverKes.Cents(),
		})
	}
	c.JSON(http.StatusOK, gin.H{"tiers": out, "declaredValueKes": declaredValue})
}
