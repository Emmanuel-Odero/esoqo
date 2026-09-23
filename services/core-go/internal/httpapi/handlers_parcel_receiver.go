package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/esoqo/core-go/internal/audit"
	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/notify"
)

// The receiver proving they are the receiver, from their own phone, by
// typing the delivery code.
//
// The companion to handlers_parcel_claim.go, which does the same job
// through an OTP to the number on file. Both end at the same
// projection; see dbx/parcel_receiver_auth.go for why two routes to one
// place is the right shape rather than a duplication.
//
// Everything here is public — no authRequired, no session. That is the
// premise: the person standing at an agent's counter with a box in
// front of them has no Esoqo account and is not going to make one. The
// controls are the per-parcel attempt counter on the row (three tries,
// then a company alert) and an IP rate limit at the route, which cover
// two different attacks and neither of which substitutes for the other.

// receiverTokenTTL — how long a passed verification is worth.
//
// Ten minutes, not the 24 hours dbx.ClaimTokenTTL allows a claim. A
// claim token buys a read; this one buys a WRITE that marks a parcel
// delivered, and the flow it exists for is "I just typed my code and
// now I am tapping Confirm" — measured in seconds. A long window here
// would leave a delivery-closing credential sitting in a browser on a
// shared phone at an agent's shop, which is exactly the environment
// this feature is designed for.
const receiverTokenTTL = 10 * time.Minute

func receiverTokenKey(token string) string { return "parcel-receiver-token:" + token }

// mintReceiverToken records "whoever holds this proved the delivery
// code for this parcel". The value is the parcel code, so spending a
// token for parcel A against parcel B fails on comparison rather than
// on the token merely existing.
func (s *Server) mintReceiverToken(ctx context.Context, code string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)
	if err := s.Redis.Set(ctx, receiverTokenKey(token), code, receiverTokenTTL).Err(); err != nil {
		return "", err
	}
	return token, nil
}

// spendReceiverToken checks a token against the parcel it was minted
// for and deletes it.
//
// Single-use, deliberately. The token authorises one irreversible act;
// letting it be replayed for ten minutes buys the caller nothing (they
// can re-verify) and costs a retry-storm's worth of duplicate
// DELIVERED writes if a flaky connection makes the client resend.
//
// Fails CLOSED on a Redis error, unlike authsvc's limiters, which fail
// open on purpose. Those are guards; this is the authorisation itself,
// and an outage must not silently turn "prove you are the receiver"
// into "ask nicely".
func (s *Server) spendReceiverToken(ctx context.Context, token, code string) bool {
	if token == "" {
		return false
	}
	stored, err := s.Redis.GetDel(ctx, receiverTokenKey(token)).Result()
	if err != nil {
		return false
	}
	return stored == code
}

type receiverVerifyRequest struct {
	DeliveryCode string `json:"deliveryCode" binding:"required"`
}

