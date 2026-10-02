package httpapi

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// ── POST /v1/auth/otp ──────────────────────────────────────────────

type issueOtpRequest struct {
	Msisdn  string `json:"msisdn" binding:"required"`
	Purpose string `json:"purpose" binding:"required"`
}

func (s *Server) handleIssueOtp(c *gin.Context) {
	var req issueOtpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.Msisdn, "That phone number") {
		return
	}

	purpose := authsvc.OtpPurpose(req.Purpose)
	if !authsvc.IsPublicOtpPurpose(purpose) {
		writeError(c, http.StatusBadRequest, "INVALID_PURPOSE", "Unsupported verification purpose")
		return
	}

	// A PIN reset is only meaningful for a number that already holds an
	// account, and sending to any other number is pure SMS spend in an
	// attacker's pocket. So resolve the account first and, when there
	// isn't one, answer exactly as if a code had gone out — no message is
	// sent, and the response stays indistinguishable from the sent path so
	// this cannot be used to enumerate which numbers are registered.
	//
	// This is the check the TypeScript issueOtp callers used to make
	// before the core-go migration (see apps/jamii's actionRequestPinCode)
	// and the one that closes the SMS-pumping hole in this endpoint.
	if purpose == authsvc.OtpPinReset {
		person, err := dbx.FindPersonByMsisdn(c.Request.Context(), s.Pool, req.Msisdn)
		if err != nil {
			log.Printf("otp request: pin-reset account lookup failed: %v", err)
			writeError(c, http.StatusInternalServerError, "OTP_FAILED", "Could not process that request")
			return
		}
		if person == nil {
			log.Printf("otp request: pin-reset for unregistered number suppressed")
			c.JSON(http.StatusOK, gin.H{
				"expiresAt":       time.Now().Add(authsvc.OtpTTL),
				"cooldownSeconds": 30,
			})
			return
		}
	}

	result, err := s.OTP.IssueOtp(c.Request.Context(), req.Msisdn, purpose, clientIP(c))
	if err != nil {
		writeOtpError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"expiresAt": result.ExpiresAt, "cooldownSeconds": result.CooldownSeconds})
}

// ── POST /v1/auth/verify-otp ───────────────────────────────────────

type verifyOtpRequest struct {
	Msisdn  string `json:"msisdn" binding:"required"`
	Purpose string `json:"purpose" binding:"required"`
	Code    string `json:"code" binding:"required"`
}

// handleVerifyOtp is Phase 0's combined verify+sign-in: a correct code
// proves control of the number, so it both confirms msisdnVerifiedAt and
// issues a session directly — first-time numbers are provisioned a bare
// Party+Person here (see dbx.FindOrCreatePersonByMsisdn's own caveat
// about the placeholder county value) and prompted to set a PIN
// afterwards via /v1/auth/set-pin for faster subsequent sign-ins.
func (s *Server) handleVerifyOtp(c *gin.Context) {
	var req verifyOtpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.Msisdn, "That phone number") {
		return
	}

	ok, err := s.OTP.VerifyOtp(c.Request.Context(), req.Msisdn, authsvc.OtpPurpose(req.Purpose), req.Code)
	if err != nil {
		writeOtpError(c, err)
		return
	}
	if !ok {
		writeError(c, http.StatusUnauthorized, "WRONG_CODE", "That code is not right")
		return
	}

	partyID, err := dbx.FindOrCreatePersonByMsisdn(c.Request.Context(), s.Pool, req.Msisdn)
	if err != nil {
		log.Printf("otp verify: person lookup/create failed for %s: %v", req.Msisdn, err)
		writeError(c, http.StatusInternalServerError, "PERSON_LOOKUP_FAILED", "Could not complete sign-in")
		return
	}
	if err := dbx.MarkMsisdnVerified(c.Request.Context(), s.Pool, partyID); err != nil {
		log.Printf("otp verify: mark msisdn verified failed for %s: %v", partyID, err)
		writeError(c, http.StatusInternalServerError, "PERSON_LOOKUP_FAILED", "Could not complete sign-in")
		return
	}

	token, err := s.issueSubjectSession(c, partyID)
	if err != nil {
		log.Printf("otp verify: session issue failed for %s: %v", partyID, err)
		writeError(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "Could not start a session")
		return
	}

	person, _ := dbx.FindPersonByMsisdn(c.Request.Context(), s.Pool, req.Msisdn)
	hasPinSet := person != nil && person.PinHash != nil

	c.JSON(http.StatusOK, gin.H{"token": token, "hasPinSet": hasPinSet})
}

// ── POST /v1/auth/sign-in (returning users with a PIN already set) ───

