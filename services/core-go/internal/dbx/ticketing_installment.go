package dbx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// nowUTC / parseDBTime — Postgres `::text` timestamps arrive without a
// fixed shape ("2026-09-04 12:00:00", optionally with fractional seconds
// or a zone suffix), so parse leniently instead of assuming one layout.
func nowUTC() time.Time { return time.Now().UTC() }

func parseDBTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	layouts := []string{
		"2006-01-02 15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05Z07:00",
		"2006-01-02 15:04:05",
		time.RFC3339Nano,
		time.RFC3339,
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unparseable timestamp %q", s)
}

// Installment ("lipia pole pole") ports packages/db/src/dal/ticketing.ts's
// openInstallmentPlan / createBookingBalancePayment / the BookingPayment
// branch of confirmBookingPayment, 1:1. A plan reserves nothing — tickets
// are issued (capacity-checked at that moment) only once the balance
// clears. Constants mirror packages/domain/src/ticketing.ts.
const (
	InstallmentMinLeadHours = 48
	MinInstallmentKES       = 100.0
)

func minDepositKES(totalKES float64, percent int) float64 {
	deposit := math.Ceil(totalKES * float64(percent) / 100)
	if deposit < MinInstallmentKES {
		return MinInstallmentKES
	}
	return deposit
}

type PlannedLine struct {
	TicketClassID string  `json:"ticketClassId"`
	HolderName    *string `json:"holderName,omitempty"`
	HolderMsisdn  *string `json:"holderMsisdn,omitempty"`
}

type PlanLineInput struct {
	TicketClassID string
	HolderName    *string
	HolderMsisdn  *string
}

type OpenPlanInput struct {
	ScheduleID   string
	BuyerPartyID *string
	BuyerName    string
	BuyerMsisdn  string
	BuyerEmail   *string
	Lines        []PlanLineInput
	DepositKES   float64
}

type OpenPlanResult struct {
	BookingID        string
	Status           string
	TotalKES         string
	DepositPaymentID string
	DepositKES       float64
	BalanceDueBy     string
}

type InstallmentError struct {
	Code    string // SCHEDULE_NOT_FOUND | PLAN_NOT_ALLOWED | DEPOSIT_TOO_LOW | NOT_FOUND | BAD_INPUT | PAST_DUE | OVERPAY
	Message string
}

func (e *InstallmentError) Error() string { return e.Message }

