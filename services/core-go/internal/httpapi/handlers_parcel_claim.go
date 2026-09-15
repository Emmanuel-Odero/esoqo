package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
)

// isOtpError — an OTP-service failure is the caller's own business
// (they hit a rate limit, the number is not sendable) and says nothing
// about the parcel, so unlike everything else here it can be reported
// honestly without breaking the uniform-response rule.
func isOtpError(err error) bool {
	_, ok := err.(*authsvc.OtpError)
	return ok
}

// Letting the sender and receiver of a parcel see more than a stranger
// holding the same code.
//
// GET /v1/parcels/:code/status stays exactly as public and as
// PII-minimal as it was — a tracking code rides in the open on a box
// and must never be enough to unlock a name and an address. These two
// routes are the way past that, and the way past is proving you hold
// the phone, not proving you hold the code.

type parcelClaimOtpRequest struct {
	Msisdn string `json:"msisdn" binding:"required"`
}

// handleRequestParcelClaimOtp — POST /v1/parcels/:code/claim/otp.
//
// Always answers the same way. Whether the parcel exists, whether the
// number is a party to it, and whether a code was actually sent are all
// indistinguishable from the response — otherwise anyone who found a
// box could use this to test which numbers are connected to it, which
// is exactly the linkage the whole tiering exists to prevent.
//
// Rate-limited per IP at the route, because a uniform response is not
// by itself a defence against someone working through a phone book.
func (s *Server) handleRequestParcelClaimOtp(c *gin.Context) {
	var req parcelClaimOtpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := dbx.RequestParcelClaimOtp(
		c.Request.Context(), s.Pool, s.OTP, c.Param("code"), req.Msisdn, clientIP(c),
	); err != nil {
		// An OTP-service failure (rate limit, spend cap, bad prefix) is
		// the caller's own business and safe to report — it says nothing
		// about the parcel. Anything else is ours, and is swallowed into
		// the same uniform success the non-matching path returns.
		if isOtpError(err) {
			writeOtpError(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"sent": true,
		"hint": "If that number is on this parcel, a code has been sent to it.",
	})
}

type parcelClaimVerifyRequest struct {
	Msisdn string `json:"msisdn" binding:"required"`
	Code   string `json:"code" binding:"required"`
}

// handleVerifyParcelClaim — POST /v1/parcels/:code/claim/verify.
//
// On success returns the tier-appropriate projection directly rather
// than a token the client must then spend: one round trip, and nothing
// long-lived minted for a page the caller may simply close. A caller
// who comes back later re-verifies, which is the honest cost of not
// leaving a bearer credential to somebody's address lying in a browser.
func (s *Server) handleVerifyParcelClaim(c *gin.Context) {
	var req parcelClaimVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	code := c.Param("code")
	tier, err := dbx.VerifyParcelClaim(c.Request.Context(), s.Pool, s.OTP, code, req.Msisdn, req.Code)
	if err != nil {
		if isOtpError(err) {
			writeOtpError(c, err)
			return
		}
		writeParcelError(c, err)
		return
	}
	view, err := dbx.GetParcelPartyView(c.Request.Context(), s.Pool, code, tier)
	if err != nil {
		writeParcelError(c, err)
		return
	}
	c.JSON(http.StatusOK, view)
}
