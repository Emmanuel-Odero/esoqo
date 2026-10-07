package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/payments"
)

// coopPollGap bounds how often one payment key may hit Co-op. The parcel
// status endpoint is unauthenticated and polled by clients every couple of
// seconds; without this every viewer of a tracking page is a bank API call.
const coopPollGap = 3 * time.Second

var coopLastPoll sync.Map // checkout ref -> time.Time

func coopPollDue(ref string) bool {
	now := time.Now()
	if v, ok := coopLastPoll.Load(ref); ok && now.Sub(v.(time.Time)) < coopPollGap {
		return false
	}
	coopLastPoll.Store(ref, now)
	return true
}

// settleCoopParcel asks Co-op what became of a push and acts on the answer.
// The enquiry response — not any callback body — is the only evidence used.
//
//	SUCCESS → amount must equal the parcel price exactly, then book it
//	FAILED  → free the slot so the sender can retry
//	PENDING → do nothing; the next poll or callback asks again
func (s *Server) settleCoopParcel(c *gin.Context, ref string) {
	ctx := c.Request.Context()
	st := payments.CoopQueryStkStatus(s.Cfg, ref)
	switch st.State {
	case payments.CoopStkFailed:
		if err := dbx.ReleaseParcelPaymentByCheckoutID(ctx, s.Pool, ref); err != nil {
			log.Printf("coop: releasing failed payment %s: %v", ref, err)
		}
	case payments.CoopStkSuccess:
		expected, err := dbx.ExpectedAmountForCheckout(ctx, s.Pool, ref)
		if err != nil {
			log.Printf("coop: success for unknown reference %s: %v", ref, err)
			return
		}
		if !st.AmountSet || money.FromKES(st.AmountKES) != money.FromKES(expected) {
			log.Printf("coop: %s amount mismatch (paid %.2f set=%v, expected %.2f) — not confirming",
				ref, st.AmountKES, st.AmountSet, expected)
			return
		}
		if _, _, err := dbx.ConfirmParcelPaymentByCheckoutID(ctx, s.Pool, ref, st.Receipt, s.Cfg.LoyaltyEarnEnabled); err != nil &&
			err != dbx.ErrParcelPaymentNotFound {
			log.Printf("coop: confirming parcel payment %s: %v", ref, err)
		}
	}
}

// settleCoopForParcelCode runs settleCoopParcel for a parcel that is mid
// Co-op payment, called from the status poll. Silent no-op for anything else.
func (s *Server) settleCoopForParcelCode(c *gin.Context, code string) {
	if !payments.CoopEnabled(s.Cfg) {
		return
	}
	ref, err := dbx.PendingParcelCheckoutID(c.Request.Context(), s.Pool, code)
	if err != nil || ref == "" || !payments.IsCoopRef(ref) || !coopPollDue(ref) {
		return
	}
	s.settleCoopParcel(c, ref)
}

// handleCoopCallback — POST /webhooks/coop/callback/:token. Co-op posts here
// when a push resolves. Nothing in the body is believed: the only thing read
// from it is the MessageReference, used to decide which payment to re-query.
// Always 200 so Co-op does not retry into a loop.
func (s *Server) handleCoopCallback(c *gin.Context) {
	if s.Cfg.CoopCallbackSecret == "" ||
		subtle.ConstantTimeCompare([]byte(c.Param("token")), []byte(s.Cfg.CoopCallbackSecret)) != 1 {
		log.Printf("core-go: rejected coop callback with bad/missing token from %s", c.ClientIP())
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	raw, err := c.GetRawData()
	if err == nil {
		var body struct {
			MessageReference string `json:"MessageReference"`
		}
		if json.Unmarshal(raw, &body) == nil && payments.IsCoopRef(body.MessageReference) {
			s.settleCoopParcel(c, body.MessageReference)
		} else if json.Unmarshal(raw, &body) == nil && payments.IsCoopPayoutRef(body.MessageReference) {
			s.settleCoopPayoutByRef(c, body.MessageReference)
		} else {
			log.Printf("coop callback with no usable MessageReference: %.300s", string(raw))
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