// OpenInstallmentPlan mirrors openInstallmentPlan: GA classes only, org
// must allow plans, trip 48h+ out, deposit within [minDeposit, total].
// Claims no seat and no GA slot — nothing is reserved until fully paid.
func OpenInstallmentPlan(ctx context.Context, pool *pgxpool.Pool, in OpenPlanInput) (*OpenPlanResult, error) {
	if len(in.Lines) == 0 {
		return nil, &InstallmentError{"BAD_INPUT", "A booking needs at least one ticket"}
	}

	var orgID, departAtText string
	err := pool.QueryRow(ctx, `
		SELECT l."orgId", ls."departAt"::text FROM listing_schedule ls
		JOIN listing l ON l.id = ls."listingId"
		WHERE ls.id = $1 AND ls.status = 'SCHEDULED'`, in.ScheduleID).Scan(&orgID, &departAtText)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &InstallmentError{"SCHEDULE_NOT_FOUND", "That departure is no longer available"}
	}
	if err != nil {
		return nil, err
	}

	var installmentsEnabled bool
	var minDepositPercent int
	err = pool.QueryRow(ctx, `
		SELECT "installmentsEnabled", "minDepositPercent" FROM ticket_org WHERE id = $1`,
		orgID).Scan(&installmentsEnabled, &minDepositPercent)
	if err != nil {
		return nil, err
	}
	if !installmentsEnabled {
		return nil, &InstallmentError{"PLAN_NOT_ALLOWED", "This organiser does not offer pay-in-portions"}
	}

	departAt, err := parseDBTime(departAtText)
	if err != nil {
		return nil, err
	}
	if departAt.Sub(nowUTC()).Hours() < InstallmentMinLeadHours {
		return nil, &InstallmentError{"PLAN_NOT_ALLOWED", fmt.Sprintf("Pay-in-portions is only for trips at least %d hours away", InstallmentMinLeadHours)}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	total := 0.0
	planned := make([]PlannedLine, 0, len(in.Lines))
	for _, line := range in.Lines {
		var priceKESText string
		var seated bool
		var listingID string
		err = tx.QueryRow(ctx, `
			SELECT "priceKes"::text, seated, "listingId" FROM ticket_class WHERE id = $1`,
			line.TicketClassID).Scan(&priceKESText, &seated, &listingID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &InstallmentError{"NOT_FOUND", "That ticket type is not available for this departure"}
		}
		if err != nil {
			return nil, err
		}
		if seated {
			return nil, &InstallmentError{"PLAN_NOT_ALLOWED", "Pay-in-portions is not available for seated classes yet"}
		}
		// Class must belong to this schedule's listing (same guard as
		// CreateBooking's FOR UPDATE check, without locking — nothing is
		// claimed here).
		var scheduleListingID string
		err = tx.QueryRow(ctx, `SELECT "listingId" FROM listing_schedule WHERE id = $1`, in.ScheduleID).Scan(&scheduleListingID)
		if err != nil || scheduleListingID != listingID {
			return nil, &InstallmentError{"NOT_FOUND", "That ticket type is not available for this departure"}
		}
		priceKES, err := strconv.ParseFloat(priceKESText, 64)
		if err != nil {
			return nil, err
		}
		total += priceKES
		planned = append(planned, PlannedLine{TicketClassID: line.TicketClassID, HolderName: line.HolderName, HolderMsisdn: line.HolderMsisdn})
	}

	deposit := math.Round(in.DepositKES)
	minDeposit := minDepositKES(total, minDepositPercent)
	if deposit < minDeposit {
		return nil, &InstallmentError{"DEPOSIT_TOO_LOW", fmt.Sprintf("The first payment must be at least KES %.0f", minDeposit)}
	}
	if deposit > total {
		return nil, &InstallmentError{"DEPOSIT_TOO_LOW", "The deposit is more than the trip costs"}
	}

	var ticketCustomerID string
	err = tx.QueryRow(ctx, `
		INSERT INTO ticket_customer (id, "orgId", msisdn, name, email, "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())
		ON CONFLICT ("orgId", msisdn) DO UPDATE SET "updatedAt" = now()
		RETURNING id`, orgID, in.BuyerMsisdn, in.BuyerName, in.BuyerEmail).Scan(&ticketCustomerID)
	if err != nil {
		return nil, err
	}

	plannedJSON, err := json.Marshal(planned)
	if err != nil {
		return nil, err
	}

	var bookingID, balanceDueBy string
	var depositPaymentID string
	err = tx.QueryRow(ctx, `
		INSERT INTO booking (
			id, "scheduleId", "buyerPartyId", "buyerName", "buyerMsisdn", "buyerEmail",
			"ticketCustomerId", status, "paymentMethod", "totalKes",
			"isInstallment", "amountPaidKes", "balanceDueBy", "plannedLines", "createdAt"
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'PENDING_PAYMENT', 'MPESA_STK', $7,
			true, 0, $8, $9, now()
		) RETURNING id, "balanceDueBy"::text`, in.ScheduleID, in.BuyerPartyID, in.BuyerName,
		in.BuyerMsisdn, in.BuyerEmail, ticketCustomerID, total, departAt.Format("2006-01-02 15:04:05"), string(plannedJSON)).
		Scan(&bookingID, &balanceDueBy)
	if err != nil {
		return nil, err
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO booking_payment (id, "bookingId", "amountKes", kind, status, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, 'DEPOSIT', 'PENDING', now())
		RETURNING id`, bookingID).Scan(&depositPaymentID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &OpenPlanResult{
		BookingID: bookingID, Status: "PENDING_PAYMENT",
		TotalKES: fmt.Sprintf("%.2f", total), DepositPaymentID: depositPaymentID,
		DepositKES: deposit, BalanceDueBy: balanceDueBy,
	}, nil
}

func AttachBookingPaymentCheckoutRequestID(ctx context.Context, pool *pgxpool.Pool, paymentID, checkoutRequestID string) error {
	_, err := pool.Exec(ctx, `UPDATE booking_payment SET "mpesaCheckoutRequestId" = $1 WHERE id = $2`, checkoutRequestID, paymentID)
	return err
}

type BalancePaymentResult struct {
	ID        string
	AmountKES float64
	Msisdn    string
}

// CreateBalancePayment mirrors createBookingBalancePayment: open plans
// only, deadline and [min, remaining] bounds enforced, kind BALANCE when
// it clears the plan. Auth mirrors getBookingStatus — a signed-in
// buyer's booking is buyer-only (buyerPartyID must match); a guest
// booking's id is the secret (pass nil buyerPartyID).
func CreateBalancePayment(ctx context.Context, pool *pgxpool.Pool, bookingID string, buyerPartyID *string, amountKES float64) (*BalancePaymentResult, error) {
	var buyerPartyIDCol *string
	var buyerMsisdn, status, totalText, paidText string
	var isInstallment bool
	var balanceDueBy *string
	err := pool.QueryRow(ctx, `
		SELECT "buyerPartyId"::text, "buyerMsisdn", status::text, "totalKes"::text,
		       "amountPaidKes"::text, "isInstallment", "balanceDueBy"::text
		FROM booking WHERE id = $1`, bookingID).
		Scan(&buyerPartyIDCol, &buyerMsisdn, &status, &totalText, &paidText, &isInstallment, &balanceDueBy)
	if errors.Is(err, pgx.ErrNoRows) || !isInstallment {
		return nil, &InstallmentError{"NOT_FOUND", "Booking not found"}
	}
	if err != nil {
		return nil, err
	}
	if buyerPartyIDCol != nil && *buyerPartyIDCol != "" {
		if buyerPartyID == nil || *buyerPartyID != *buyerPartyIDCol {
			return nil, &InstallmentError{"NOT_FOUND", "Booking not found"}
		}
	}
	if status != "PENDING_PAYMENT" && status != "PARTIALLY_PAID" {
		return nil, &InstallmentError{"BAD_INPUT", "This plan is not open for payment"}
	}
	if balanceDueBy != nil {
		if due, err := parseDBTime(*balanceDueBy); err == nil && due.Before(nowUTC()) {
			return nil, &InstallmentError{"PAST_DUE", "The payment deadline for this trip has passed"}
		}
	}

	total, _ := strconv.ParseFloat(totalText, 64)
	paid, _ := strconv.ParseFloat(paidText, 64)
	remaining := total - paid
	amount := math.Round(amountKES)
	if amount > remaining {
		return nil, &InstallmentError{"OVERPAY", fmt.Sprintf("Only KES %.0f is left to pay", remaining)}
	}
	minEach := MinInstallmentKES
	if remaining < minEach {
		minEach = remaining
	}
	if amount < minEach {
		return nil, &InstallmentError{"DEPOSIT_TOO_LOW", fmt.Sprintf("Each payment must be at least KES %.0f", minEach)}
	}

	kind := "INSTALLMENT"
	if amount == remaining {
		kind = "BALANCE"
	}
	var id string
	err = pool.QueryRow(ctx, `
		INSERT INTO booking_payment (id, "bookingId", "amountKes", kind, status, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, 'PENDING', now())
		RETURNING id`, bookingID, amount, kind).Scan(&id)
	if err != nil {
		return nil, err
	}
	return &BalancePaymentResult{ID: id, AmountKES: amount, Msisdn: buyerMsisdn}, nil
}

var ErrBookingPaymentNotFound = errors.New("no booking payment for that checkout request")

// ConfirmInstallmentPaymentByCheckoutID mirrors confirmBookingPayment's
// BookingPayment branch: idempotent, rolls into amountPaidKes, flips to
// PARTIALLY_PAID or PAID (issuing planned tickets then, capacity-checked
// at that moment). A sold-out plan flips to CANCELLED instead of
// issuing — same as TS.
func ConfirmInstallmentPaymentByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID, receiptCode string) error {
	var paymentID, paymentStatus, amountText, bookingID string
	err := pool.QueryRow(ctx, `
		SELECT id, status, "amountKes"::text, "bookingId"
		FROM booking_payment WHERE "mpesaCheckoutRequestId" = $1`, checkoutRequestID).
		Scan(&paymentID, &paymentStatus, &amountText, &bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrBookingPaymentNotFound
	}
	if err != nil {
		return err
	}
	if paymentStatus == "CONFIRMED" {
		return nil
	}

	amount, err := strconv.ParseFloat(amountText, 64)
	if err != nil {
		return err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE booking_payment SET status = 'CONFIRMED', "confirmedAt" = now(), "mpesaReceiptCode" = $1
		WHERE id = $2`, receiptCode, paymentID); err != nil {
		return err
	}

	var totalText, paidText, plannedJSON, ticketCustomerID, scheduleID string
	err = tx.QueryRow(ctx, `
		SELECT "totalKes"::text, "amountPaidKes"::text, "plannedLines"::text,
		       COALESCE("ticketCustomerId"::text, ''), "scheduleId"
		FROM booking WHERE id = $1`, bookingID).
		Scan(&totalText, &paidText, &plannedJSON, &ticketCustomerID, &scheduleID)
	if err != nil {
		return err
	}
	total, _ := strconv.ParseFloat(totalText, 64)
	paid, _ := strconv.ParseFloat(paidText, 64)
	newPaid := paid + amount

	if newPaid < total {
		_, err = tx.Exec(ctx, `UPDATE booking SET "amountPaidKes" = $1, status = 'PARTIALLY_PAID' WHERE id = $2`, newPaid, bookingID)
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	issued, err := issuePlannedTickets(ctx, tx, bookingID, scheduleID, plannedJSON)
	if err != nil {
		return err
	}
	if issued {
		_, err = tx.Exec(ctx, `UPDATE booking SET "amountPaidKes" = $1, status = 'PAID', "paidAt" = now() WHERE id = $2`, newPaid, bookingID)
	} else {
		_, err = tx.Exec(ctx, `UPDATE booking SET "amountPaidKes" = $1, status = 'CANCELLED' WHERE id = $2`, newPaid, bookingID)
	}
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	if issued && ticketCustomerID != "" {
		return earnTicketLoyalty(ctx, pool, bookingID, ticketCustomerID, total)
	}
	return nil
}

type pgxTx interface {
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
}

// issuePlannedTickets issues Ticket rows for a fully-paid plan,
// capacity-checking the whole batch (per class) first. Returns false
// when a class sold out mid-plan — the caller cancels instead.
func issuePlannedTickets(ctx context.Context, tx pgxTx, bookingID, scheduleID, plannedJSON string) (bool, error) {
	var lines []PlannedLine
	if err := json.Unmarshal([]byte(plannedJSON), &lines); err != nil {
		return false, err
	}
	if len(lines) == 0 {
		return true, nil
	}

	// Buyer identity for the issued tickets — same natural key the plan
	// was opened with.
	var buyerName, buyerMsisdn string
	if err := tx.QueryRow(ctx, `SELECT "buyerName", "buyerMsisdn" FROM booking WHERE id = $1`, bookingID).Scan(&buyerName, &buyerMsisdn); err != nil {
		return false, err
	}

	wantByClass := map[string]int{}
	for _, l := range lines {
		wantByClass[l.TicketClassID]++
	}
	prices := map[string]float64{}
	for classID, want := range wantByClass {
		var priceText string
		var capacity int
		err := tx.QueryRow(ctx, `SELECT "priceKes"::text, capacity FROM ticket_class WHERE id = $1`, classID).Scan(&priceText, &capacity)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		price, err := strconv.ParseFloat(priceText, 64)
		if err != nil {
			return false, err
		}
		prices[classID] = price
		var sold int
		err = tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM ticket t
			JOIN booking b ON b.id = t."bookingId"
			WHERE t."ticketClassId" = $1 AND b."scheduleId" = $2
			  AND t.status IN ('VALID', 'USED')`, classID, scheduleID).Scan(&sold)
		if err != nil {
			return false, err
		}
		if sold+want > capacity {
			return false, nil
		}
	}

	for _, l := range lines {
		code, err := generateTicketCode()
		if err != nil {
			return false, err
		}
		holderName := buyerName
		if l.HolderName != nil && *l.HolderName != "" {
			holderName = *l.HolderName
		}
		holderMsisdn := buyerMsisdn
		if l.HolderMsisdn != nil && *l.HolderMsisdn != "" {
			holderMsisdn = *l.HolderMsisdn
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO ticket (id, "bookingId", "ticketClassId", "seatId", code, "holderName", "holderMsisdn", "priceKes", status, "createdAt")
			VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, $6, 'VALID', now())`,
			bookingID, l.TicketClassID, code, holderName, holderMsisdn, prices[l.TicketClassID])
		if err != nil {
			return false, err
		}
	}
	return true, nil
}

