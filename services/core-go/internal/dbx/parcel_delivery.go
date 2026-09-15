// Package dbx (parcel_delivery.go) — what happens when a delivery
// doesn't simply succeed.
//
// Before this file existed the parcel lifecycle had exactly one way out
// of a courier's hands: DeliverParcel, gated on the receiver producing
// their delivery code. Everything else — nobody home, wrong address,
// receiver refuses, receiver lost the code — had no representation at
// all. The courier kept holding the parcel, it silently aged past
// slaDeadlineAt, and it surfaced in the admin's overdueDeliveries KPI
// as a courier failure when it was usually a receiver-side problem.
//
// The three exits added here are all non-destructive and all keep the
// custody chain honest: an attempt records evidence without moving
// custody, an agent drop moves custody to a shop, a return moves the
// parcel back the way it came and closes it.
package dbx

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ValidAttemptReasons — the reason codes a courier picks from. Not an
// enum in the database for the same reason CourierTeamMember.role
// isn't: this list grows by a string far more often than it needs a
// migration. OTHER always requires a note (see RecordDeliveryAttempt) —
// the same "any Other choice needs a paired free-text field" rule this
// codebase applies to every other dropdown.
var ValidAttemptReasons = []string{
	"NOBODY_HOME",
	"WRONG_ADDRESS",
	"REFUSED",
	"NO_DELIVERY_CODE",
	"UNREACHABLE",
	"OTHER",
}

func isValidAttemptReason(r string) bool {
	for _, v := range ValidAttemptReasons {
		if v == r {
			return true
		}
	}
	return false
}

// AttemptReasonText — the human sentence that goes into the receiver's
// SMS. Kept beside the codes rather than in the notify package because
// this is the domain's own vocabulary; notify formats messages, it
// doesn't decide what a reason code means.
func AttemptReasonText(reason string, note *string) string {
	switch reason {
	case "NOBODY_HOME":
		return "nobody was there to receive it"
	case "WRONG_ADDRESS":
		return "the address couldn't be found"
	case "REFUSED":
		return "it was turned away at the door"
	case "NO_DELIVERY_CODE":
		return "the delivery code couldn't be confirmed"
	case "UNREACHABLE":
		return "we couldn't reach you by phone"
	default:
		if note != nil && strings.TrimSpace(*note) != "" {
			return strings.TrimSpace(*note)
		}
		return "the delivery couldn't be completed"
	}
}

// DeliveryAttempt — one row of the append-only attempt log.
type DeliveryAttempt struct {
	ID         string   `json:"id"`
	Reason     string   `json:"reason"`
	ReasonText string   `json:"reasonText"`
	Note       *string  `json:"note"`
	ByName     *string  `json:"byName"`
	Lat        *float64 `json:"lat"`
	Lng        *float64 `json:"lng"`
	CreatedAt  string   `json:"createdAt"`
}

// RecordDeliveryAttempt logs a failed doorstep attempt and parks the
// parcel in FAILED_DELIVERY.
//
// Custody is deliberately NOT moved: the courier still physically has
// the parcel, and pretending otherwise would break the one invariant
// the whole handoff chain rests on (currentHolderPartyId is whoever can
// actually put their hands on it). That's also why only the current
// holder may call this — a courier who never took custody has nothing
// to fail at, and letting them log an attempt would let anyone holding
// a tracking code manufacture evidence about someone else's parcel.
//
// Returns the running attempt count so the caller can escalate its SMS
// copy — a third failure is a different conversation from a first.
func RecordDeliveryAttempt(ctx context.Context, pool *pgxpool.Pool, code, byPartyID, reason string, note *string, lat, lng *float64) (attempts int, err error) {
	if byPartyID == "" {
		return 0, &ParcelError{"FORBIDDEN", "Sign in to record a delivery attempt"}
	}
	if !isValidAttemptReason(reason) {
		return 0, &ParcelError{"BAD_INPUT", "Pick a valid reason for the failed attempt"}
	}
	if reason == "OTHER" && (note == nil || strings.TrimSpace(*note) == "") {
		return 0, &ParcelError{"BAD_INPUT", "Describe what happened when choosing Other"}
	}

	var parcelID, status string
	var currentHolder *string
	err = pool.QueryRow(ctx, `
		SELECT id, status::text, "currentHolderPartyId" FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &status, &currentHolder)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return 0, err
	}
	if status == "DELIVERED" {
		return 0, &ParcelError{"ALREADY_DELIVERED", "This parcel has already been delivered"}
	}
	if status != "PICKED_UP" && status != "IN_TRANSIT" && status != "FAILED_DELIVERY" {
		return 0, &ParcelError{"BAD_INPUT", "This parcel isn't out for delivery"}
	}
	if currentHolder == nil || *currentHolder != byPartyID {
		return 0, &ParcelError{"FORBIDDEN", "You aren't holding this parcel"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		INSERT INTO parcel_delivery_attempt (id, "parcelId", "byPartyId", reason, note, lat, lng, "createdAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())`,
		parcelID, byPartyID, reason, note, lat, lng); err != nil {
		return 0, err
	}
	if err := tx.QueryRow(ctx, `
		UPDATE parcel SET
			status = 'FAILED_DELIVERY',
			"deliveryAttempts" = "deliveryAttempts" + 1,
			"lastAttemptAt" = now(),
			"lastAttemptReason" = $1
		WHERE id = $2
		RETURNING "deliveryAttempts"`, reason, parcelID).Scan(&attempts); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return attempts, nil
}