// signInRequest accepts phone (E.164) or email — same "identifier" shape
// as the web sign-in form (packages/domain/src/auth.ts's signInSchema),
// so apps/app/apps/store/apps/jamii's identical sign-in Server Actions
// can all call this one endpoint instead of their own copy of
// findSubjectCredential/recordSignInSuccess/recordSignInFailure.
type signInRequest struct {
	Identifier string `json:"identifier" binding:"required"`
	Pin        string `json:"pin" binding:"required"`
}

func (s *Server) handleSignIn(c *gin.Context) {
	var req signInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	person, err := dbx.FindPersonByIdentifier(c.Request.Context(), s.Pool, req.Identifier)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SIGN_IN_FAILED", "Could not sign in")
		return
	}

	if person != nil && person.FrozenAt != nil {
		writeError(c, http.StatusForbidden, "ACCOUNT_FROZEN", "This account is frozen. Contact Esoqo to unfreeze it.")
		return
	}

	// Anti-enumeration: verify against DummyPinHash on a failed lookup so
	// "no such account" and "wrong PIN" take the same code path and the
	// same wall-clock time, exactly like packages/auth/src/pin.ts's
	// DUMMY_PIN_HASH contract.
	storedHash := authsvc.DummyPinHash
	locked := false
	if person != nil {
		if person.LockedUntil != nil && person.LockedUntil.After(time.Now()) {
			locked = true
		}
		if person.PinHash != nil {
			storedHash = *person.PinHash
		}
	}

	pinOK := authsvc.VerifyPin(req.Pin, storedHash)
	if person == nil || person.PinHash == nil || locked || !pinOK {
		if person != nil && person.PinHash != nil && !locked {
			_ = dbx.RecordSignInFailure(c.Request.Context(), s.Pool, person.PartyID)
		}
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "No account found, or a PIN has not been set yet.")
		return
	}

	_ = dbx.RecordSignInSuccess(c.Request.Context(), s.Pool, person.PartyID)

	token, err := s.issueSubjectSession(c, person.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "Could not start a session")
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token})
}

// ── POST /v1/auth/pin/reset (unauthenticated — proof is the OTP code) ─

// resetPinRequest is the "forgot PIN" flow: request an OTP via
// POST /v1/auth/otp {msisdn, purpose:"PIN_RESET"} first, then call this
// with the code. Unlike verify-otp's SIGN_IN path, this never
// auto-provisions a Person — same NOT_FOUND contract as
// auth-credential.ts's setSubjectPin.
type resetPinRequest struct {
	Msisdn string `json:"msisdn" binding:"required"`
	Code   string `json:"code" binding:"required"`
	Pin    string `json:"pin" binding:"required"`
}

func (s *Server) handleResetPin(c *gin.Context) {
	var req resetPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !requireMsisdn(c, &req.Msisdn, "That phone number") {
		return
	}
	if authsvc.IsWeakPin(req.Pin) {
		writeError(c, http.StatusBadRequest, "WEAK_PIN", "Choose a less predictable PIN — not 1234, 0000 or a run of digits.")
		return
	}

	ok, err := s.OTP.VerifyOtp(c.Request.Context(), req.Msisdn, authsvc.OtpPinReset, req.Code)
	if err != nil {
		writeOtpError(c, err)
		return
	}
	if !ok {
		writeError(c, http.StatusUnauthorized, "WRONG_CODE", "That code is not right")
		return
	}

	hash, err := authsvc.HashPin(req.Pin)
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_PIN", err.Error())
		return
	}
	partyID, err := dbx.SetSubjectPinByMsisdn(c.Request.Context(), s.Pool, req.Msisdn, hash)
	if err != nil {
		if err == dbx.ErrPersonNotFound {
			writeError(c, http.StatusNotFound, "NOT_FOUND", "No Esoqo account found with that number")
			return
		}
		writeError(c, http.StatusInternalServerError, "SET_PIN_FAILED", "Could not save PIN")
		return
	}

	token, err := s.issueSubjectSession(c, partyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "Could not start a session")
		return
	}
	c.JSON(http.StatusOK, gin.H{"token": token})
}

// ── POST /v1/auth/set-pin (authenticated) ─────────────────────────────

type setPinRequest struct {
	Pin string `json:"pin" binding:"required"`
}

