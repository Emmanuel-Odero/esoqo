package httpapi

import (
	"context"
	"log"
	"time"

	"github.com/esoqo/core-go/internal/dbx"
	"github.com/esoqo/core-go/internal/payments"
)

// dispatchParcelOrgPayoutForParcel looks up the PENDING row created for
// a just-settled parcel and dispatches it — the entry point every
// settlement path calls right after it commits.
//
// Deliberately detached from the caller's request context — a clerk's
// settlement response, or Safaricom's STK webhook ack, must not wait on
// a second Daraja round trip, and must not be cancelled by the first
// one's response already having been written.
func (s *Server) dispatchParcelOrgPayoutForParcel(parcelID string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		row, err := dbx.GetPendingParcelOrgPayout(ctx, s.Pool, parcelID)
		if err != nil {
			log.Printf("core-go: dispatchParcelOrgPayoutForParcel lookup failed for parcel %s: %v", parcelID, err)
			return
		}
		if row == nil {
			return // nothing PENDING — MANUAL, no org, or already handled
		}
		s.dispatchParcelOrgPayout(ctx, row)
	}()
}

// dispatchParcelOrgPayoutForBusBooking is dispatchParcelOrgPayoutForParcel
// for a just-paid bus booking instead of a just-settled parcel — same
// detached-goroutine shape, same shared dispatch step below, since a
// bus booking's payout row lives in the exact same table and clears
// through the exact same rails.
func (s *Server) dispatchParcelOrgPayoutForBusBooking(bookingID string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		row, err := dbx.GetPendingParcelOrgPayoutByBusBooking(ctx, s.Pool, bookingID)
		if err != nil {
			log.Printf("core-go: dispatchParcelOrgPayoutForBusBooking lookup failed for booking %s: %v", bookingID, err)
			return
		}
		if row == nil {
			return // nothing PENDING — MANUAL, no org, or already handled
		}
		s.dispatchParcelOrgPayout(ctx, row)
	}()
}