// ListDeliveryAttempts — the attempt log for one parcel, oldest first,
// with the courier's name resolved the same way ListParcelHandoffs
// resolves its own. Three attempts with three different reasons is a
// very different conversation with a receiver than one, which is
// exactly what the denormalised lastAttempt* columns can't tell you.
func ListDeliveryAttempts(ctx context.Context, pool *pgxpool.Pool, parcelID string) ([]DeliveryAttempt, error) {
	rows, err := pool.Query(ctx, `
		SELECT a.id, a.reason, a.note, COALESCE(pr."knownAs", pr."officialName"),
		       a.lat::text, a.lng::text, to_char(a."createdAt", 'YYYY-MM-DD"T"HH24:MI:SSZ')
		FROM parcel_delivery_attempt a
		LEFT JOIN person pr ON pr."partyId" = a."byPartyId"
		WHERE a."parcelId" = $1
		ORDER BY a."createdAt" ASC`, parcelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DeliveryAttempt
	for rows.Next() {
		var a DeliveryAttempt
		var latText, lngText *string
		if err := rows.Scan(&a.ID, &a.Reason, &a.Note, &a.ByName, &latText, &lngText, &a.CreatedAt); err != nil {
			return nil, err
		}
		if latText != nil {
			if v, err := parseFloatOrZero(*latText); err == nil {
				a.Lat = &v
			}
		}
		if lngText != nil {
			if v, err := parseFloatOrZero(*lngText); err == nil {
				a.Lng = &v
			}
		}
		a.ReasonText = AttemptReasonText(a.Reason, a.Note)
		out = append(out, a)
	}
	return out, rows.Err()
}

// CourierPosition is the one thing a tracking page can honestly show
// about a parcel in motion: where it is, and how fresh that is.
//
// Deliberately anonymous — no courier name, no vehicle, no id. The
// tracking code is a bearer credential held by the sender and the
// receiver, and "your parcel is here" is what they're entitled to;
// "this named person is at these coordinates" is not, and is a live
// location feed for anyone who ever saw the code.
type CourierPosition struct {
	Lat       float64   `json:"lat"`
	Lng       float64   `json:"lng"`
	At        time.Time `json:"at"`
	StaleMins int       `json:"staleMins"`
}

// courierPositionMaxAgeMins — a ping older than this is not reported at
// all. A stale dot on a map is worse than no dot: it reads as "the
// courier has been parked outside for an hour" when the real answer is
// that their phone stopped reporting, and it invites exactly the phone
// call the tracking page exists to prevent.
const courierPositionMaxAgeMins = 20

// GetParcelCourierPosition — the live position of whoever is carrying
// [code], or nil.
//
// Returns nil unless the parcel is genuinely moving (PICKED_UP or
// IN_TRANSIT). A parcel sitting on an agent's shelf has a location
// already shown as a shop address, and a delivered one has no business
// still broadcasting where its courier went next.
func GetParcelCourierPosition(ctx context.Context, pool *pgxpool.Pool, code string) (*CourierPosition, error) {
	var pos CourierPosition
	var latText, lngText string
	err := pool.QueryRow(ctx, `
		SELECT ping.lat::text, ping.lng::text, ping.at
		FROM parcel p
		JOIN LATERAL (
			SELECT lat, lng, at FROM parcel_courier_ping
			WHERE "courierPartyId" = p."currentHolderPartyId"
			ORDER BY at DESC LIMIT 1
		) ping ON true
		WHERE p.code = $1
		  AND p.status IN ('PICKED_UP', 'IN_TRANSIT')
		  AND ping.at > now() - make_interval(mins => $2)`, code, courierPositionMaxAgeMins).
		Scan(&latText, &lngText, &pos.At)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if pos.Lat, err = parseFloatOrZero(latText); err != nil {
		return nil, err
	}
	if pos.Lng, err = parseFloatOrZero(lngText); err != nil {
		return nil, err
	}
	pos.StaleMins = int(time.Since(pos.At).Minutes())
	return &pos, nil
}

// AgentDropResult is what the caller needs to tell the receiver where
// to walk to — the whole point of the agent leg is that the receiver
// gets an address and opening hours, not just a status change.
type AgentDropResult struct {
	AgentName     string
	AgentMsisdn   string
	LocationHint  string
	OpeningHours  *string
	HoldingFeeKes float64
}

// HoldParcelAtAgent moves a parcel onto a pickup point's shelf.
//
// Custody transfers to the agent's own Party when it has one, recorded
// as a real parcel_handoff row — an agent holding stock is a link in
// the custody chain exactly like a courier is, not a special case. When
// the shop has no Esoqo account yet (ops routinely onboard a location
// before its owner signs up, see ParcelAgent.partyId), custody stays
// with the dropping courier and only the status moves: better an
// honest "this courier is accountable, the parcel is at that shop" than
// a chain that points at nobody.
//
// Capacity is checked inside the transaction, not before it — two
// couriers dropping the last slot at the same shop is exactly the race
// a pre-flight check loses.
func HoldParcelAtAgent(ctx context.Context, pool *pgxpool.Pool, code, agentID, byPartyID string) (*AgentDropResult, error) {
	if byPartyID == "" {
		return nil, &ParcelError{"FORBIDDEN", "Sign in to drop a parcel at a pickup point"}
	}
	var parcelID, status string
	var currentHolder *string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "currentHolderPartyId" FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &status, &currentHolder)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return nil, err
	}
	if status == "DELIVERED" {
		return nil, &ParcelError{"ALREADY_DELIVERED", "This parcel has already been delivered"}
	}
	if status != "PICKED_UP" && status != "IN_TRANSIT" && status != "FAILED_DELIVERY" {
		return nil, &ParcelError{"BAD_INPUT", "This parcel isn't out for delivery"}
	}
	if currentHolder == nil || *currentHolder != byPartyID {
		return nil, &ParcelError{"FORBIDDEN", "You aren't holding this parcel"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var res AgentDropResult
	var agentPartyID *string
	var capacity, held int
	var feeText string
	var agentActive bool
	err = tx.QueryRow(ctx, `
		SELECT a.name, a.msisdn, a."locationHint", a."openingHours", a."holdingFeeKes"::text,
		       a."partyId"::text, a.capacity, a.active,
		       (SELECT count(*) FROM parcel p WHERE p."destinationAgentId" = a.id AND p.status = 'HELD_AT_AGENT')
		FROM parcel_agent a WHERE a.id = $1 FOR UPDATE`, agentID).
		Scan(&res.AgentName, &res.AgentMsisdn, &res.LocationHint, &res.OpeningHours, &feeText,
			&agentPartyID, &capacity, &agentActive, &held)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That pickup point was not found"}
	}
	if err != nil {
		return nil, err
	}
	// Checked here rather than filtered out of the query so a courier
	// standing in a shop that was deactivated mid-round gets told why,
	// instead of the same "not found" a typo'd id produces.
	if !agentActive {
		return nil, &ParcelError{"BAD_INPUT", "That pickup point is no longer taking parcels"}
	}
	if held >= capacity {
		return nil, &ParcelError{"BAD_INPUT", "That pickup point is full — pick another one"}
	}
	if res.HoldingFeeKes, err = parseFloatOrZero(feeText); err != nil {
		return nil, err
	}

	newHolder := byPartyID
	if agentPartyID != nil && *agentPartyID != "" {
		newHolder = *agentPartyID
	}
	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET status = 'HELD_AT_AGENT', "destinationAgentId" = $1,
		                  "currentHolderPartyId" = $2, "agentHeldSince" = now()
		WHERE id = $3`, agentID, newHolder, parcelID); err != nil {
		return nil, err
	}
	if newHolder != byPartyID {
		if _, err := tx.Exec(ctx, `
			INSERT INTO parcel_handoff (id, "parcelId", "fromPartyId", "toPartyId", "createdAt")
			VALUES (gen_random_uuid(), $1, $2, $3, now())`, parcelID, byPartyID, newHolder); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &res, nil
}

// ReturnParcelToSender is the give-up path out of FAILED_DELIVERY or
// HELD_AT_AGENT. Terminal, and deliberately distinct from CANCELLED:
// the journey happened and was billed, it just ended at the origin
// instead of the destination — collapsing the two would quietly corrupt
// revenue reporting, which counts every non-CANCELLED paid parcel.
//
// Only a current holder or dispatch staff closes a parcel this way;
// staffID being set is how the caller signals the latter (a staff
// member returning a parcel that a courier abandoned is a real
// operational need, and there's nobody else to do it).
func ReturnParcelToSender(ctx context.Context, pool *pgxpool.Pool, code, byPartyID, reason string, isStaff bool) error {
	if strings.TrimSpace(reason) == "" {
		return &ParcelError{"BAD_INPUT", "Say why this parcel is going back"}
	}
	var parcelID, status string
	var currentHolder *string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text, "currentHolderPartyId" FROM parcel WHERE code = $1`, code).
		Scan(&parcelID, &status, &currentHolder)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if status == "DELIVERED" {
		return &ParcelError{"ALREADY_DELIVERED", "This parcel has already been delivered"}
	}
	if status != "FAILED_DELIVERY" && status != "HELD_AT_AGENT" && status != "IN_TRANSIT" {
		return &ParcelError{"BAD_INPUT", "Only a parcel that couldn't be delivered can be returned"}
	}
	if !isStaff && (currentHolder == nil || *currentHolder != byPartyID) {
		return &ParcelError{"FORBIDDEN", "You aren't holding this parcel"}
	}
	_, err = pool.Exec(ctx, `
		UPDATE parcel SET status = 'RETURNED_TO_SENDER', "lastAttemptReason" = $1, "lastAttemptAt" = now()
		WHERE id = $2`, reason, parcelID)
	return err
}