// handleVerifyReceiverCode — POST /v1/parcels/:code/receiver/verify.
//
// On success returns the receiver-tier projection (the same one the
// OTP claim path returns) plus a short-lived token and whether
// self-confirmation is open on this parcel.
//
// The delivery code is stripped from the response even though
// GetParcelPartyView populates it for a receiver. On the OTP path
// echoing it is the entire point — the receiver proved the phone and
// is being handed the code they never got. Here they just typed it, so
// echoing it adds nothing and turns a correct guess into a permanent
// readable copy on the page.
func (s *Server) handleVerifyReceiverCode(c *gin.Context) {
	var req receiverVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	code := c.Param("code")
	out, err := dbx.VerifyReceiverCode(c.Request.Context(), s.Pool, code, req.DeliveryCode, clientIP(c))
	if err != nil {
		writeError(c, http.StatusInternalServerError, "VERIFY_FAILED", "Could not check that code")
		return
	}

	switch out.Result {
	case dbx.ReceiverAuthLocked:
		if out.JustLocked {
			s.alertReceiverAuthLocked(c, code)
		}
		writeError(c, http.StatusTooManyRequests, "RECEIVER_LOCKED",
			"Too many wrong codes. Ask the sender to check the code, or the courier company can allow two more tries.")
		return

	case dbx.ReceiverAuthHardLocked:
		if out.JustLocked {
			s.alertReceiverAuthHardLocked(c, code)
		}
		writeError(c, http.StatusTooManyRequests, "RECEIVER_HARD_LOCKED",
			"This parcel is locked. The courier company has to issue a new delivery code before it can be collected.")
		return

	case dbx.ReceiverAuthWrong:
		// A parcel that does not exist lands here too, with TriesLeft 0
		// and no id — see VerifyReceiverCode on why that is
		// indistinguishable on purpose.
		// Saying how many remain is the same judgement
		// handleDeliverParcel already makes and for the same reason:
		// somebody who does not know a lockout is coming will spend
		// their last try on a guess instead of phoning the sender.
		msg := "That delivery code doesn't match."
		switch {
		case out.TriesLeft == 1:
			msg = "That delivery code doesn't match. 1 try left before this parcel locks."
		case out.TriesLeft > 1:
			msg = fmt.Sprintf("That delivery code doesn't match. %d tries left before this parcel locks.", out.TriesLeft)
		}
		writeError(c, http.StatusUnauthorized, "WRONG_CODE", msg)
		return
	}

	view, err := dbx.GetParcelPartyView(c.Request.Context(), s.Pool, code, dbx.ClaimTierReceiver)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	view.DeliveryCode = nil

	token, err := s.mintReceiverToken(c.Request.Context(), code)
	if err != nil {
		// The verification itself stands — the parcel's counters are
		// already cleared and the projection is good. Only the write
		// half is unavailable, so say so rather than failing the read.
		log.Printf("parcel %s: receiver verified but token mint failed: %v", code, err)
	}

	// Asked of dbx rather than re-derived from the projection above:
	// ParcelPartyView carries a COD amount but not a COD status, so
	// deciding here would hide the button on a parcel whose cash had
	// already been collected while DeliverParcel would have allowed it.
	// One rule, one author — see CanReceiverSelfConfirm.
	canSelfConfirm, reason, err := dbx.CanReceiverSelfConfirm(c.Request.Context(), s.Pool, code)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"parcel":            view,
		"receiverToken":     token,
		"canSelfConfirm":    canSelfConfirm && token != "",
		"selfConfirmReason": reason,
	})
}

type receiverConfirmRequest struct {
	ReceiverToken string `json:"receiverToken" binding:"required"`
}

// handleReceiverSelfConfirm — POST /v1/parcels/:code/receiver/confirm.
//
// Marks the parcel delivered on the receiver's own say-so. The single
// most privileged thing a guest can do anywhere in this API, so it is
// fenced on four sides: a token that only a passed verification mints,
// spent single-use here; HELD_AT_AGENT only; no outstanding COD; and
// courier pay held rather than accrued. The last three are enforced in
// dbx.DeliverParcel, not here, so a future second caller inherits them.
func (s *Server) handleReceiverSelfConfirm(c *gin.Context) {
	var req receiverConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	code := c.Param("code")
	if !s.spendReceiverToken(c.Request.Context(), req.ReceiverToken, code) {
		writeError(c, http.StatusUnauthorized, "RECEIVER_TOKEN_INVALID",
			"That confirmation expired. Enter your delivery code again.")
		return
	}

	// deliveredByPartyID is empty and the delivery code is empty: the
	// receiver is not holding the parcel and is not re-proving the code
	// (the token already did). DeliverParcel's self-confirm branch is
	// the one path that accepts both, which is why it is a distinct
	// branch rather than a flag on an existing one.
	proof := dbx.DeliverProof{}
	if err := dbx.DeliverParcel(c.Request.Context(), s.Pool, code, "", "", proof, false, false, true); err != nil {
		writeParcelError(c, err)
		return
	}

	// Both parties told, as on every other delivery. The receiver gets
	// nothing extra — they are the one who just tapped the button.
	if info, err := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code); err == nil && info != nil && info.SenderMsisdn != "" {
		deliveredAt := time.Now()
		if info.DeliveredAt != nil {
			deliveredAt = *info.DeliveredAt
		}
		_ = authsvc.SendSms(info.SenderMsisdn,
			notify.ParcelDelivered(code, info.DestinationLabel, deliveredAt), "PARCEL_DELIVERED")
	}
	c.JSON(http.StatusOK, gin.H{"delivered": true, "method": "RECEIVER_SELF_AGENT"})
}

