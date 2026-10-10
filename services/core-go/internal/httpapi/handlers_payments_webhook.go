package httpapi

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/payments"
)

// handleMpesaStkCallback is now the canonical Daraja target (see
// the MPESA_CALLBACK_URL env var): parse once, try each Go-owned
// domain in turn, only falling through on "not found for this checkout
// id". Anything left (registration/donation — still TS-only) is
// forwarded to the TS core webhook when TS_CORE_WEBHOOK_URL is set.
// Always replies 200 — Safaricom retries on anything else, which would
// just replay an already-handled or foreign callback. Every confirm
// below is idempotent, so a callback seen by both services (during the
// transition both URLs may be live) can never double-post.
func (s *Server) handleMpesaStkCallback(c *gin.Context) {
	if !s.callbackTokenOK(c.Param("token")) {
		// Deliberately not 200: this is not Safaricom, so there is no
		// retry to suppress, and a forged confirm must never be told it
		// looked plausible.
		log.Printf("core-go: rejected mpesa callback with bad/missing token from %s", c.ClientIP())
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

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
	ctx := c.Request.Context()
	if cb != nil && !cb.Succeeded && cb.CheckoutRequestID != "" {
		// Cancelled, wrong PIN, timed out, insufficient funds: final for a
		// Daraja push. Free a parcel's payment slot (booking or counter) so
		// the payer can be prompted again — before, a declined prompt left
		// the parcel "payment in progress" for ever. Other domains don't
		// hold a slot this way; the update only ever matches a parcel row.
		if err := dbx.ReleaseParcelPaymentByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID); err != nil {
			log.Printf("core-go: releasing declined parcel push %s: %v", cb.CheckoutRequestID, err)
		}
	}
	if cb == nil || !cb.Succeeded {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	// Second control, independent of the secret path: the amount paid
	// must match what the pending row was raised for. ErrCheckoutUnknown
	// falls through untouched — that is the foreign-callback case the
	// dispatch below already handles by forwarding to TS.
	if expected, err := dbx.ExpectedAmountForCheckout(ctx, s.Pool, cb.CheckoutRequestID); err == nil {
		if !cb.AmountPresent {
			log.Printf("core-go: mpesa callback %s carried no Amount; refusing to confirm %.2f", cb.CheckoutRequestID, expected)
			c.JSON(http.StatusOK, gin.H{"ok": true})
			return
		}
		// Compared as exact cents. This is the check that decides whether
		// a real M-Pesa payment is accepted as matching what was asked
		// for, so "equal" has to mean equal: Daraja reports KES to 2dp,
		// both sides round to the same cent, and a float tolerance here
		// was only ever covering for the comparison's own imprecision.
		if money.FromKES(cb.Amount) != money.FromKES(expected) {
			log.Printf("core-go: mpesa callback %s amount mismatch (paid %.2f, expected %.2f) — not confirming",
				cb.CheckoutRequestID, cb.Amount, expected)
			c.JSON(http.StatusOK, gin.H{"ok": true})
			return
		}
	} else if err != dbx.ErrCheckoutUnknown {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

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

	// A courier company's own bus ticket(s), paid by STK on the public
	// web booking flow (counter bus sales are CASH, settled inline).
	// One checkout can cover several seats, so dispatch a payout for
	// each.
	if bookingIDs, justConfirmed, err := dbx.ConfirmBusBookingByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID); err == nil {
		if justConfirmed {
			for _, id := range bookingIDs {
				s.dispatchParcelOrgPayoutForBusBooking(id)
			}
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrBusBookingNotFound {
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

	// justConfirmed no longer triggers an SMS — payment clearing async
	// still isn't a courier's hand on the parcel; see
	// handleScanParcelHandoff's own comment on why that's the only
	// event that ever texts a sender or receiver.
	if _, parcelID, _, err := dbx.ConfirmParcelPaymentByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, cb.MpesaReceiptCode, s.Cfg.LoyaltyEarnEnabled); err == nil {
		s.dispatchParcelOrgPayoutForParcel(parcelID)
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrParcelPaymentNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	// Counter settlement paid by M-Pesa (handleSettleCounterParcelStk) —
	// a different flow from the booking-STK confirm above, disambiguated
	// by paymentMethod so the two can share paymentCheckoutRequestId
	// without either one swallowing the other's callback.
	if parcelID, justConfirmed, err := dbx.ConfirmCounterSettlementByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, cb.MpesaReceiptCode); err == nil {
		s.dispatchParcelOrgPayoutForParcel(parcelID)
		if justConfirmed {
			if code, cerr := dbx.GetParcelCode(ctx, s.Pool, parcelID); cerr == nil && code != "" {
				s.sendCounterPaymentConfirmedSms(c.Request.Context(), code)
			}
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrCounterSettlementNotFound {
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

	if load, err := dbx.ConfirmVoucherLoadByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, cb.MpesaReceiptCode, s.Cfg.LoyaltyEarnEnabled); err == nil {
		if !load.AlreadyDone {
			// The async half of the same event handleLoadVoucher
			// notifies inline: a top-up whose STK push wasn't
			// auto-confirmed inside the client's poll window used to
			// land in silence, so the cardholder's money arrived with
			// nothing at all to say so.
			s.sendVoucherLoadedSms(c, load, "M-Pesa")
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrVoucherLoadNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	if _, _, err := dbx.ConfirmVoucherBatchByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID, cb.MpesaReceiptCode); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrVoucherBatchNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	if _, _, err := dbx.ConfirmBillContributionByCheckoutID(ctx, s.Pool, cb.CheckoutRequestID); err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	} else if err != dbx.ErrBillContributionNotFound {
		writeError(c, http.StatusInternalServerError, "CONFIRM_FAILED", "Could not confirm payment")
		return
	}

	// Belongs to no Go-owned domain (registration/donation payments —
	// still TS-only): forward byte-identical to the TS core webhook when
	// configured, else ack. Never an error here either way.
	if s.Cfg.TsCoreWebhookURL != "" && len(raw) > 0 {
		forwardToTsWebhook(s.Cfg.TsCoreWebhookURL, s.Cfg.MpesaCallbackSecret, raw)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// handleMpesaB2CResultCallback / handleMpesaB2BResultCallback are the
// result side of dispatchParcelOrgPayout's B2C/B2B requests — Daraja's
// own ResultURL for each. Same token-auth and always-200 discipline as
// handleMpesaStkCallback: a forged POST gets a 404 (no Safaricom retry
// to suppress), a genuine one is acknowledged either way so Safaricom
// never retries an already-handled result.
func (s *Server) handleMpesaB2CResultCallback(c *gin.Context) {
	s.handleMpesaPayoutResultCallback(c)
}

func (s *Server) handleMpesaB2BResultCallback(c *gin.Context) {
	s.handleMpesaPayoutResultCallback(c)
}

// handleMpesaPayoutResultCallback is shared by both routes above —
// Daraja's B2C and B2B result payloads are structurally identical (see
// payments.ParseB2CResultCallback's own comment), so there is nothing
// method-specific left to branch on once the body is parsed.
func (s *Server) handleMpesaPayoutResultCallback(c *gin.Context) {
	if !s.callbackTokenOK(c.Param("token")) {
		log.Printf("core-go: rejected mpesa payout result callback with bad/missing token from %s", c.ClientIP())
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	raw, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	cb := payments.ParseB2CResultCallback(body)
	if cb == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	ctx := c.Request.Context()
	if cb.Succeeded {
		if err := dbx.ConfirmParcelOrgPayoutByConversationID(ctx, s.Pool, cb.ConversationID, cb.MpesaTransactionID); err != nil && err != dbx.ErrParcelOrgPayoutNotFound {
			log.Printf("core-go: could not confirm parcel org payout %s: %v", cb.ConversationID, err)
		}
	} else {
		if err := dbx.FailParcelOrgPayoutByConversationID(ctx, s.Pool, cb.ConversationID, cb.ResultDescription); err != nil && err != dbx.ErrParcelOrgPayoutNotFound {
			log.Printf("core-go: could not fail parcel org payout %s: %v", cb.ConversationID, err)
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// callbackTokenOK authenticates a callback by the secret path segment
// registered with Daraja as part of MPESA_CALLBACK_URL. When no secret
// is configured the endpoint is only reachable in console mode (config
// refuses to boot a real provider without one), so the unauthenticated
// path stays usable for local development and nothing else.
func (s *Server) callbackTokenOK(token string) bool {
	if s.Cfg.MpesaCallbackSecret == "" {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(token), []byte(s.Cfg.MpesaCallbackSecret)) == 1
}

// forwardToTsWebhook hands a foreign callback to services/core,
// best-effort with a short timeout. Fire-and-forget by design: the
// caller always 200s to Safaricom, and TS's own confirm path is
// idempotent, so a duplicated delivery cannot double-post.
//
// callbackSecret is appended as the same path segment services/core's
// own callbackTokenOk expects (MPESA_CALLBACK_SECRET is one shared
// value read by both services — see config.go). Without it, forwarding
// to a TS deployment that has the secret configured 404s silently and
// the payment is never confirmed; this used to post to the bare path.
func forwardToTsWebhook(baseURL, callbackSecret string, raw []byte) {
	client := &http.Client{Timeout: 5 * time.Second}
	path := "/webhooks/mpesa/stk-callback"
	if callbackSecret != "" {
		path += "/" + url.PathEscape(callbackSecret)
	}
	req, err := http.NewRequest("POST", baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("core-go: forward to TS webhook returned %d", resp.StatusCode)
	}
}