// dispatchParcelOrgPayout is the one place that actually sends a courier
// company's cut of a parcel out the door. dbx itself never calls Daraja
// (see dbx/parcels.go's own package comment on keeping side effects out
// of that layer); this is where the split between "recorded" and
// "sent" is actually crossed.
//
// Takes an already-fetched row rather than re-querying by status, so
// the retry worker can call this directly on a row it just reset from
// FAILED back to PENDING without a race against its own write.
func (s *Server) dispatchParcelOrgPayout(ctx context.Context, row *dbx.ParcelOrgPayoutRow) {
	if row.Method == nil {
		return // MANUAL — nothing automatic to do
	}

	var conversationID, transactionID string
	var autoConfirmed bool
	var initErr error

	switch *row.Method {
	case "PHONE":
		if row.PayoutMsisdn == nil || *row.PayoutMsisdn == "" {
			initErr = errMissingPayoutDestination
			break
		}
		// Co-op when it is the live provider — same discipline as
		// ParcelStkPush on the collection side, and the rail that
		// actually matches these courier companies' settlement
		// configuration (a Co-op-held settlement account). Daraja B2C
		// is a separate credential set (MPESA_B2C_CERT/RESULT_URL/
		// TIMEOUT_URL) this deployment does not carry, so it is only
		// the fallback for environments that genuinely run Daraja.
		if payments.CoopEnabled(s.Cfg) {
			ref := payments.NewCoopPayoutRef()
			outcome, desc := payments.CoopB2CSend(s.Cfg, ref, *row.PayoutMsisdn, int64(row.AmountKes), "Esoqo parcel settlement")
			switch outcome {
			case payments.CoopSendRejected:
				initErr = &payoutDestinationError{desc}
			case payments.CoopSendUnknown:
				// A transport/auth failure, not a bank verdict — left exactly
				// as PENDING so the retry worker's next tick (or a genuine
				// Co-op callback) asks again instead of risking a second send.
				log.Printf("core-go: parcel org payout %s: no answer from Co-op B2C, left pending", row.ID)
				return
			default:
				conversationID = ref
			}
			break
		}
		res, err := payments.InitiateB2CPayment(s.Cfg, payments.B2CPaymentRequest{
			Msisdn:    *row.PayoutMsisdn,
			AmountKES: row.AmountKes,
			Remarks:   "Esoqo parcel settlement",
		})
		if err != nil {
			initErr = err
			break
		}
		conversationID, transactionID, autoConfirmed = res.ConversationID, res.MpesaTransactionID, res.AutoConfirmed
	case "TILL":
		if row.PayoutTillNumber == nil || *row.PayoutTillNumber == "" {
			initErr = errMissingPayoutDestination
			break
		}
		res, err := payments.InitiateB2BPayment(s.Cfg, payments.B2BPaymentRequest{
			CommandID: "BusinessBuyGoods",
			PartyB:    *row.PayoutTillNumber,
			AmountKES: row.AmountKes,
			Remarks:   "Esoqo parcel settlement",
		})
		if err != nil {
			initErr = err
			break
		}
		conversationID, transactionID, autoConfirmed = res.ConversationID, res.MpesaTransactionID, res.AutoConfirmed
	case "PAYBILL":
		if row.PayoutPaybillNumber == nil || *row.PayoutPaybillNumber == "" {
			initErr = errMissingPayoutDestination
			break
		}
		accountRef := ""
		if row.PayoutPaybillAccount != nil {
			accountRef = *row.PayoutPaybillAccount
		}
		res, err := payments.InitiateB2BPayment(s.Cfg, payments.B2BPaymentRequest{
			CommandID:        "BusinessPayBill",
			PartyB:           *row.PayoutPaybillNumber,
			AccountReference: accountRef,
			AmountKES:        row.AmountKes,
			Remarks:          "Esoqo parcel settlement",
		})
		if err != nil {
			initErr = err
			break
		}
		conversationID, transactionID, autoConfirmed = res.ConversationID, res.MpesaTransactionID, res.AutoConfirmed
	case "BANK":
		if row.PayoutBankCode == nil || *row.PayoutBankCode == "" ||
			row.PayoutBankAccountNumber == nil || *row.PayoutBankAccountNumber == "" {
			initErr = errMissingPayoutDestination
			break
		}
		if s.Cfg.CoopSourceAccount == "" {
			initErr = errBankPayoutsNotConfigured
			break
		}
		ref := payments.NewCoopPayoutRef()
		// Co-op itself (bank identifier "0011") moves as an internal
		// transfer; every other bank goes out over PesaLink — see
		// payments.CoopBankTransferSend's own comment.
		outcome, desc := payments.CoopBankTransferSend(s.Cfg, ref, *row.PayoutBankCode, *row.PayoutBankAccountNumber,
			int64(row.AmountKes), "Esoqo parcel settlement")
		switch outcome {
		case payments.CoopSendRejected:
			initErr = &payoutDestinationError{desc}
		case payments.CoopSendUnknown:
			// A transport/auth failure, not a bank verdict — left exactly
			// as PENDING so the retry worker's next tick (or a genuine
			// Co-op callback, if one still lands) asks again instead of
			// risking a second transfer.
			log.Printf("core-go: parcel org payout %s: no answer from Co-op PesaLink, left pending", row.ID)
			return
		default:
			conversationID = ref
		}
	default:
		return // unrecognised — already created MANUAL, nothing to dispatch
	}

	if initErr != nil {
		if err := dbx.MarkParcelOrgPayoutFailed(ctx, s.Pool, row.ID, initErr.Error()); err != nil {
			log.Printf("core-go: dispatchParcelOrgPayout could not mark %s FAILED: %v", row.ID, err)
		}
		return
	}
	if err := dbx.MarkParcelOrgPayoutProcessing(ctx, s.Pool, row.ID, conversationID); err != nil {
		log.Printf("core-go: dispatchParcelOrgPayout could not mark %s PROCESSING: %v", row.ID, err)
		return
	}
	if autoConfirmed {
		// Console mode only — the "payout" already settled inline.
		if err := dbx.ConfirmParcelOrgPayoutByConversationID(ctx, s.Pool, conversationID, transactionID); err != nil {
			log.Printf("core-go: dispatchParcelOrgPayout could not auto-confirm %s: %v", row.ID, err)
		}
	}
}

