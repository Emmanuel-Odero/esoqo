package httpapi

import (
	"context"
	"fmt"
	"log"

	"github.com/gin-gonic/gin"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/notify"
	"github.com/esoqo/core-go/internal/payments"
)

const (
	// courierPayoutLockKey is the advisory-lock id that keeps a single
	// replica running the payout tick.
	courierPayoutLockKey int64 = 7461002

	// courierMinPayoutKes is M-Pesa's smallest B2C transfer. Smaller balances
	// keep accruing until they clear it.
	courierMinPayoutKes int64 = 10
)

// RunCourierPayoutSweep pays accrued courier earnings out over Co-op B2C and
// resolves payouts already in flight. Hooked on a ticker in cmd/api/main.go;
// a no-op unless COOP_COURIER_AUTOPAY is on and Co-op is the live provider.
//
// Driven from accrual state rather than from the delivery request, so the
// delivery paths stay untouched and an earnings hold (self-confirmed
// deliveries accrue 24h late) is respected for free: held earnings are not
// accrued yet, so there is nothing here to pay.
func (s *Server) RunCourierPayoutSweep(ctx context.Context) {
	if !s.Cfg.CoopCourierAutopay || !payments.CoopEnabled(s.Cfg) {
		return
	}
	release, ok, err := dbx.TryAdvisoryLock(ctx, s.Pool, courierPayoutLockKey)
	if err != nil {
		log.Printf("core-go: courier payout sweep lock: %v", err)
		return
	}
	if !ok {
		return // another replica has it
	}
	defer release()

	// Resolve what is already out before sending anything new.
	pending, err := dbx.ListPendingAutoPayouts(ctx, s.Pool)
	if err != nil {
		log.Printf("core-go: courier payout sweep list: %v", err)
		return
	}
	for _, p := range pending {
		s.reconcileCourierPayout(ctx, p)
	}

	toSend, err := dbx.PreparePendingPayouts(ctx, s.Pool, courierMinPayoutKes)
	if err != nil {
		log.Printf("core-go: courier payout sweep prepare: %v", err)
	}
	for _, p := range toSend {
		s.sendCourierPayout(ctx, p)
	}
}

func (s *Server) sendCourierPayout(ctx context.Context, p dbx.AutoPayout) {
	outcome, desc := payments.CoopB2CSend(s.Cfg, p.Reference, p.Msisdn, int64(p.AmountKes), "Esoqo courier earnings")
	switch outcome {
	case payments.CoopSendRejected:
		log.Printf("core-go: courier payout %s rejected by Co-op: %s", p.Reference, desc)
		if err := dbx.FailAutoPayout(ctx, s.Pool, p.ID, truncatePayoutReason(desc)); err != nil {
			log.Printf("core-go: failing courier payout %s: %v", p.Reference, err)
		}
	case payments.CoopSendUnknown:
		// Left PENDING on purpose: the enquiry on a later tick decides.
		log.Printf("core-go: courier payout %s: no answer from Co-op, left pending for enquiry", p.Reference)
	default:
		log.Printf("core-go: courier payout %s of KES %.0f accepted by Co-op", p.Reference, p.AmountKes)
	}
}

func (s *Server) reconcileCourierPayout(ctx context.Context, p dbx.AutoPayout) {
	st := payments.CoopQueryTransferStatus(s.Cfg, p.Reference)
	switch st.State {
	case payments.CoopTransferSuccess:
		settled, err := dbx.SettleAutoPayout(ctx, s.Pool, p, st.Receipt)
		if err != nil {
			log.Printf("core-go: settling courier payout %s: %v", p.Reference, err)
		}
		if settled && p.Msisdn != "" {
			ref := st.Receipt
			_ = authsvc.SendSms(p.Msisdn,
				notify.CourierPaid(fmt.Sprintf("%.0f", p.AmountKes), &ref), "COURIER_PAID")
		}
	case payments.CoopTransferFailed:
		log.Printf("core-go: courier payout %s failed at Co-op: %s", p.Reference, st.Description)
		if err := dbx.FailAutoPayout(ctx, s.Pool, p.ID, truncatePayoutReason(st.Description)); err != nil {
			log.Printf("core-go: failing courier payout %s: %v", p.Reference, err)
		}
	}
}

func truncatePayoutReason(s string) string {
	if len(s) > 300 {
		return s[:300]
	}
	return s
}

// settleCoopPayoutByRef is the callback's path to the same reconcile the
// ticker runs, so a result lands in seconds instead of waiting a tick. Like
// the STK path it believes nothing in the callback body.
//
// Courier earnings (rider payouts) and parcel org (courier company)
// payouts now share the same "CPO" Co-op reference prefix, so a ref is
// tried against both tables — a given ref only ever matches one of them.
func (s *Server) settleCoopPayoutByRef(c *gin.Context, ref string) {
	ctx := c.Request.Context()
	if s.Cfg.CoopCourierAutopay {
		if p, err := dbx.GetPendingAutoPayoutByRef(ctx, s.Pool, ref); err == nil && p != nil {
			s.reconcileCourierPayout(ctx, *p)
			return
		}
	}
	if row, err := dbx.GetProcessingParcelOrgPayoutByConversationID(ctx, s.Pool, ref); err == nil && row != nil {
		s.reconcileCoopParcelOrgPayout(ctx, row)
	}
}