// ── Escalation alerts ────────────────────────────────────────────────

// alertReceiverAuthLocked texts the carrying company's dispatch desk.
//
// Only the company, not Esoqo admin: admin sees the same lock in its
// own console queue without a message, and a platform-wide SMS on every
// receiver who fat-fingered a code three times is a spend with no
// action attached to it. Esoqo-operated parcels (no ParcelOrgID) have
// no desk to text and rely on that same queue.
//
// Fire-and-forget, matching every other notify call site in this
// package: a failed SMS must not turn into a 500 on a lockout that has
// already been recorded.
func (s *Server) alertReceiverAuthLocked(c *gin.Context, code string) {
	info, err := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code)
	if err != nil || info == nil || info.ParcelOrgID == nil {
		return
	}
	msisdns, err := dbx.ListOrgDispatchDeskMsisdns(c.Request.Context(), s.Pool, *info.ParcelOrgID)
	if err != nil {
		return
	}
	msg := notify.ParcelReceiverAuthLocked(code)
	for _, m := range msisdns {
		_ = authsvc.SendSms(m, msg, "PARCEL_RECEIVER_LOCKED")
	}
}

// alertReceiverAuthHardLocked texts the SENDER. See
// notify.ParcelReceiverAuthHardLocked for why not the receiver.
func (s *Server) alertReceiverAuthHardLocked(c *gin.Context, code string) {
	info, err := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code)
	if err != nil || info == nil {
		return
	}
	_ = authsvc.SendSms(info.SenderMsisdn,
		notify.ParcelReceiverAuthHardLocked(code, info.ReceiverName), "PARCEL_RECEIVER_HARD_LOCKED")
	// The desk is told as well. A hard lock is a work item — somebody
	// has to decide to reissue — and unlike the first lock it cannot
	// resolve itself.
	if info.ParcelOrgID == nil {
		return
	}
	if msisdns, err := dbx.ListOrgDispatchDeskMsisdns(c.Request.Context(), s.Pool, *info.ParcelOrgID); err == nil {
		for _, m := range msisdns {
			_ = authsvc.SendSms(m, notify.ParcelReceiverAuthLocked(code), "PARCEL_RECEIVER_HARD_LOCKED")
		}
	}
}

// ── Company-side resolution ──────────────────────────────────────────

// orgParcelForReceiverAuth resolves the session's org, checks the
// parcel is one of theirs, and answers the request itself on failure.
// Returns ok=false when the caller should simply return.
//
// "Not one of yours" and "does not exist" get the same answer, the same
// anti-oracle rule handleAssignOrgParcel already states.
func (s *Server) orgParcelForReceiverAuth(c *gin.Context, cap string) (code string, ok bool) {
	orgID := s.orgCtx(c, cap)
	if orgID == "" {
		return "", false
	}
	code = c.Param("code")
	owns, err := dbx.ParcelBelongsToOrg(c.Request.Context(), s.Pool, code, orgID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LOOKUP_FAILED", "Could not load that parcel")
		return "", false
	}
	if !owns {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That parcel isn't one of yours")
		return "", false
	}
	return code, true
}

