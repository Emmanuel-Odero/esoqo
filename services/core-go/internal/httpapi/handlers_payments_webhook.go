package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoko/core-go/internal/dbx"
	"github.com/esoko/core-go/internal/payments"
)

// handleMpesaStkCallback is now the canonical Daraja target (see
// render.yaml's MPESA_CALLBACK_URL): parse once, try each Go-owned
// domain in turn, only falling through on "not found for this checkout
// id". Anything left (registration/donation — still TS-only) is
// forwarded to the TS core webhook when TS_CORE_WEBHOOK_URL is set.
// Always replies 200 — Safaricom retries on anything else, which would
// just replay an already-handled or foreign callback. Every confirm
// below is idempotent, so a callback seen by both services (during the
// transition both URLs may be live) can never double-post.
func (s *Server) handleMpesaStkCallback(c *gin.Context) {
	// Raw bytes are kept so an unowned callback can be forwarded
	// byte-identical to the TS webhook below (signature-safe).
	raw, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true}) // malformed body — nothing to retry into
		return
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	cb := payments.ParseStkCallback(body)
	if cb == nil || !cb.Succeeded {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	ctx := c.Request.Context()

	if err := dbx.ConfirmStoreOrderPaymentByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, s.Cfg.LoyaltyEarnEnabled); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrOrderNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	// Installment deposit/top-up/balance first (TS confirmBookingPayment
	// checks BookingPayment before Booking — same order here so a plan
	// payment never falls through to the plain-booking lookup).
	if err := dbx.ConfirmInstallmentPaymentByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, cb.MpesaReceiptCode); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrBookingPaymentNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	if err := dbx.ConfirmBookingPaymentByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, s.Cfg.LoyaltyEarnEnabled); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrBookingNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	// Chama contributions paid by STK — this was a known gap noted when
	// the webhook was first ported (see the Phase 0 commit): only store
	// orders and bookings were dispatched here, never contributions.
	if contributionID, alreadyConfirmed, err := dbx.ConfirmContributionByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, cb.MpesaReceiptCode); err == nil {
		if !alreadyConfirmed {
			s.notifyContributionConfirmed(c, contributionID)
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrContributionNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	if err := dbx.ConfirmFarePaymentByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, cb.MpesaReceiptCode, s.Cfg.LoyaltyEarnEnabled); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrFareNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	if err := dbx.ConfirmVoucherLoadByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, cb.MpesaReceiptCode, s.Cfg.LoyaltyEarnEnabled); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrVoucherLoadNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	// Belongs to no Go-owned domain (registration/donation payments —
	// still TS-only): forward byte-identical to the TS core webhook when
	// configured, else ack. Never an error here either way.
	if s.Cfg.TsCoreWebhookURL != "" && len(raw) > 0 {
		forwardToTsWebhook(s.Cfg.TsCoreWebhookURL, raw)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// forwardToTsWebhook hands a foreign callback to services/core,
// best-effort with a short timeout. Fire-and-forget by design: the
// caller always 200s to Safaricom, and TS's own confirm path is
// idempotent, so a duplicated delivery cannot double-post.
func forwardToTsWebhook(baseURL string, raw []byte) {
	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequest("POST", baseURL+"/webhooks/mpesa/stk-callback", bytes.NewReader(raw))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}
