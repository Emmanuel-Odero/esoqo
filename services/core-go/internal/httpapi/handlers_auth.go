package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/dbx"
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

	result, err := s.OTP.IssueOtp(c.Request.Context(), req.Msisdn, authsvc.OtpPurpose(req.Purpose), clientIP(c))
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
		writeError(c, http.StatusInternalServerError, "PERSON_LOOKUP_FAILED", "Could not complete sign-in")
		return
	}
	if err := dbx.MarkMsisdnVerified(c.Request.Context(), s.Pool, partyID); err != nil {
		writeError(c, http.StatusInternalServerError, "PERSON_LOOKUP_FAILED", "Could not complete sign-in")
		return
	}

	token, err := s.issueSubjectSession(c, partyID)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "Could not start a session")
		return
	}

	person, _ := dbx.FindPersonByMsisdn(c.Request.Context(), s.Pool, req.Msisdn)
	hasPinSet := person != nil && person.PinHash != nil

	c.JSON(http.StatusOK, gin.H{"token": token, "hasPinSet": hasPinSet})
}

// ── POST /v1/auth/sign-in (returning users with a PIN already set) ───

type signInRequest struct {
	Msisdn string `json:"msisdn" binding:"required"`
	Pin    string `json:"pin" binding:"required"`
}

func (s *Server) handleSignIn(c *gin.Context) {
	var req signInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	person, err := dbx.FindPersonByMsisdn(c.Request.Context(), s.Pool, req.Msisdn)
	if err != nil {
		writeError(c, http.StatusInternalServerError, "SIGN_IN_FAILED", "Could not sign in")
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
		writeError(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Phone number or PIN is not right")
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
	c.JSON(http.StatusOK, gin.H{
		"partyId":      profile.PartyID,
		"officialName": profile.OfficialName,
		"knownAs":      profile.KnownAs,
		"msisdn":       profile.Msisdn,
		"capabilities": ctx.Capabilities,
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
	writeError(c, http.StatusInternalServerError, "OTP_FAILED", "Could not process that request")
}