type InstallmentStatus struct {
	Status       string
	TotalKES     string
	PaidKES      string
	BalanceKES   string
	BalanceDueBy *string
}

// GetInstallmentStatus reads the plan's current ledger position — what
// the top-up and waiting screens poll after each push.
func GetInstallmentStatus(ctx context.Context, pool *pgxpool.Pool, bookingID string) (*InstallmentStatus, error) {
	var st InstallmentStatus
	err := pool.QueryRow(ctx, `
		SELECT status::text, "totalKes"::text, "amountPaidKes"::text,
		       ("totalKes" - "amountPaidKes")::text, "balanceDueBy"::text
		FROM booking WHERE id = $1`, bookingID).
		Scan(&st.Status, &st.TotalKES, &st.PaidKES, &st.BalanceKES, &st.BalanceDueBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &st, err
}

// SweepOverdueInstallmentBookings mirrors sweepOverdueInstallmentBookings:
// cancels open plans past their balance-due deadline. Safe to run
// repeatedly; TS likewise has no scheduled caller yet.
func SweepOverdueInstallmentBookings(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	res, err := pool.Exec(ctx, `
		UPDATE booking SET status = 'CANCELLED'
		WHERE "isInstallment" = true AND status IN ('PENDING_PAYMENT', 'PARTIALLY_PAID')
		  AND "balanceDueBy" IS NOT NULL AND "balanceDueBy" < now()`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected(), nil
}
