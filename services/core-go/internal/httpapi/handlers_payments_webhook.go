package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/payments"
)

// handleMpesaStkCallback mirrors services/core/src/index.ts's
// POST /webhooks/mpesa/stk-callback: parse once, try each domain's
// confirm function in turn, only fall through to the next on a
// "not found for this checkout id" result — and always reply 200,
// since Safaricom retries on anything else, which would just replay a
// callback that's already been handled or genuinely doesn't belong to
// this service (e.g. a registration/donation payment, still TS-only).
func (s *Server) handleMpesaStkCallback(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true}) // malformed body — nothing to retry into
		return
	}

	cb := payments.ParseStkCallback(body)
	if cb == nil || !cb.Succeeded {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	ctx := c.Request.Context()

	if err := dbx.ConfirmStoreOrderPaymentByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrOrderNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	if err := dbx.ConfirmBookingPaymentByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrBookingNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	// Chama contributions paid by STK — this was a known gap noted when
	// the webhook was first ported (see the Phase 0 commit): only store
	// orders and bookings were dispatched here, never contributions.
	if err := dbx.ConfirmContributionByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, cb.MpesaReceiptCode); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrContributionNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	// Belongs to no domain core-go owns yet (registration/donation
	// payments — still TS-only) — not an error here.
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