// handleOrgGrantReceiverAuthRetry —
// POST /v1/parcel-orgs/me/parcels/:code/receiver-auth/grant-retry.
//
// Gated on CapParcelOrgDispatch rather than a carry/collection
// capability: this is a desk decision about a stuck parcel, made by
// whoever is watching the board, not by the rider holding the box.
func (s *Server) handleOrgGrantReceiverAuthRetry(c *gin.Context) {
	code, ok := s.orgParcelForReceiverAuth(c, authsvc.CapParcelOrgDispatch)
	if !ok {
		return
	}
	ctx := ctxFromGin(c)
	if err := dbx.GrantReceiverAuthRetry(c.Request.Context(), s.Pool, code, ctx.PartyID); err != nil {
		writeParcelError(c, err)
		return
	}
	s.auditParcelByCode(c, code, "parcel.receiver_auth_retry_granted", nil)
	c.JSON(http.StatusOK, gin.H{"granted": dbx.ReceiverAuthExtraAttempts})
}

// handleOrgReissueDeliveryCode —
// POST /v1/parcel-orgs/me/parcels/:code/delivery-code/reissue.
//
// The resolution at the end of the escalation: a new code, both parties
// texted, every lock cleared.
//
// The new code is NOT returned in the response body. A clerk does not
// need to read it — the two people who need it are being texted — and
// putting it on a console screen makes the one secret in this flow
// visible to every member of staff who walks past a monitor. That is
// the same reasoning that keeps it out of the event row's staffDetail.
func (s *Server) handleOrgReissueDeliveryCode(c *gin.Context) {
	code, ok := s.orgParcelForReceiverAuth(c, authsvc.CapParcelOrgDispatch)
	if !ok {
		return
	}
	ctx := ctxFromGin(c)
	newCode, err := dbx.ReissueDeliveryCode(c.Request.Context(), s.Pool, code, ctx.PartyID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	s.auditParcelByCode(c, code, "parcel.delivery_code_reissued", nil)
	s.sendReissuedCode(c, code, newCode)
	c.JSON(http.StatusOK, gin.H{"reissued": true})
}

// handleOrgReleaseHeldEarnings —
// POST /v1/parcel-orgs/me/parcels/:code/courier-earnings/release.
func (s *Server) handleOrgReleaseHeldEarnings(c *gin.Context) {
	code, ok := s.orgParcelForReceiverAuth(c, authsvc.CapParcelOrgEarnings)
	if !ok {
		return
	}
	ctx := ctxFromGin(c)
	if err := dbx.ReleaseHeldCourierEarnings(c.Request.Context(), s.Pool, code, ctx.PartyID); err != nil {
		writeParcelError(c, err)
		return
	}
	s.auditParcelByCode(c, code, "parcel.courier_earnings_released", nil)
	c.JSON(http.StatusOK, gin.H{"released": true})
}

// sendReissuedCode texts the new code to the receiver and the sender.
//
// Both, because a reissue most often happens precisely when the
// receiver's SMS is the thing that failed, and the sender relaying it
// by voice is then the only path that works. See
// notify.ParcelDeliveryCodeReissuedToSender.
func (s *Server) sendReissuedCode(c *gin.Context, code, newCode string) {
	info, err := dbx.GetParcelNotifyInfo(c.Request.Context(), s.Pool, code)
	if err != nil || info == nil {
		log.Printf("parcel %s: delivery code reissued but nobody could be texted: %v", code, err)
		return
	}
	_ = authsvc.SendSms(info.ReceiverMsisdn,
		notify.ParcelDeliveryCodeReissued(code, newCode), "PARCEL_CODE_REISSUED")
	_ = authsvc.SendSms(info.SenderMsisdn,
		notify.ParcelDeliveryCodeReissuedToSender(code, newCode, info.ReceiverName), "PARCEL_CODE_REISSUED")
}

// auditParcelByCode writes the hash-chained audit entry for a
// receiver-auth staff action, resolving the parcel's id so the target
// matches every other parcel audit row (which key on the uuid, not the
// tracking code).
func (s *Server) auditParcelByCode(c *gin.Context, code, action string, payload map[string]interface{}) {
	ctx := ctxFromGin(c)
	var parcelID string
	if err := s.Pool.QueryRow(c.Request.Context(),
		`SELECT id FROM parcel WHERE code = $1`, code).Scan(&parcelID); err != nil {
		return
	}
	var actorID *string
	if ctx.ActorID != "" {
		actorID = &ctx.ActorID
	}
	var ip *string
	if v := clientIP(c); v != "" {
		ip = &v
	}
	targetType := "parcel"
	_, _ = audit.RecordAudit(c.Request.Context(), s.Pool, s.Cfg.AuditChainSeed,
		audit.CtxLike{ActorType: string(ctx.ActorType), ActorID: actorID, IP: ip},
		audit.Input{
			Action:     action,
			TargetType: &targetType,
			TargetID:   &parcelID,
			Payload:    payload,
		})
}

// ── Esoqo admin, keyed on the parcel uuid ────────────────────────────
//
// A superset of the company routes above: admin can resolve a stuck
// parcel for any carrier, including Esoqo-operated ones that have no
// company console to act from. Same dbx calls, different addressing —
// the admin console works in parcel ids throughout, so these take :id
// and resolve the code rather than making the console carry both.

func (s *Server) adminParcelCode(c *gin.Context) (string, bool) {
	var code string
	err := s.Pool.QueryRow(c.Request.Context(),
		`SELECT code FROM parcel WHERE id = $1`, c.Param("id")).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "That parcel was not found")
		return "", false
	}
	if err != nil {
		writeError(c, http.StatusInternalServerError, "LOOKUP_FAILED", "Could not load that parcel")
		return "", false
	}
	return code, true
}

