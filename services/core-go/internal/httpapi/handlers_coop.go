package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/money"
	"github.com/esoqo/core-go/internal/payments"
)

const (
	// coopPollGap bounds how often one payment key may hit Co-op. The parcel
	// status endpoint is unauthenticated and polled by clients every couple
	// of seconds; without this every viewer of a tracking page is a bank API
	// call.
	coopPollGap = 3 * time.Second

	// counterPushCancelAfter: an M-Pesa prompt expires on the phone after
	// about a minute, so once this has passed it can no longer be approved
	// and freeing the slot cannot orphan a payment. Before it, a clerk who
	// cancels might watch the customer approve a prompt nobody is tracking.
	counterPushCancelAfter = 2 * time.Minute

	// coopPushExpireAfter: the reconcile sweep frees a Co-op push that is
	// still unresolved this long after it went out, so a prompt the payer
	// ignored — and that Co-op never reported as failed — doesn't leave the
	// parcel "payment in progress" for ever.
	coopPushExpireAfter = 15 * time.Minute

	// coopReconcileLockKey keeps a single replica running the sweep.
	coopReconcileLockKey int64 = 7461003
)

var (
	coopLastPoll sync.Map // checkout ref -> time.Time
	coopLastDesc sync.Map // checkout ref -> string
)

func coopPollDue(ref string) bool {
	now := time.Now()
	if v, ok := coopLastPoll.Load(ref); ok && now.Sub(v.(time.Time)) < coopPollGap {
		return false
	}
	coopLastPoll.Store(ref, now)
	return true
}

// coopSettleResult is what one enquiry found and whether the parcel row
// changed because of it (paid, or freed after a failure).
type coopSettleResult struct {
	State       payments.CoopStkState
	Description string
	Changed     bool
}

// settleCoopParcel asks Co-op what became of a push and acts on the answer.
// The enquiry response — not any callback body — is the only evidence used.
//
//	SUCCESS → amount must equal what the pending row(s) were raised for,
//	          then book it (online booking), mark it paid (counter
//	          settlement) or confirm every seat (bus booking)
//	FAILED  → free the slot so the sender/clerk/passenger can retry
//	PENDING → do nothing; the next poll, callback or sweep asks again
//
// Despite the parcel-flavoured name (kept to avoid a wide rename), this
// is the one Co-op settlement path for every domain Co-op can pay for —
// same "try each Go-owned domain in turn" shape the Daraja webhook uses.
func (s *Server) settleCoopParcel(ctx context.Context, ref string) coopSettleResult {
	st := payments.CoopQueryStkStatus(s.Cfg, ref)
	res := coopSettleResult{State: st.State, Description: st.Description}
	if st.Description != "" {
		coopLastDesc.Store(ref, st.Description)
	}
	switch st.State {
	case payments.CoopStkFailed:
		if err := dbx.ReleaseParcelPaymentByCheckoutID(ctx, s.Pool, ref); err != nil {
			log.Printf("coop: releasing failed payment %s: %v", ref, err)
			return res
		}
		if err := dbx.ReleaseBusBookingByCheckoutID(ctx, s.Pool, ref); err != nil {
			log.Printf("coop: releasing failed bus booking %s: %v", ref, err)
			return res
		}
		res.Changed = true
	case payments.CoopStkSuccess:
		expected, err := dbx.ExpectedAmountForCheckout(ctx, s.Pool, ref)
		if err != nil {
			log.Printf("coop: success for unknown reference %s: %v", ref, err)
			return res
		}
		if !st.AmountSet || money.FromKES(st.AmountKES) != money.FromKES(expected) {
			log.Printf("coop: %s amount mismatch (paid %.2f set=%v, expected %.2f) — not confirming",
				ref, st.AmountKES, st.AmountSet, expected)
			return res
		}
		// Same order as the Daraja webhook: online parcel booking first,
		// then counter settlement, then a bus booking — paymentMethod/
		// table membership keeps all three mutually exclusive.
		_, parcelID, _, err := dbx.ConfirmParcelPaymentByCheckoutID(ctx, s.Pool, ref, st.Receipt, s.Cfg.LoyaltyEarnEnabled)
		if err == nil {
			s.dispatchParcelOrgPayoutForParcel(parcelID)
			res.Changed = true
			return res
		}
		if err != dbx.ErrParcelPaymentNotFound {
			log.Printf("coop: confirming parcel payment %s: %v", ref, err)
			return res
		}
		parcelID, justConfirmed, err := dbx.ConfirmCounterSettlementByCheckoutID(ctx, s.Pool, ref, st.Receipt)
		if err == nil {
			s.dispatchParcelOrgPayoutForParcel(parcelID)
			if justConfirmed {
				if code, cerr := dbx.GetParcelCode(ctx, s.Pool, parcelID); cerr == nil && code != "" {
					s.sendCounterPaymentConfirmedSms(ctx, code)
				}
			}
			res.Changed = true
			return res
		}
		if err != dbx.ErrCounterSettlementNotFound {
			log.Printf("coop: confirming counter settlement %s: %v", ref, err)
			return res
		}
		bookingIDs, justConfirmed, err := dbx.ConfirmBusBookingByCheckoutID(ctx, s.Pool, ref)
		if err != nil {
			if err != dbx.ErrBusBookingNotFound {
				log.Printf("coop: confirming bus booking %s: %v", ref, err)
			}
			return res
		}
		if justConfirmed {
			for _, id := range bookingIDs {
				s.dispatchParcelOrgPayoutForBusBooking(id)
			}
		}
		res.Changed = true
	}
	return res
}

