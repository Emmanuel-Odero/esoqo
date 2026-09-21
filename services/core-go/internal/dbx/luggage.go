package dbx

// Passenger luggage — tagging a bag onto a trip, and handing it back.
//
// The shape of this file is dictated by one number: forty bags in three
// minutes, at a stage, in the dark, on a handset with no signal. Every
// call here is therefore single-round-trip, takes the smallest input
// that can possibly identify the act, and never requires a prior read
// to succeed. Anything that would make a conductor wait is wrong here
// even if it would be right in the parcel domain, where the unit of
// work is one box across a morning at a desk.
//
// On why this is not the parcel code: see LuggageTag's schema comment.
// The short version is that a bag's receiver is the person who handed
// it over, its custody is a bracket rather than a chain, and its
// dominant failure is being taken by the wrong passenger at an
// intermediate stage — none of which the parcel status machine models.

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoqo/core-go/internal/authsvc"
	"github.com/esoqo/core-go/internal/fleetqr"
)

// LuggageError mirrors FleetError/ParcelError: a code the UI can branch
// on, and a message a crew member can read at arm's length.
type LuggageError struct {
	Code    string // NOT_FOUND | BAD_INPUT | TRIP_CLOSED | ALREADY_CLAIMED | DENIED
	Message string
}

func (e *LuggageError) Error() string { return e.Message }

// mintRetries — how many times a code collision is re-rolled before
// giving up. The space is 31^6; this is a formality, kept because
// "formality" is what every other minting path in this service assumes
// and a silent duplicate-key error at a stage is not recoverable by the
// person holding the bag.
const mintRetries = 5

// maxPieces — the ceiling on a single passenger's piece count.
//
// Not a policy on how much luggage anyone may carry; a guard on a
// tap-and-hold "+" button that would otherwise let a slipped finger
// mint two hundred tags and a two-hundred-line close-out. A genuine
// twenty-piece consignment is not passenger luggage, it is freight, and
// the parcel domain already handles it properly.
const maxPieces = 20

// LuggageTag is one bag, as every surface here reads it.
//
// Flat strings rather than nested structs: this crosses the wire to a
// conductor's handset, where the whole object is rendered as four lines
// of text, and a shape that maps one-to-one onto those lines is one
// fewer thing to get wrong at 5am.
type LuggageTag struct {
	ID               string  `json:"id"`
	Code             string  `json:"code"`
	TripID           string  `json:"tripId"`
	OrgID            string  `json:"orgId"`
	TicketID         *string `json:"ticketId,omitempty"`
	PassengerName    string  `json:"passengerName"`
	PassengerMsisdn  *string `json:"passengerMsisdn,omitempty"`
	PieceNo          int     `json:"pieceNo"`
	PieceCount       int     `json:"pieceCount"`
	GroupID          *string `json:"groupId,omitempty"`
	DropStageID      *string `json:"dropStageId,omitempty"`
	DestinationLabel string  `json:"destinationLabel"`
	WeightKg         *string `json:"weightKg,omitempty"`
	ExcessFeeKes     *string `json:"excessFeeKes,omitempty"`
	PhotoURL         *string `json:"photoUrl,omitempty"`
	Status           string  `json:"status"`
	BoardedAt        *string `json:"boardedAt,omitempty"`
	ClaimedAt        *string `json:"claimedAt,omitempty"`
	ClaimMethod      *string `json:"claimMethod,omitempty"`
	CreatedAt        string  `json:"createdAt"`
}

const luggageSelect = `
	SELECT id::text, code, "tripId"::text, "orgId"::text, "ticketId"::text,
	       "passengerName", "passengerMsisdn", "pieceNo", "pieceCount",
	       "groupId"::text, "dropStageId"::text, "destinationLabel",
	       "weightKg"::text, "excessFeeKes"::text, "photoUrl", status::text,
	       "boardedAt"::text, "claimedAt"::text, "claimMethod"::text, "createdAt"::text
	FROM luggage_tag`

