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

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var acceptsWalkIn bool
	err = tx.QueryRow(ctx, `SELECT "acceptsWalkIn" FROM parcel_org WHERE id = $1 AND status != 'SUSPENDED'`, orgID).
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

	t := &ParcelCounterTicket{
		OrgID:               orgID,
		ServiceTicketNumber: fleetqr.ShortCodeChecked(fleetqr.PrefixServiceTicket, 6),
		Msisdn:              msisdn,
		Channel:             channel,
		Status:              "WAITING",
		DraftDetails:        draftDetails,
	}
	if len(draftDetails) == 0 {
		t.DraftDetails = nil
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO parcel_counter_ticket (id, "orgId", "serviceTicketNumber", msisdn, channel, status, "draftDetails")
		VALUES (gen_random_uuid(), $1, $2, $3, $4::"ParcelCounterTicketChannel", 'WAITING', $5)
		RETURNING id, "createdAt"`,
		orgID, t.ServiceTicketNumber, msisdn, channel, nullableJSON(t.DraftDetails)).
		Scan(&t.ID, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	if err := notifyCounterTicketEvent(ctx, tx, CounterTicketEvent{OrgID: orgID, TicketID: t.ID, Event: "created"}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return t, nil
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

// ListWaitingCounterTickets — the clerk queue's initial paint before
// its SSE stream takes over: every WAITING ticket for the caller's own
// org, oldest first (see the model's own org/status/createdAt index).
func ListWaitingCounterTickets(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]ParcelCounterTicket, error) {
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