// settleCoopForParcelCode runs settleCoopParcel for a parcel that is mid
// Co-op payment, called from the status poll. Silent no-op for anything else.
func (s *Server) settleCoopForParcelCode(c *gin.Context, code string) {
	if !payments.CoopEnabled(s.Cfg) {
		return
	}
	ref, err := dbx.PendingParcelCheckoutID(c.Request.Context(), s.Pool, code)
	if err != nil || ref == "" || !payments.IsCoopRef(ref) {
		return
	}
	force := c.Query("force") == "1" || c.Query("check") == "1"
	if !force && !coopPollDue(ref) {
		return
	}
	if force {
		coopLastPoll.Store(ref, time.Now())
	}
	s.settleCoopParcel(c.Request.Context(), ref)
}

// settleCoopForBusBookingCode is settleCoopForParcelCode for a bus
// booking: a Co-op push has no inbound confirm we can trust, so the
// passenger's own status poll doubles as the settlement check.
func (s *Server) settleCoopForBusBookingCode(c *gin.Context, code string) {
	if !payments.CoopEnabled(s.Cfg) {
		return
	}
	ref, err := dbx.PendingBusBookingCheckoutID(c.Request.Context(), s.Pool, code)
	if err != nil || ref == "" || !payments.IsCoopRef(ref) {
		return
	}
	force := c.Query("force") == "1" || c.Query("check") == "1"
	if !force && !coopPollDue(ref) {
		return
	}
	if force {
		coopLastPoll.Store(ref, time.Now())
	}
	s.settleCoopParcel(c.Request.Context(), ref)
}

// settleCoopForCounterPush is settleCoopForParcelCode for a counter
// settlement, driven by the clerk's status poll / "check now". nil when
// there was nothing to ask Co-op (not a Co-op push, or asked too recently).
func (s *Server) settleCoopForCounterPush(ctx context.Context, push *dbx.PendingCounterPush, force bool) *coopSettleResult {
	if push == nil || !payments.CoopEnabled(s.Cfg) || !payments.IsCoopRef(push.Ref) {
		return nil
	}
	if !force && !coopPollDue(push.Ref) {
		if v, ok := coopLastDesc.Load(push.Ref); ok {
			return &coopSettleResult{State: payments.CoopStkPending, Description: v.(string)}
		}
		return nil
	}
	if force {
		coopLastPoll.Store(push.Ref, time.Now())
	}
	res := s.settleCoopParcel(ctx, push.Ref)
	return &res
}

// counterCancelableIn is how long until a prompt sent at requestedAt may be
// cancelled. A push with no timestamp predates the column and is long dead.
func counterCancelableIn(requestedAt *time.Time) int {
	if requestedAt == nil {
		return 0
	}
	left := counterPushCancelAfter - time.Since(*requestedAt)
	if left <= 0 {
		return 0
	}
	return int(left.Seconds()) + 1
}

// RunCoopReconcileSweep settles every Co-op prompt still waiting — online
// parcel bookings, counter settlements and bus bookings — and frees the
// ones that have gone unanswered too long. Hooked on a ticker in
// cmd/api/main.go.
//
// A Co-op push is only ever confirmed by our own enquiry. Until now that
// enquiry ran only while somebody was polling a screen, so a payment
// approved after the clerk, sender or passenger closed it (or whose
// callback never reached us) was taken from the customer and never
// recorded.
func (s *Server) RunCoopReconcileSweep(ctx context.Context) {
	if !payments.CoopEnabled(s.Cfg) {
		return
	}
	release, ok, err := dbx.TryAdvisoryLock(ctx, s.Pool, coopReconcileLockKey)
	if err != nil {
		log.Printf("coop: reconcile sweep lock: %v", err)
		return
	}
	if !ok {
		return
	}
	defer release()

	parcelPushes, err := dbx.ListCoopPushesToReconcile(ctx, s.Pool, payments.CoopRefPrefix, 50)
	if err != nil {
		log.Printf("coop: reconcile sweep list: %v", err)
		return
	}
	for _, p := range parcelPushes {
		s.reconcileCoopPush(ctx, p, dbx.ReleaseParcelPaymentByCheckoutID)
	}

	busPushes, err := dbx.ListCoopBusBookingPushesToReconcile(ctx, s.Pool, payments.CoopRefPrefix, 50)
	if err != nil {
		log.Printf("coop: bus booking reconcile sweep list: %v", err)
		return
	}
	for _, p := range busPushes {
		s.reconcileCoopPush(ctx, p, dbx.ReleaseBusBookingByCheckoutID)
	}
}

// reconcileCoopPush is RunCoopReconcileSweep's per-push body, shared
// across domains: ask Co-op, and free the slot (via the domain's own
// release func) if it's gone unanswered past coopPushExpireAfter.
func (s *Server) reconcileCoopPush(
	ctx context.Context, p dbx.CoopPendingPush, release func(context.Context, *pgxpool.Pool, string) error,
) {
	if !coopPollDue(p.Ref) {
		return
	}
	res := s.settleCoopParcel(ctx, p.Ref)
	if res.State == payments.CoopStkPending && time.Since(p.RequestedAt) > coopPushExpireAfter {
		if err := release(ctx, s.Pool, p.Ref); err != nil {
			log.Printf("coop: expiring push %s: %v", p.Ref, err)
			return
		}
		log.Printf("coop: expired unanswered push %s (sent %s, Co-op says %q)",
			p.Ref, p.RequestedAt.Format(time.RFC3339), res.Description)
	}
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
			s.settleCoopParcel(c.Request.Context(), body.MessageReference)
		} else if json.Unmarshal(raw, &body) == nil && payments.IsCoopPayoutRef(body.MessageReference) {
			s.settleCoopPayoutByRef(c, body.MessageReference)
		} else {
			log.Printf("coop callback with no usable MessageReference: %.300s", string(raw))
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