func (s *Server) handleAdminGrantReceiverAuthRetry(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.assign", nil); err != nil {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "You can't manage parcels")
		return
	}
	code, ok := s.adminParcelCode(c)
	if !ok {
		return
	}
	if err := dbx.GrantReceiverAuthRetry(c.Request.Context(), s.Pool, code, ctx.PartyID); err != nil {
		writeParcelError(c, err)
		return
	}
	s.auditParcelByCode(c, code, "parcel.receiver_auth_retry_granted", nil)
	c.JSON(http.StatusOK, gin.H{"granted": dbx.ReceiverAuthExtraAttempts})
}

func (s *Server) handleAdminReissueDeliveryCode(c *gin.Context) {
	ctx := ctxFromGin(c)
	// parcels.override, not parcels.assign: minting a replacement for a
	// credential is the same weight of decision as waving a hand-over
	// through without one, and is gated to match.
	if err := authsvc.RequireCapability(ctx, "parcels.override", nil); err != nil {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "You can't issue delivery codes")
		return
	}
	code, ok := s.adminParcelCode(c)
	if !ok {
		return
	}
	newCode, err := dbx.ReissueDeliveryCode(c.Request.Context(), s.Pool, code, ctx.PartyID)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	s.auditParcelByCode(c, code, "parcel.delivery_code_reissued", nil)
	s.sendReissuedCode(c, code, newCode)
	c.JSON(http.StatusOK, gin.H{"reissued": true})
}

func (s *Server) handleAdminReleaseHeldEarnings(c *gin.Context) {
	ctx := ctxFromGin(c)
	if err := authsvc.RequireCapability(ctx, "parcels.override", nil); err != nil {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "You can't release held earnings")
		return
	}
	code, ok := s.adminParcelCode(c)
	if !ok {
		return
	}
	if err := dbx.ReleaseHeldCourierEarnings(c.Request.Context(), s.Pool, code, ctx.PartyID); err != nil {
		writeParcelError(c, err)
		return
	}
	s.auditParcelByCode(c, code, "parcel.courier_earnings_released", nil)
	c.JSON(http.StatusOK, gin.H{"released": true})
}