func scanLuggage(row pgx.Row) (*LuggageTag, error) {
	var t LuggageTag
	err := row.Scan(&t.ID, &t.Code, &t.TripID, &t.OrgID, &t.TicketID,
		&t.PassengerName, &t.PassengerMsisdn, &t.PieceNo, &t.PieceCount,
		&t.GroupID, &t.DropStageID, &t.DestinationLabel,
		&t.WeightKg, &t.ExcessFeeKes, &t.PhotoURL, &t.Status,
		&t.BoardedAt, &t.ClaimedAt, &t.ClaimMethod, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// tripForLuggage resolves the trip's org and open/closed state in one
// query, so every entry point below can authorise against the org that
// actually owns the trip rather than one the caller named.
//
// That distinction is the whole reason this exists as a helper: taking
// an orgID from the request body and trusting it would let a crew
// member with a legitimate grant on org A tag bags onto org B's
// vehicle. The trip is the only fact the caller supplies, and the org
// is derived from it.
func tripForLuggage(ctx context.Context, pool *pgxpool.Pool, tripID string) (orgID, status string, err error) {
	err = pool.QueryRow(ctx,
		`SELECT "orgId"::text, status::text FROM trip WHERE id = $1`, tripID).
		Scan(&orgID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", &LuggageError{"NOT_FOUND", "That trip does not exist"}
	}
	return orgID, status, err
}

// TagLuggageInput — everything the boarding flow can know about a bag.
//
// Only three fields are required (trip, passenger name, destination),
// and one of those is a single tap from a chip row. That is deliberate:
// the flow this serves has one typed field at most, because typing is
// what a conductor with forty bags does not have time for.
type TagLuggageInput struct {
	TripID           string  `json:"tripId"`
	TicketID         *string `json:"ticketId"`
	PassengerName    string  `json:"passengerName"`
	PassengerMsisdn  *string `json:"passengerMsisdn"`
	PieceCount       int     `json:"pieceCount"`
	DropStageID      *string `json:"dropStageId"`
	DestinationLabel string  `json:"destinationLabel"`
	WeightKg         *string `json:"weightKg"`
	ExcessFeeKes     *string `json:"excessFeeKes"`
	PhotoURL         *string `json:"photoUrl"`
	/// A pre-printed LUG- pad code, when the crew is working off stock
	/// rather than minting. Same idempotency property pre-printed parcel
	/// stock has: the sticker is physically in one person's hand, so the
	/// code is a natural key for an offline replay.
	ExistingCodes []string `json:"existingCodes"`
}

// TagLuggage creates every piece of one passenger's luggage in a single
// transaction and returns the tags in piece order.
//
// All pieces at once, not one call per bag, for two reasons that both
// come back to the same three minutes. First, "2 of 3" is only true if
// all three exist — minting them separately means a window in which the
// printed tags contradict the database. Second, it is one round trip
// instead of three on a connection that may not survive the second.
//
// Boarding state is NOT set here. Tagging and boarding are separate
// acts — a bag can be tagged at a desk and carried out to the vehicle —
// and collapsing them would lose the distinction between "we wrote a
// label" and "it is physically on the bus", which is exactly the
// distinction the close-out sweep depends on.
func TagLuggage(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, in TagLuggageInput) ([]*LuggageTag, error) {
	orgID, tripStatus, err := tripForLuggage(ctx, pool, in.TripID)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapLuggageTag); err != nil {
		return nil, err
	}
	if tripStatus != "ACTIVE" {
		// A closed trip has already had its unclaimed sweep run. Adding a
		// bag afterwards would create one that no close-out will ever
		// look at.
		return nil, &LuggageError{"TRIP_CLOSED", "That trip is closed — start a new one before tagging bags"}
	}

	name := strings.TrimSpace(in.PassengerName)
	if name == "" {
		return nil, &LuggageError{"BAD_INPUT", "Whose bag is it?"}
	}
	dest := strings.TrimSpace(in.DestinationLabel)
	if dest == "" {
		return nil, &LuggageError{"BAD_INPUT", "Where does it come off?"}
	}
	pieces := in.PieceCount
	if pieces <= 0 {
		pieces = 1
	}
	if pieces > maxPieces {
		return nil, &LuggageError{"BAD_INPUT", fmt.Sprintf("More than %d pieces is freight, not luggage — book it as a parcel", maxPieces)}
	}
	if n := len(in.ExistingCodes); n > 0 && n != pieces {
		return nil, &LuggageError{"BAD_INPUT", "Scan one pre-printed tag per piece, or none at all"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// A group id only for genuinely multi-piece luggage: on a single bag
	// it would be a column that says nothing, and the claim screen's
	// "anything else still aboard?" lookup already treats null as "no
	// siblings" rather than as a missing value.
	//
	// Generated by Postgres rather than in Go, because every uuid in
	// this schema is (gen_random_uuid() is the column default
	// everywhere), and hand-rolling one here to avoid a round trip
	// inside a transaction we are already in would be inventing a second
	// source of identifiers for no gain.
	var groupID *string
	if pieces > 1 {
		var g string
		if err := tx.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&g); err != nil {
			return nil, err
		}
		groupID = &g
	}

	out := make([]*LuggageTag, 0, pieces)
	for i := 1; i <= pieces; i++ {
		var tag *LuggageTag
		var insErr error
		if len(in.ExistingCodes) > 0 {
			code := strings.ToUpper(strings.TrimSpace(in.ExistingCodes[i-1]))
			if code == "" {
				return nil, &LuggageError{"BAD_INPUT", "One of the scanned tags was blank"}
			}
			tag, insErr = insertLuggage(ctx, tx, orgID, groupID, i, pieces, code, name, dest, in)
			if isUniqueViolation(insErr) {
				// A pre-printed tag already in use. Unlike a minted code
				// this is not a collision to retry past — the physical
				// sticker is on another bag, and re-rolling would silently
				// tag this one with a different code than the one stuck to
				// it. Same "the code on the sticker is the key" reasoning
				// the offline counter queue relies on for parcels.
				return nil, &LuggageError{"LABEL_ALREADY_SPENT", "Tag " + code + " is already on another bag"}
			}
		} else {
			// Minted codes: re-roll on the vanishingly rare collision, in
			// the same transaction, exactly as every other short-code
			// mint in this service does.
			for attempt := 0; attempt < mintRetries; attempt++ {
				code := fleetqr.ShortCodeChecked(fleetqr.PrefixLuggage, fleetqr.LuggageCodeLen)
				tag, insErr = insertLuggage(ctx, tx, orgID, groupID, i, pieces, code, name, dest, in)
				if !isUniqueViolation(insErr) {
					break
				}
			}
		}
		if insErr != nil {
			return nil, insErr
		}
		out = append(out, tag)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

func insertLuggage(
	ctx context.Context, tx pgx.Tx,
	orgID string, groupID *string, pieceNo, pieceCount int,
	code, name, dest string, in TagLuggageInput,
) (*LuggageTag, error) {
	return scanLuggage(tx.QueryRow(ctx, `
		INSERT INTO luggage_tag (
			code, "tripId", "orgId", "ticketId", "passengerName", "passengerMsisdn",
			"pieceNo", "pieceCount", "groupId", "dropStageId", "destinationLabel",
			"weightKg", "excessFeeKes", "photoUrl"
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::decimal,$13::decimal,$14)
		RETURNING id::text, code, "tripId"::text, "orgId"::text, "ticketId"::text,
		          "passengerName", "passengerMsisdn", "pieceNo", "pieceCount",
		          "groupId"::text, "dropStageId"::text, "destinationLabel",
		          "weightKg"::text, "excessFeeKes"::text, "photoUrl", status::text,
		          "boardedAt"::text, "claimedAt"::text, "claimMethod"::text, "createdAt"::text`,
		code, in.TripID, orgID, in.TicketID, name, in.PassengerMsisdn,
		pieceNo, pieceCount, groupID, in.DropStageID, dest,
		in.WeightKg, in.ExcessFeeKes, in.PhotoURL))
}

// BoardLuggage — the scan that puts a tagged bag physically on board.
//
// Idempotent by design: boarding an already-ABOARD bag succeeds and
// returns it unchanged rather than erroring. That is what makes this
// safe to replay from an offline queue, and it is also just correct at
// the stage — a conductor who scans the same tag twice because the
// first beep was lost in traffic has not made a mistake worth stopping
// for.
func BoardLuggage(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, code string) (*LuggageTag, error) {
	tag, orgID, err := luggageByCode(ctx, pool, code)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapLuggageTag); err != nil {
		return nil, err
	}
	switch tag.Status {
	case "ABOARD":
		return tag, nil // already done — see the function comment
	case "CLAIMED":
		return nil, &LuggageError{"ALREADY_CLAIMED", "That bag was already handed back"}
	}
	crewID, _ := crewMemberIDForLuggage(ctx, pool, c, orgID)
	return scanLuggage(pool.QueryRow(ctx, `
		UPDATE luggage_tag
		   SET status = 'ABOARD', "boardedAt" = now(), "boardedByCrewId" = $2,
		       "updatedAt" = now()
		 WHERE id = $1
		RETURNING id::text, code, "tripId"::text, "orgId"::text, "ticketId"::text,
		          "passengerName", "passengerMsisdn", "pieceNo", "pieceCount",
		          "groupId"::text, "dropStageId"::text, "destinationLabel",
		          "weightKg"::text, "excessFeeKes"::text, "photoUrl", status::text,
		          "boardedAt"::text, "claimedAt"::text, "claimMethod"::text, "createdAt"::text`,
		tag.ID, nullIfEmpty(crewID)))
}

// ClaimLuggageInput — handing a bag back.
type ClaimLuggageInput struct {
	Code           string  `json:"code"`
	Method         string  `json:"method"`
	OverrideReason *string `json:"overrideReason"`
}

var validClaimMethods = map[string]bool{
	"STUB_SCAN": true, "CODE_TYPED": true, "TICKET_MATCH": true, "OVERRIDE": true,
}

// LuggageClaimResult is the claim plus the one extra fact the crew
// needs at that exact moment: what else this passenger checked in and
// whether it is still on the vehicle.
//
// Returned together rather than left to a second call because the
// moment has no room for one — the passenger is at the door and the bus
// is moving on. "2 of 3, one still aboard" has to be on screen with the
// green tick, not a tap away.
type LuggageClaimResult struct {
	Tag *LuggageTag `json:"tag"`
	/// The passenger's other pieces, if any, in piece order.
	Siblings []*LuggageTag `json:"siblings"`
	/// How many of those are still ABOARD. Zero for a single bag.
	SiblingsStillAboard int `json:"siblingsStillAboard"`
}

// ClaimLuggage records a handover.
//
// The OVERRIDE path is the interesting one. A crew member releasing a
// bag to someone who cannot produce the stub is a real and recurring
// event — a torn stub, a dead phone, a passenger who put it in the bag
// that is now in front of them. Refusing it would not stop the handover;
// it would stop the handover being *recorded*, which is strictly worse.
// So it is allowed, it demands a reason, and it surfaces on the trip's
// close-out. A month of override reasons is the best list anyone will
// get of what to fix next.
func ClaimLuggage(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, in ClaimLuggageInput) (*LuggageClaimResult, error) {
	tag, orgID, err := luggageByCode(ctx, pool, in.Code)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapLuggageClaim); err != nil {
		return nil, err
	}
	method := strings.ToUpper(strings.TrimSpace(in.Method))
	if !validClaimMethods[method] {
		return nil, &LuggageError{"BAD_INPUT", "How was this bag identified? Scan the stub, type the code, match a ticket, or record an override"}
	}
	reason := ""
	if in.OverrideReason != nil {
		reason = strings.TrimSpace(*in.OverrideReason)
	}
	if method == "OVERRIDE" && reason == "" {
		return nil, &LuggageError{"BAD_INPUT", "Say why this bag is going out without its stub"}
	}
	if method != "OVERRIDE" {
		// A reason on a normal claim would be a note nobody reads on a
		// row nobody reviews; dropped rather than stored so "has a
		// reason" stays synonymous with "was an override".
		reason = ""
	}
	if tag.Status == "CLAIMED" {
		// Not an error the crew can act on — the bag is gone and saying
		// so is more useful than a failure. Returned with its siblings so
		// the screen still answers "is anything else still aboard?".
		sib, aboard, err := luggageSiblings(ctx, pool, tag)
		if err != nil {
			return nil, err
		}
		return &LuggageClaimResult{Tag: tag, Siblings: sib, SiblingsStillAboard: aboard}, nil
	}

	crewID, _ := crewMemberIDForLuggage(ctx, pool, c, orgID)
	updated, err := scanLuggage(pool.QueryRow(ctx, `
		UPDATE luggage_tag
		   SET status = 'CLAIMED', "claimedAt" = now(), "claimedByCrewId" = $2,
		       "claimMethod" = $3::"LuggageClaimMethod",
		       "claimOverrideReason" = $4, "updatedAt" = now()
		 WHERE id = $1
		RETURNING id::text, code, "tripId"::text, "orgId"::text, "ticketId"::text,
		          "passengerName", "passengerMsisdn", "pieceNo", "pieceCount",
		          "groupId"::text, "dropStageId"::text, "destinationLabel",
		          "weightKg"::text, "excessFeeKes"::text, "photoUrl", status::text,
		          "boardedAt"::text, "claimedAt"::text, "claimMethod"::text, "createdAt"::text`,
		tag.ID, nullIfEmpty(crewID), method, nullIfEmpty(reason)))
	if err != nil {
		return nil, err
	}
	sib, aboard, err := luggageSiblings(ctx, pool, updated)
	if err != nil {
		return nil, err
	}
	return &LuggageClaimResult{Tag: updated, Siblings: sib, SiblingsStillAboard: aboard}, nil
}

// luggageSiblings — the passenger's other pieces and how many are still
// on the vehicle. The second return value is what the claim screen puts
// next to the green tick.
func luggageSiblings(ctx context.Context, pool *pgxpool.Pool, tag *LuggageTag) ([]*LuggageTag, int, error) {
	if tag.GroupID == nil {
		return []*LuggageTag{}, 0, nil
	}
	rows, err := pool.Query(ctx, luggageSelect+`
		WHERE "groupId" = $1 AND id <> $2 ORDER BY "pieceNo"`, *tag.GroupID, tag.ID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*LuggageTag{}
	aboard := 0
	for rows.Next() {
		t, err := scanLuggage(rows)
		if err != nil {
			return nil, 0, err
		}
		if t.Status == "ABOARD" || t.Status == "TAGGED" {
			aboard++
		}
		out = append(out, t)
	}
	return out, aboard, rows.Err()
}

// ListTripLuggage — everything tagged onto a trip, in the order a crew
// member works through it: by drop stage, then by passenger, then by
// piece. The same "sorted the way the job is done, not the way the rows
// were written" rule GetTripManifest already follows for parcels.
func ListTripLuggage(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, tripID string) ([]*LuggageTag, error) {
	orgID, _, err := tripForLuggage(ctx, pool, tripID)
	if err != nil {
		return nil, err
	}
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapLuggageRead); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT l.id::text, l.code, l."tripId"::text, l."orgId"::text, l."ticketId"::text,
		       l."passengerName", l."passengerMsisdn", l."pieceNo", l."pieceCount",
		       l."groupId"::text, l."dropStageId"::text, l."destinationLabel",
		       l."weightKg"::text, l."excessFeeKes"::text, l."photoUrl", l.status::text,
		       l."boardedAt"::text, l."claimedAt"::text, l."claimMethod"::text, l."createdAt"::text
		FROM luggage_tag l
		LEFT JOIN fare_stage s ON s.id = l."dropStageId"
		WHERE l."tripId" = $1
		-- Terminus-bound bags (no named stage) sort last: they come off
		-- when everything else already has.
		ORDER BY coalesce(s."order", 2147483647), l."passengerName", l."pieceNo"`, tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*LuggageTag{}
	for rows.Next() {
		t, err := scanLuggage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// SweepUnclaimedLuggage marks everything still aboard a trip UNCLAIMED
// and returns what it touched.
//
// Called from CloseTrip, which is the only moment this can usefully
// happen: the crew is still holding the bags. A nightly batch job would
// produce the same rows hours later, addressed to nobody, which is the
// difference between a worklist and a report.
//
// Returns the tags rather than a count so the close-out screen can name
// them — "3 bags nobody collected: Wanjiku (2), Otieno (1)" is
// actionable in a way that "3" is not.
func SweepUnclaimedLuggage(ctx context.Context, tx pgx.Tx, tripID string) ([]*LuggageTag, error) {
	rows, err := tx.Query(ctx, `
		UPDATE luggage_tag
		   SET status = 'UNCLAIMED', "updatedAt" = now()
		 WHERE "tripId" = $1 AND status IN ('TAGGED', 'ABOARD')
		RETURNING id::text, code, "tripId"::text, "orgId"::text, "ticketId"::text,
		          "passengerName", "passengerMsisdn", "pieceNo", "pieceCount",
		          "groupId"::text, "dropStageId"::text, "destinationLabel",
		          "weightKg"::text, "excessFeeKes"::text, "photoUrl", status::text,
		          "boardedAt"::text, "claimedAt"::text, "claimMethod"::text, "createdAt"::text`,
		tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*LuggageTag{}
	for rows.Next() {
		t, err := scanLuggage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ResolveLuggageByCode — the guest-safe projection behind a LUG- scan.
//
// Deliberately thin. A luggage tag is a bearer credential printed on a
// stub that lives in a coat pocket: whoever holds it can scan it, and
// that is the point. So this answers "is this a real tag, and where is
// its bag" and nothing else — no passenger phone number, no ticket, no
// other pieces, and the passenger's name reduced the same way the
// printed tag reduces it (surname and initial). Crew-only detail stays
// behind ListTripLuggage's capability check.
type LuggageScanInfo struct {
	Code             string `json:"code"`
	PassengerInitial string `json:"passengerInitial"`
	PieceNo          int    `json:"pieceNo"`
	PieceCount       int    `json:"pieceCount"`
	DestinationLabel string `json:"destinationLabel"`
	Status           string `json:"status"`
}

func ResolveLuggageByCode(ctx context.Context, pool *pgxpool.Pool, code string) (*LuggageScanInfo, error) {
	var i LuggageScanInfo
	var name string
	err := pool.QueryRow(ctx, `
		SELECT code, "passengerName", "pieceNo", "pieceCount", "destinationLabel", status::text
		FROM luggage_tag WHERE upper(code) = upper($1)`, strings.TrimSpace(code)).
		Scan(&i.Code, &name, &i.PieceNo, &i.PieceCount, &i.DestinationLabel, &i.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	i.PassengerInitial = ShortenPassengerName(name)
	return &i, nil
}

// ShortenPassengerName reduces a passenger to what may be printed on a
// tag and shown on a public scan: surname plus a leading initial.
//
// "Mary Wanjiku" becomes "WANJIKU M." — enough for a conductor to call
// over a crowd, not enough to identify someone from a photograph of a
// bag. Exported because the print layout has to apply exactly the same
// rule as the scan projection; two implementations of this would drift,
// and the direction they would drift is toward printing more.
func ShortenPassengerName(full string) string {
	parts := strings.Fields(strings.TrimSpace(full))
	switch len(parts) {
	case 0:
		return ""
	case 1:
		return strings.ToUpper(parts[0])
	}
	surname := strings.ToUpper(parts[len(parts)-1])
	initial := strings.ToUpper(parts[0][:1])
	return surname + " " + initial + "."
}

// luggageByCode fetches a tag and the org that owns it, for the
// authorise-against-the-row pattern every write here uses.
func luggageByCode(ctx context.Context, pool *pgxpool.Pool, code string) (*LuggageTag, string, error) {
	clean := strings.ToUpper(strings.TrimSpace(code))
	if clean == "" {
		return nil, "", &LuggageError{"BAD_INPUT", "No tag code"}
	}
	tag, err := scanLuggage(pool.QueryRow(ctx, luggageSelect+` WHERE upper(code) = $1`, clean))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", &LuggageError{"NOT_FOUND", "No bag with tag " + clean}
	}
	if err != nil {
		return nil, "", err
	}
	return tag, tag.OrgID, nil
}

// crewMemberIDForLuggage resolves who is doing this, across both
// session shapes that can hold a CREW bundle — a legacy AGENT PIN login
// and a SUBJECT with a live OTP-activated org context. Same fork
// CloseTrip and MyActiveTrip already make.
//
// An empty result is not an error and never blocks the action: an org
// owner tagging a bag on their own vehicle has no CrewMember row, and
// refusing them would be a rule that only ever bites the person who
// owns the bus. The column is nullable for exactly this case.
func crewMemberIDForLuggage(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) (string, error) {
	switch {
	case c.ActorType == authsvc.ActorSubject && c.TicketOrgID == orgID:
		return CrewMemberIDForGrant(ctx, pool, orgID, c.PartyID)
	case c.ActorType == authsvc.ActorAgent && c.ActorID != "":
		return crewMemberIDForStaff(ctx, pool, c.ActorID)
	}
	return "", nil
}

// nullIfEmpty and isUniqueViolation already live in this package (see
// voucher.go and payment_id.go respectively) and are reused here rather
// than redefined.
