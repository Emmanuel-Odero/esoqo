// Package dbx (parcel_counter_tickets.go) — the walk-in queue: a
// service ticket number minted the moment a customer asks for service
// (kiosk / counter QR web form / the app), before any parcel details
// exist, so a clerk has something to see and claim. See
// ParcelCounterTicket's own schema comment for why this is a separate
// model from Parcel rather than an early-status row on it.
//
// The live-push side (a clerk's queue updating without a refresh, a
// customer's own ticket screen flipping to "you're being served") runs
// on Postgres LISTEN/NOTIFY, not a new table or an in-process
// broadcaster: core-go runs multiple replicas, and an in-process
// pub/sub would silently miss events delivered to a different replica
// than the one a client's SSE connection happens to be on. One channel
// for every org and every ticket — NotifyCounterTicketEvent's payload
// carries orgId/ticketId so a subscriber filters client-side rather
// than needing N channel names sanitized and LISTENed to individually.
package dbx

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/fleetqr"
)

// CounterTicketChannel — the Postgres NOTIFY channel every counter
// ticket event fires on, org- and ticket-agnostic (see this file's own
// package comment for why one channel, not one per org).
const CounterTicketChannel = "parcel_counter_ticket_events"

type ParcelCounterTicket struct {
	ID                  string          `json:"id"`
	OrgID               string          `json:"orgId"`
	ServiceTicketNumber string          `json:"serviceTicketNumber"`
	Msisdn              string          `json:"msisdn"`
	Channel             string          `json:"channel"`
	Status              string          `json:"status"`
	DraftDetails        json.RawMessage `json:"draftDetails,omitempty"`
	ClaimedByStaffID    *string         `json:"claimedByStaffId,omitempty"`
	ClaimedAt           *time.Time      `json:"claimedAt,omitempty"`
	CreatedAt           time.Time       `json:"createdAt"`

	// Present on the clerk-facing board/history reads, never on the
	// public ticket endpoints: who is serving this (by name, not id),
	// whether that person is the caller (so the client knows which
	// active case it may resume rather than merely admire), and what
	// the claim turned into so far — the booked parcel's code/status,
	// and whether an M-Pesa push for it is still in flight.
	ClaimedByName        *string    `json:"claimedByName,omitempty"`
	Mine                 bool       `json:"mine"`
	ParcelCode           *string    `json:"parcelCode,omitempty"`
	ParcelStatus         *string    `json:"parcelStatus,omitempty"`
	ParcelPaidAt         *time.Time `json:"parcelPaidAt,omitempty"`
	ParcelPriceKes       *float64   `json:"parcelPriceKes,omitempty"`
	PaymentPending       bool       `json:"paymentPending"`
	CancelledAt          *time.Time `json:"cancelledAt,omitempty"`
	CancelReason         *string    `json:"cancelReason,omitempty"`
	CancelledByStaffName *string    `json:"cancelledByStaffName,omitempty"`
}

// CounterTicketEvent is the NOTIFY payload — small on purpose (the
// 8000-byte Postgres payload cap isn't the constraint here, keeping a
// subscriber's filter cheap is). A subscriber that cares fetches the
// full ticket itself rather than trusting a stale copy riding the
// notification.
type CounterTicketEvent struct {
	OrgID    string `json:"orgId"`
	TicketID string `json:"ticketId"`
	Event    string `json:"event"` // created | claimed | expired | cancelled | draft_updated
}

func notifyCounterTicketEvent(ctx context.Context, tx pgx.Tx, ev CounterTicketEvent) error {
	payload, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	// pg_notify, not a literal NOTIFY channel, ""; — the payload is a
	// bind parameter this way, so a phone number or draft field that
	// happened to contain a quote can't break the statement. Fired
	// inside the caller's own transaction: a NOTIFY queued by a
	// transaction that then rolls back is simply never sent (Postgres's
	// own guarantee), so a subscriber never learns about a ticket that
	// didn't actually get created.
	_, err = tx.Exec(ctx, `SELECT pg_notify($1, $2)`, CounterTicketChannel, string(payload))
	return err
}