func (s *Server) handleSetPin(c *gin.Context) {
	ctx := ctxFromGin(c)

	var req setPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if len(req.Pin) < 4 || len(req.Pin) > 6 {
		writeError(c, http.StatusBadRequest, "INVALID_PIN", "PIN must be 4 to 6 digits")
		return
	}
	if authsvc.IsWeakPin(req.Pin) {
		writeError(c, http.StatusBadRequest, "WEAK_PIN", "Choose a less guessable PIN")
		return
	}

	hash, err := authsvc.HashPin(req.Pin)
	if err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_PIN", err.Error())
		return
	}
	if err := dbx.UpsertPin(c.Request.Context(), s.Pool, ctx.PartyID, hash); err != nil {
		writeError(c, http.StatusInternalServerError, "SET_PIN_FAILED", "Could not save PIN")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── POST /v1/auth/sign-out (authenticated) ─────────────────────────

func (s *Server) handleSignOut(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	token := authHeader
	if len(token) > 7 && token[:7] == "Bearer " {
		token = token[7:]
	}
	if err := s.Session.DestroySession(c.Request.Context(), token); err != nil {
		writeError(c, http.StatusInternalServerError, "SIGN_OUT_FAILED", "Could not sign out")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── GET /v1/me (authenticated) ────────────────────────────────────

func (s *Server) handleMe(c *gin.Context) {
	ctx := ctxFromGin(c)
	profile, err := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil || profile == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Profile not found")
		return
	}

	// Lazily provisions a name-derived esoqo handle the first time a
	// profile is fetched — every account gets one, without a separate
	// "activate" step, since core-go already verified the phone via OTP
	// before this session existed. See dbx.EnsureEsoqoPaymentId.
	var esoqoID string
	if profile.Msisdn != nil {
		esoqoID, err = dbx.EnsureEsoqoPaymentId(c.Request.Context(), s.Pool, profile.PartyID, *profile.Msisdn)
		if err != nil {
			writeError(c, http.StatusInternalServerError, "PAYMENT_ID_FAILED", "Could not prepare your Esoqo ID")
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"partyId":      profile.PartyID,
		"esoqoId":      esoqoID,
		"officialName": profile.OfficialName,
		"knownAs":      profile.KnownAs,
		"msisdn":       profile.Msisdn,
		"capabilities": ctx.Capabilities,
	})
}

// ── PATCH /v1/me (authenticated) ────────────────────────────────
// Edits the caller's own display name. Self-scoped: the party comes
// from the session, never the body, so there is nothing to forge.

type updateMeRequest struct {
	KnownAs *string `json:"knownAs"`
}

func (s *Server) handleUpdateMe(c *gin.Context) {
	ctx := ctxFromGin(c)
	var req updateMeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if req.KnownAs == nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Nothing to update")
		return
	}
	if err := dbx.UpdateKnownAs(c.Request.Context(), s.Pool, ctx.PartyID, *req.KnownAs); err != nil {
		if err == dbx.ErrPersonNotFound {
			writeError(c, http.StatusNotFound, "NOT_FOUND", "Profile not found")
			return
		}
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── GET /v1/me/history (authenticated) ────────────────────────────

func (s *Server) handleHistory(c *gin.Context) {
	ctx := ctxFromGin(c)
	items, err := dbx.GetHistory(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "HISTORY_FAILED", "Could not load your history")
		return
	}
	out := make([]gin.H, 0, len(items))
	for _, it := range items {
		out = append(out, gin.H{
			"kind":       it.Kind,
			"id":         it.ID,
			"title":      it.Title,
			"status":     it.Status,
			"totalKes":   it.TotalKES,
			"occurredAt": it.OccurredAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

// ── GET /v1/me/points (authenticated) ─────────────────────────────

func (s *Server) handlePoints(c *gin.Context) {
	ctx := ctxFromGin(c)
	profile, err := dbx.GetPersonProfile(c.Request.Context(), s.Pool, ctx.PartyID)
	if err != nil || profile == nil {
		writeError(c, http.StatusNotFound, "NOT_FOUND", "Profile not found")
		return
	}
	msisdn := ""
	if profile.Msisdn != nil {
		msisdn = *profile.Msisdn
	}
	pts, err := dbx.GetPoints(c.Request.Context(), s.Pool, ctx.PartyID, msisdn)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "POINTS_FAILED", "Could not load your points")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"storePoints":  pts.StorePoints,
		"ticketPoints": pts.TicketPoints,
		"totalPoints":  pts.Total(),
	})
}

// ── shared helpers ─────────────────────────────────────────────────

func (s *Server) issueSubjectSession(c *gin.Context, partyID string) (string, error) {
	return s.Session.CreateSession(c.Request.Context(), authsvc.SessionData{
		ActorType:    authsvc.ActorSubject,
		ActorID:      partyID,
		PartyID:      partyID,
		Capabilities: authsvc.CapabilitiesForRole(authsvc.RoleSubject),
	}, authsvc.SessionTTL)
}

func writeOtpError(c *gin.Context, err error) {
	if otpErr, ok := err.(*authsvc.OtpError); ok {
		status := http.StatusBadRequest
		switch otpErr.Code {
		case authsvc.OtpRateLimited, authsvc.OtpSpendCap:
			status = http.StatusTooManyRequests
		case authsvc.OtpTooManyAttempts, authsvc.OtpWrongCode, authsvc.OtpExpired:
			status = http.StatusUnauthorized
		}
		writeError(c, status, string(otpErr.Code), otpErr.Message)
		return
	}
	log.Printf("otp request failed: %v", err)
	writeError(c, http.StatusInternalServerError, "OTP_FAILED", "Could not process that request")
}