// reconcileCoopParcelOrgPayout asks Co-op what became of a PesaLink
// transfer or a Co-op B2C mobile payout and acts on the answer — the
// Co-op-rail equivalent of reconcileCourierPayout
// (courier_autopayout.go), confirming or failing through the same
// row-locked ledger paths the Daraja result webhooks use for every
// other payout method.
func (s *Server) reconcileCoopParcelOrgPayout(ctx context.Context, row *dbx.ParcelOrgPayoutRow) {
	st := payments.CoopQueryTransferStatus(s.Cfg, row.MpesaConversationID)
	switch st.State {
	case payments.CoopTransferSuccess:
		if err := dbx.ConfirmParcelOrgPayoutByConversationID(ctx, s.Pool, row.MpesaConversationID, st.Receipt); err != nil && err != dbx.ErrParcelOrgPayoutNotFound {
			log.Printf("core-go: confirming coop parcel org payout %s: %v", row.ID, err)
		}
	case payments.CoopTransferFailed:
		if err := dbx.FailParcelOrgPayoutByConversationID(ctx, s.Pool, row.MpesaConversationID, truncatePayoutReason(st.Description)); err != nil && err != dbx.ErrParcelOrgPayoutNotFound {
			log.Printf("core-go: failing coop parcel org payout %s: %v", row.ID, err)
		}
	}
}

var errMissingPayoutDestination = &payoutDestinationError{"That company's payout destination is missing a required field"}

// errBankPayoutsNotConfigured fires when a company is set up for BANK but
// this environment has no Co-op source account to send PesaLink transfers
// from — same shape as errMissingPayoutDestination, just a platform-level
// gap rather than the company's own configuration.
var errBankPayoutsNotConfigured = &payoutDestinationError{"Bank payouts aren't configured on this environment (COOP_SOURCE_ACCOUNT)"}

type payoutDestinationError struct{ msg string }

func (e *payoutDestinationError) Error() string { return e.msg }

// retryParcelOrgPayouts is the one background loop in this process —
// see services/workers' own README: nothing there yet to plug into, so
// this runs in-process. Re-attempts anything stuck PENDING (a dispatch
// goroutine never got to run — a restart between the row's commit and
// the attempt) or FAILED (Daraja refused the request, or a result
// callback said the payout itself failed) once it has sat long enough
// that it can't still be genuinely in flight.
func (s *Server) RetryParcelOrgPayouts(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Resolve Co-op transfers already in flight (PesaLink and
			// Co-op B2C mobile payouts alike) before sending anything
			// new — same order RunCourierPayoutSweep follows for the
			// M-Pesa rail.
			processing, err := dbx.ListProcessingCoopParcelOrgPayouts(ctx, s.Pool, 50)
			if err != nil {
				log.Printf("core-go: retryParcelOrgPayouts coop reconcile list failed: %v", err)
			}
			for i := range processing {
				s.reconcileCoopParcelOrgPayout(ctx, &processing[i])
			}

			rows, err := dbx.ListRetryableParcelOrgPayouts(ctx, s.Pool, 10*time.Minute, 50)
			if err != nil {
				log.Printf("core-go: retryParcelOrgPayouts list failed: %v", err)
				continue
			}
			for i := range rows {
				row := rows[i]
				if row.Status == "FAILED" {
					if err := dbx.ResetParcelOrgPayoutToPending(ctx, s.Pool, row.ID); err != nil {
						log.Printf("core-go: retryParcelOrgPayouts could not reset %s: %v", row.ID, err)
						continue
					}
				}
				s.dispatchParcelOrgPayout(ctx, &row)
			}
		}
	}
}