// CreateCounterTicket mints a walk-in's place in line. orgID must name
// a company that actually runs a walk-in desk (ParcelOrg.acceptsWalkIn)
// — the same gate BookParcel's SELF_DROPOFF path already enforces, so
// a ticket can never exist for a company with nowhere to serve it.
func CreateCounterTicket(
	ctx context.Context, pool *pgxpool.Pool, orgID, msisdn, channel string, draftDetails json.RawMessage,
) (*ParcelCounterTicket, error) {
	msisdn = strings.TrimSpace(msisdn)
	if msisdn == "" {
		return nil, &ParcelError{"BAD_INPUT", "A phone number is required"}
	}
	switch channel {
	case "KIOSK", "WEB_QR", "APP":
	default:
		return nil, &ParcelError{"BAD_INPUT", "Unknown channel"}
	}

	var acceptsWalkIn bool
	err := pool.QueryRow(ctx, `SELECT "acceptsWalkIn" FROM parcel_org WHERE id = $1 AND status != 'SUSPENDED'`, orgID).
		Scan(&acceptsWalkIn)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That company isn't available"}
	}
	if err != nil {
		return nil, err
	}
	if !acceptsWalkIn {
		return nil, &ParcelError{"BAD_INPUT", "That company doesn't take walk-ins"}
	}

	// Name-shaped from the start, same convention Parcel.serviceTicketNumber
	// already follows (fleetqr.ServiceTicketForName) — a sender is only
	// ever asked for a phone number at this point, so this looks that
	// phone up against an existing Esoqo account for a name to read.
	// First name and surname are fetched together, not just the first
	// name: the ticket number draws at random from either of them (see
	// ServiceTicketForName), so giving it only half the identity would
	// mean every account-holder's ticket opens with their first name.
	// "GUEST" when it's a genuinely fresh number: still "a word plus
	// three digits", never the bare TCK-XXXXXX shape — that shape must
	// not reach a sender again (see ServiceTicketForName's own fallback,
	// which this deliberately avoids triggering).
	var personName string
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(
			NULLIF(CONCAT_WS(' ', NULLIF(p."firstName", ''), NULLIF(p."surname", '')), ''),
			NULLIF(p."firstName", ''),
			p."officialName")
		FROM person p WHERE p.msisdn = $1 LIMIT 1`, msisdn).Scan(&personName)
	if personName == "" {
		personName = "GUEST"
	}

	t := &ParcelCounterTicket{
		OrgID:        orgID,
		Msisdn:       msisdn,
		Channel:      channel,
		Status:       "WAITING",
		DraftDetails: draftDetails,
	}
	if len(draftDetails) == 0 {
		t.DraftDetails = nil
	}
	// Run against the pool, one INSERT per attempt, not inside a
	// transaction: a unique violation would otherwise poison a shared
	// tx and make every retried statement fail with "transaction is
	// aborted" instead of the 23505 retryUnique actually checks for.
	// Only a 3-digit suffix (1000 draws), reused across every ticket
	// that falls back to the same name — unlike ShortCodeChecked's
	// checksummed 6-char code, a collision here is a real, regular
	// possibility, not a theoretical one.
	err = retryUnique(func() error {
		t.ServiceTicketNumber = fleetqr.ServiceTicketForName(personName)
		return pool.QueryRow(ctx, `
			INSERT INTO parcel_counter_ticket (id, "orgId", "serviceTicketNumber", msisdn, channel, status, "draftDetails")
			VALUES (gen_random_uuid(), $1, $2, $3, $4::"ParcelCounterTicketChannel", 'WAITING', $5)
			RETURNING id, "createdAt"`,
			orgID, t.ServiceTicketNumber, msisdn, channel, nullableJSON(t.DraftDetails)).
			Scan(&t.ID, &t.CreatedAt)
	})
	if err != nil {
		return nil, err
	}
	// The insert already committed (no transaction wraps it — see
	// above), so the NOTIFY firing standalone here is exactly as safe
	// as the tx-scoped version every other caller uses: a ticket that
	// wasn't actually created never reaches this line.
	if _, err := pool.Exec(ctx, `SELECT pg_notify($1, $2)`, CounterTicketChannel,
		mustMarshalCounterTicketEvent(CounterTicketEvent{OrgID: orgID, TicketID: t.ID, Event: "created"})); err != nil {
		return nil, err
	}
	return t, nil
}

// mustMarshalCounterTicketEvent — CounterTicketEvent is our own small
// struct with no exotic fields, so a marshal failure here would be a
// programming error, not a runtime one worth plumbing an error return
// through pool.Exec's single-statement call site for.
func mustMarshalCounterTicketEvent(ev CounterTicketEvent) string {
	b, err := json.Marshal(ev)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// nullableJSON — pgx sends a nil json.RawMessage as SQL NULL only when
// the parameter itself is untyped nil, not an empty non-nil slice;
// normalizing here keeps the caller from having to know that.
func nullableJSON(b json.RawMessage) interface{} {
	if len(b) == 0 {
		return nil
	}
	return b
}

// ClaimCounterTicket is a clerk starting to serve a waiting ticket.
// Atomic on the status guard (`WHERE status = 'WAITING'`) so two
// clerks tapping "Serve" on the same ticket at once can't both win —
// exactly the shape BookParcel's own label-row `FOR UPDATE` lock
// protects against, just expressed as a single conditional UPDATE
// instead, since there's no separate lock-then-check step here.
//
// orgID scopes the UPDATE itself (`AND "orgId" = $3`), not a check
// after the fact — the same tenancy boundary every parcel-org-staff
// handler enforces via orgCtx (see handlers_parcel_orgs.go's own
// comment): a staffer can't claim a ticket that isn't their own
// company's even by guessing another company's ticket id.
func ClaimCounterTicket(ctx context.Context, pool *pgxpool.Pool, ticketID, staffID, orgID string) (*ParcelCounterTicket, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	t := &ParcelCounterTicket{ID: ticketID}
	var draft []byte
	err = tx.QueryRow(ctx, `
		UPDATE parcel_counter_ticket
		SET status = 'CLAIMED', "claimedByStaffId" = $2, "claimedAt" = now(), "updatedAt" = now()
		WHERE id = $1 AND status = 'WAITING' AND "orgId" = $3
		RETURNING "orgId", "serviceTicketNumber", msisdn, channel::text, status::text, "draftDetails", "claimedByStaffId", "claimedAt", "createdAt"`,
		ticketID, staffID, orgID).
		Scan(&t.OrgID, &t.ServiceTicketNumber, &t.Msisdn, &t.Channel, &t.Status, &draft, &t.ClaimedByStaffID, &t.ClaimedAt, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Either it never existed, or someone else already claimed (or
		// it expired) — both read as "not available to you" rather than
		// a 500. The caller distinguishes "gone" from "already claimed"
		// no further than that, same reasoning ScanHandoff's own
		// wasFirstIntake gate collapses a similar pair of cases.
		return nil, &ParcelError{"ALREADY_CLAIMED", "That ticket is no longer waiting"}
	}
	if err != nil {
		return nil, err
	}
	t.DraftDetails = draft
	if err := notifyCounterTicketEvent(ctx, tx, CounterTicketEvent{OrgID: t.OrgID, TicketID: t.ID, Event: "claimed"}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return t, nil
}

// CancelCounterTicket is a clerk discarding a ticket — a sender who
// never showed, or walked away mid-service. Same atomic-guard shape
// ClaimCounterTicket uses, just a wider WHERE: either WAITING (never
// claimed) or CLAIMED (claimed, abandoned before a parcel existed) can
// be discarded, but "parcelId" IS NULL is non-negotiable — once
// BookParcelFromCounterTicket has minted a real Parcel, abandoning it
// is that parcel's own cancellation flow to run, not this ticket's;
// letting this reach past that point would orphan a booked parcel with
// no ticket left pointing at it.
func CancelCounterTicket(ctx context.Context, pool *pgxpool.Pool, ticketID, staffID, orgID string, reason *string) (*ParcelCounterTicket, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	t := &ParcelCounterTicket{ID: ticketID}
	var draft []byte
	err = tx.QueryRow(ctx, `
		UPDATE parcel_counter_ticket
		SET status = 'CANCELLED', "cancelledByStaffId" = $2, "cancelledAt" = now(),
		    "cancelReason" = $3, "updatedAt" = now()
		WHERE id = $1 AND "orgId" = $4 AND status IN ('WAITING', 'CLAIMED') AND "parcelId" IS NULL
		RETURNING "orgId", "serviceTicketNumber", msisdn, channel::text, status::text, "draftDetails", "claimedByStaffId", "claimedAt", "createdAt"`,
		ticketID, staffID, reason, orgID).
		Scan(&t.OrgID, &t.ServiceTicketNumber, &t.Msisdn, &t.Channel, &t.Status, &draft, &t.ClaimedByStaffID, &t.ClaimedAt, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Gone, already settled by someone else, or already past
		// booking — collapsed to one message for the same reason
		// ClaimCounterTicket's own ALREADY_CLAIMED does.
		return nil, &ParcelError{"NOT_FOUND", "That ticket can no longer be discarded"}
	}
	if err != nil {
		return nil, err
	}
	t.DraftDetails = draft
	if err := notifyCounterTicketEvent(ctx, tx, CounterTicketEvent{OrgID: t.OrgID, TicketID: t.ID, Event: "cancelled"}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return t, nil
}

// CounterTicketBoard is everything the counter page paints in one
// round-trip: the live queue, and the cases already claimed by this
// company's clerks. The split matters — a refresh mid-service used to
// drop a CLAIMED ticket out of every screen in the product (the queue
// only ever asked for WAITING, and nothing anywhere asked for
// CLAIMED), so the board carries both lists and the client can put
// the serving panel back exactly where it was.
type CounterTicketBoard struct {
	Waiting []ParcelCounterTicket `json:"waiting"`
	Active  []ParcelCounterTicket `json:"active"`
}

// ListCounterTicketQueue — the clerk board's initial paint before its
// SSE stream takes over.
//
// Waiting: every WAITING ticket for the caller's own org, oldest first
// (see the model's own org/status/createdAt index).
//
// Active: every CLAIMED ticket the company has in flight — whoever
// claimed it — so one clerk refreshing (or closing the panel) never
// makes a case vanish for the whole desk. Includes the claimer's name,
// the caller's own `mine` flag, draftDetails (the panel's prefill on
// resume) and, where a booking already happened, the parcel's
// code/status/payment state so the client can reopen the panel at the
// step it was left on. Fully settled tickets are excluded: their
// parcel is paid, the case is closed, and ListCounterTicketHistory is
// where a closed case belongs.
func ListCounterTicketQueue(ctx context.Context, pool *pgxpool.Pool, orgID, staffID string) (*CounterTicketBoard, error) {
	waiting, err := listWaitingCounterTickets(ctx, pool, orgID)
	if err != nil {
		return nil, err
	}
	active, err := listActiveCounterTickets(ctx, pool, orgID, staffID)
	if err != nil {
		return nil, err
	}
	return &CounterTicketBoard{Waiting: waiting, Active: active}, nil
}

// listWaitingCounterTickets — see ListCounterTicketQueue.
func listWaitingCounterTickets(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]ParcelCounterTicket, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, "orgId", "serviceTicketNumber", msisdn, channel::text, status::text, "createdAt"
		FROM parcel_counter_ticket
		WHERE "orgId" = $1 AND status = 'WAITING'
		ORDER BY "createdAt" ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ParcelCounterTicket{}
	for rows.Next() {
		var t ParcelCounterTicket
		if err := rows.Scan(&t.ID, &t.OrgID, &t.ServiceTicketNumber, &t.Msisdn, &t.Channel, &t.Status, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// listActiveCounterTickets — see ListCounterTicketQueue. The two
// LEFT JOINs (staff, parcel) are outer because a claim always has a
// claimer but a booking may not have happened yet; mine/paymentPending
// are computed in SQL so the client never re-derives identity or
// payment state from a JSON payload it could misread.
func listActiveCounterTickets(ctx context.Context, pool *pgxpool.Pool, orgID, staffID string) ([]ParcelCounterTicket, error) {
	rows, err := pool.Query(ctx, `
		SELECT t.id, t."orgId", t."serviceTicketNumber", t.msisdn, t.channel::text, t.status::text,
		       t."draftDetails", t."claimedByStaffId", t."claimedAt", t."createdAt",
		       s.name, p.code, p.status::text, p."paidAt", p."priceKes"::text,
		       COALESCE(t."claimedByStaffId" = $2, false),
		       (p."paymentCheckoutRequestId" IS NOT NULL AND p."paidAt" IS NULL)
		FROM parcel_counter_ticket t
		LEFT JOIN parcel_org_staff s ON s.id = t."claimedByStaffId"
		LEFT JOIN parcel p ON p.id = t."parcelId"
		WHERE t."orgId" = $1 AND t.status = 'CLAIMED'
		  AND (t."parcelId" IS NULL OR p."paidAt" IS NULL)
		ORDER BY t."claimedAt" ASC NULLS FIRST`, orgID, staffID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ParcelCounterTicket{}
	for rows.Next() {
		var t ParcelCounterTicket
		var draft []byte
		var priceText *string
		if err := rows.Scan(&t.ID, &t.OrgID, &t.ServiceTicketNumber, &t.Msisdn, &t.Channel, &t.Status,
			&draft, &t.ClaimedByStaffID, &t.ClaimedAt, &t.CreatedAt,
			&t.ClaimedByName, &t.ParcelCode, &t.ParcelStatus, &t.ParcelPaidAt, &priceText,
			&t.Mine, &t.PaymentPending); err != nil {
			return nil, err
		}
		t.DraftDetails = draft
		// priceKes comes back as text (the convention every other
		// price read in this package follows — numeric straight into a
		// float is a pgx-version trap), for the settle step's prefill.
		if priceText != nil {
			if v, perr := strconv.ParseFloat(*priceText, 64); perr == nil {
				t.ParcelPriceKes = &v
			}
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListCounterTicketHistory — the counter's register of closed cases,
// newest first: discarded tickets (with the reason and the clerk who
// discarded them), aged-out ones, and tickets whose booking was
// actually paid — the completed end of a case. This is the record a
// discarded or finished ticket used to vanish from: CancelCounterTicket
// and the settle path only ever changed status, but no screen read a
// status other than WAITING, so the row survived in the database while
// disappearing from the product.
func ListCounterTicketHistory(ctx context.Context, pool *pgxpool.Pool, orgID string, limit int) ([]ParcelCounterTicket, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := pool.Query(ctx, `
		SELECT t.id, t."orgId", t."serviceTicketNumber", t.msisdn, t.channel::text, t.status::text,
		       t."createdAt", t."claimedAt", t."cancelledAt", t."cancelReason",
		       s.name, cs.name, p.code, p.status::text, p."paidAt"
		FROM parcel_counter_ticket t
		LEFT JOIN parcel_org_staff s ON s.id = t."claimedByStaffId"
		LEFT JOIN parcel_org_staff cs ON cs.id = t."cancelledByStaffId"
		LEFT JOIN parcel p ON p.id = t."parcelId"
		WHERE t."orgId" = $1
		  AND (t.status IN ('CANCELLED', 'EXPIRED')
		       OR (t."parcelId" IS NOT NULL AND p."paidAt" IS NOT NULL))
		ORDER BY t."createdAt" DESC
		LIMIT $2`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ParcelCounterTicket{}
	for rows.Next() {
		var t ParcelCounterTicket
		if err := rows.Scan(&t.ID, &t.OrgID, &t.ServiceTicketNumber, &t.Msisdn, &t.Channel, &t.Status,
			&t.CreatedAt, &t.ClaimedAt, &t.CancelledAt, &t.CancelReason,
			&t.ClaimedByName, &t.CancelledByStaffName, &t.ParcelCode, &t.ParcelStatus, &t.ParcelPaidAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ReleaseCounterTicket — a clerk handing an in-progress case back to
// the queue: WAITING again, claim cleared, draftDetails untouched so
// the next clerk still gets the same prefill. Deliberately narrower
// than CancelCounterTicket in both directions: only the clerk who
// holds the claim may release it (nobody else's case disappears from
// under them), and only while no parcel exists (past booking, the
// case has already become a parcel and "back in line" no longer means
// anything).
func ReleaseCounterTicket(ctx context.Context, pool *pgxpool.Pool, ticketID, staffID, orgID string) (*ParcelCounterTicket, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	t := &ParcelCounterTicket{ID: ticketID}
	var draft []byte
	err = tx.QueryRow(ctx, `
		UPDATE parcel_counter_ticket
		SET status = 'WAITING', "claimedByStaffId" = NULL, "claimedAt" = NULL, "updatedAt" = now()
		WHERE id = $1 AND "orgId" = $3 AND status = 'CLAIMED'
		  AND "claimedByStaffId" = $2 AND "parcelId" IS NULL
		RETURNING "orgId", "serviceTicketNumber", msisdn, channel::text, status::text, "draftDetails", "createdAt"`,
		ticketID, staffID, orgID).
		Scan(&t.OrgID, &t.ServiceTicketNumber, &t.Msisdn, &t.Channel, &t.Status, &draft, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That ticket can't be handed back to the queue"}
	}
	if err != nil {
		return nil, err
	}
	t.DraftDetails = draft
	if err := notifyCounterTicketEvent(ctx, tx, CounterTicketEvent{OrgID: t.OrgID, TicketID: t.ID, Event: "released"}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return t, nil
}

// GetCounterTicket — the id itself is the bearer credential, same
// convention a parcel tracking code follows: whoever holds the ticket
// id (from the kiosk/QR/app response) can poll or stream its own
// status, no separate login. Never exposes another ticket's row, since
// there's no query path that lists ids to guess from.
func GetCounterTicket(ctx context.Context, pool *pgxpool.Pool, id string) (*ParcelCounterTicket, error) {
	var t ParcelCounterTicket
	var draft []byte
	err := pool.QueryRow(ctx, `
		SELECT id, "orgId", "serviceTicketNumber", msisdn, channel::text, status::text, "draftDetails", "claimedAt", "createdAt"
		FROM parcel_counter_ticket WHERE id = $1`, id).
		Scan(&t.ID, &t.OrgID, &t.ServiceTicketNumber, &t.Msisdn, &t.Channel, &t.Status, &draft, &t.ClaimedAt, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.DraftDetails = draft
	return &t, nil
}

// UpdateCounterTicketDraft — the customer saving their own send-parcel
// form progress while they wait (see apps/web's SendParcelForm
// autosave). Only while still WAITING: once a clerk has claimed the
// ticket the intake screen owns the details from its own prefill, and
// a late autosave landing after that would silently overwrite what the
// clerk is now looking at.
func UpdateCounterTicketDraft(ctx context.Context, pool *pgxpool.Pool, id string, draftDetails json.RawMessage) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var orgID string
	err = tx.QueryRow(ctx, `
		UPDATE parcel_counter_ticket
		SET "draftDetails" = $2, "updatedAt" = now()
		WHERE id = $1 AND status = 'WAITING'
		RETURNING "orgId"`, id, nullableJSON(draftDetails)).
		Scan(&orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That ticket can no longer be updated"}
	}
	if err != nil {
		return err
	}
	if err := notifyCounterTicketEvent(ctx, tx, CounterTicketEvent{OrgID: orgID, TicketID: id, Event: "draft_updated"}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CounterTicketBookingInput is what the clerk confirmed at the "1.
// Confirm what the sender entered" step — the source of truth for the
// booking, not the ticket's own draftDetails (a prefill convenience
// only; see ServeTicketPanel). LabelCode, if set, is spent as the
// parcel's own tracking code via BookParcelInput.ExistingCode — the
// label the clerk just picked in the live search.
type CounterTicketBookingInput struct {
	SenderName             string
	SenderMsisdn           string
	ReceiverName           string
	ReceiverMsisdn         string
	ParcelType             string
	WeightKg               *float64
	DestinationLabel       string
	SenderDeclaredContents *string
	DeclaredValueKes       *float64
	LabelCode              *string
}

// BookParcelFromCounterTicket is the missing link between the walk-in
// queue and the parcel it was always meant to become: CreateCounterTicket
// and ClaimCounterTicket only ever touch parcel_counter_ticket, so a
// ticket's own TCK-… number has never resolved to anything
// ScanHandoff/receiveWalkInParcel could find — "receive" 404'd on every
// ticket that ever went through this queue. This runs once, right after
// the clerk confirms details and attaches a label, and reuses BookParcel
// itself (SELF_DROPOFF, PAY_AT_COUNTER) rather than re-deriving a second
// insert, so a counter-ticket booking is indistinguishable from any
// other PAY_AT_COUNTER walk-in once it exists.
//
// bookingStartedAt is claimed atomically before BookParcel runs — same
// reservation shape SettleCounterParcelStk's paymentReservationAt
// follows — so two requests racing a double-click can't both mint a
// parcel from the same ticket. Released on any failure so a retry
// isn't blocked by its own dead reservation.
func BookParcelFromCounterTicket(ctx context.Context, pool *pgxpool.Pool, ticketID, orgID, staffID string, in CounterTicketBookingInput) (parcelID, code, serviceTicketNumber string, err error) {
	if in.SenderName == "" || in.SenderMsisdn == "" {
		return "", "", "", &ParcelError{"BAD_INPUT", "Sender name and phone are required"}
	}
	if in.ReceiverName == "" || in.ReceiverMsisdn == "" {
		return "", "", "", &ParcelError{"BAD_INPUT", "Receiver name and phone are required"}
	}
	if in.DestinationLabel == "" {
		return "", "", "", &ParcelError{"BAD_INPUT", "Say where this is going"}
	}

	var ticketParcelID *string
	tag, terr := pool.Exec(ctx, `
		UPDATE parcel_counter_ticket
		SET "bookingStartedAt" = now()
		WHERE id = $1 AND "orgId" = $2 AND status = 'CLAIMED'
		  AND "claimedByStaffId" = $3 AND "parcelId" IS NULL AND "bookingStartedAt" IS NULL`,
		ticketID, orgID, staffID)
	if terr != nil {
		return "", "", "", terr
	}
	if tag.RowsAffected() == 0 {
		// Covers every reason this could be unavailable — already
		// booked, claimed by someone else, or a concurrent attempt
		// already holds the reservation — with one message, same
		// "gone vs. already claimed collapse no further" reasoning
		// ClaimCounterTicket's own comment gives.
		err = pool.QueryRow(ctx, `SELECT "parcelId" FROM parcel_counter_ticket WHERE id = $1`, ticketID).Scan(&ticketParcelID)
		if err == nil && ticketParcelID != nil {
			return "", "", "", &ParcelError{"ALREADY_BOOKED", "This ticket already has a parcel booked against it"}
		}
		return "", "", "", &ParcelError{"CONFLICT", "This ticket isn't ready to book — it may already be in progress"}
	}

	org, oerr := GetParcelOrg(ctx, pool, orgID)
	if oerr != nil {
		_, _ = pool.Exec(ctx, `UPDATE parcel_counter_ticket SET "bookingStartedAt" = NULL WHERE id = $1`, ticketID)
		return "", "", "", oerr
	}
	if org == nil {
		_, _ = pool.Exec(ctx, `UPDATE parcel_counter_ticket SET "bookingStartedAt" = NULL WHERE id = $1`, ticketID)
		return "", "", "", &ParcelError{"NOT_FOUND", "That company was not found"}
	}

	parcelType := in.ParcelType
	if parcelType == "" {
		parcelType = "SMALL"
	}
	parcelID, code, _, serviceTicketNumber, err = BookParcel(ctx, pool, BookParcelInput{
		SenderName: in.SenderName, SenderMsisdn: in.SenderMsisdn,
		ReceiverName: in.ReceiverName, ReceiverMsisdn: in.ReceiverMsisdn,
		OriginLabel: org.Name, DestinationLabel: in.DestinationLabel,
		ParcelType: parcelType, WeightKg: in.WeightKg,
		ParcelOrgID:               &orgID,
		OriginMethod:              "SELF_DROPOFF",
		PayAtCounter:              true,
		ExistingCode:              in.LabelCode,
		BinderOrgID:               &orgID,
		ContentsDeclaredByStaffID: &staffID,
		SenderDeclaredContents:    in.SenderDeclaredContents,
		DeclaredValueKes:          in.DeclaredValueKes,
		LawfulContentsAttested:    true,
	})
	if err != nil {
		_, _ = pool.Exec(ctx, `UPDATE parcel_counter_ticket SET "bookingStartedAt" = NULL WHERE id = $1`, ticketID)
		return "", "", "", err
	}

	if _, err := pool.Exec(ctx, `
		UPDATE parcel_counter_ticket SET "parcelId" = $1, "bookingStartedAt" = NULL WHERE id = $2`,
		parcelID, ticketID); err != nil {
		return parcelID, code, serviceTicketNumber, err
	}
	return parcelID, code, serviceTicketNumber, nil
}
