package dbx

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The receiver proving, from their own phone, that they are the
// receiver — by typing the delivery code only they were sent.
//
// This is the mirror image of parcel_claim.go next door. That file
// proves "I am a party to this parcel" by possession of the PHONE (an
// OTP to the number already on file) and then, for a receiver, reveals
// the delivery code. This one proves the same thing by possession of
// the CODE. Both land on the same projection — GetParcelPartyView at
// ClaimTierReceiver — because they establish the same fact by different
// routes, and two projections would drift.
//
// Why a second route at all: the OTP route needs the receiver's number
// to still work and still be theirs, which in this market is the
// assumption that fails most often. A sender who read the code aloud
// over the phone has already given the receiver everything they need;
// making them also receive an SMS is a second chance to be stranded.
//
// ── Why the counter is in Postgres ───────────────────────────────────
//
// handleDeliverParcel throttles delivery-code guesses against the same
// row now (parcel.deliveryCodeFailures) — it used to be a Redis key via
// authsvc.FailedAttempts, and that was wrong for the reason set out in
// DeliveryCodeTriesLeft's own comment: a counter that reports zero
// whenever the cache is missing is not a counter, and the party guessing
// a six-digit code is the courier holding the box.
//
// So this one was never really the "Redis one vs the Postgres one"
// choice it was written up as. Both belong on the row, and the reason is
// the same in each case: the state has to be visible to somebody else.
// Here that is sharper still. This counter is not a throttle, it is
// escalation state: staff have to SEE it (a locked parcel is a work
// item), act on it (grant more tries), and have that grant survive a
// restart. A guard that forgets is fine; a queue that forgets is a
// parcel nobody ever comes back to. The IP rate limit on the route is
// what handles transport-level sweeping — something a per-parcel counter
// cannot see by construction.

const (
	// ReceiverAuthMaxAttempts — tries before the parcel locks and the
	// carrying company is told. Three rather than the five
	// DeliveryCodeMaxAttempts allows a clerk, because the situations
	// differ: a clerk is reading a number off a customer's phone with
	// the customer standing there to correct them, while whoever is
	// typing here may be anyone who photographed the label. Fewer tries
	// is cheap for the honest receiver — the escape hatch is a phone
	// call to the sender — and expensive for everyone else.
	ReceiverAuthMaxAttempts = 3
	// ReceiverAuthExtraAttempts — what staff may grant, once. Two, not
	// unlimited: the point of a grant is "you misread it, try again",
	// not "keep going until it works". Burning these hard-locks the
	// parcel, and the only way out of a hard lock is a new code.
	ReceiverAuthExtraAttempts = 2
)

// ReceiverAuthResult is what happened, as a closed set. A string rather
// than a bool-plus-error because four of the five outcomes are normal
// operation, not failure, and the handler renders each one differently.
type ReceiverAuthResult string

const (
	ReceiverAuthPassed     ReceiverAuthResult = "PASSED"
	ReceiverAuthWrong      ReceiverAuthResult = "WRONG"
	ReceiverAuthLocked     ReceiverAuthResult = "LOCKED"
	ReceiverAuthHardLocked ReceiverAuthResult = "HARD_LOCKED"
)

// ReceiverAuthOutcome carries the result plus what the caller needs to
// say next.
type ReceiverAuthOutcome struct {
	Result ReceiverAuthResult
	// TriesLeft after this attempt. Meaningful only for WRONG. Told to
	// the receiver deliberately, the same judgement handleDeliverParcel
	// already makes and for the same reason: somebody who does not know
	// a lockout is coming will burn their last try on a guess instead of
	// phoning the sender.
	TriesLeft int
	// JustLocked distinguishes "this attempt caused the lock" from
	// "it was already locked when you got here". Only the former should
	// alert the company — otherwise a receiver refreshing a locked page
	// texts the dispatch desk every time.
	JustLocked bool
	// ParcelID, for the caller's own follow-up work (notifications,
	// audit). Empty when no such parcel exists.
	ParcelID string
}

// receiverAuthDecision is what one attempt does to the parcel — the
// outcome to report plus the columns to write.
//
// Split out from VerifyReceiverCode as a pure function because it is
// the only interesting part and the only part with edge cases (three
// counters, two lock states, an off-by-one waiting at every boundary),
// and there is no way to exercise it inside a transaction without a
// database. Pure, it is a table test.
type receiverAuthDecision struct {
	Result      ReceiverAuthResult
	TriesLeft   int
	JustLocked  bool
	NewAttempts int
	// SetLocked / SetHardLocked — stamp the corresponding timestamp.
	SetLocked     bool
	SetHardLocked bool
	// ClearCounters — a pass: zero the attempts AND any granted extras.
	// The grant was for one episode; banking it would silently give the
	// next round five tries instead of three.
	ClearCounters bool
}

func decideReceiverAuth(attempts, extraGranted int, locked, hardLocked, codeMatches bool) receiverAuthDecision {
	// The two lock states short-circuit before anything is counted: a
	// locked parcel must not creep its attempt count upward every time
	// somebody refreshes the page, or the number staff read would
	// describe the refreshing rather than the guessing.
	if hardLocked {
		return receiverAuthDecision{Result: ReceiverAuthHardLocked, NewAttempts: attempts}
	}
	if locked {
		return receiverAuthDecision{Result: ReceiverAuthLocked, NewAttempts: attempts}
	}
	if codeMatches {
		return receiverAuthDecision{Result: ReceiverAuthPassed, ClearCounters: true}
	}

	allowed := ReceiverAuthMaxAttempts + extraGranted
	next := attempts + 1
	switch {
	case next < allowed:
		return receiverAuthDecision{
			Result: ReceiverAuthWrong, NewAttempts: next, TriesLeft: allowed - next,
		}
	// Extras were granted and have now been burned too. Nothing is left
	// to try: at this point the code is either lost or in the wrong
	// hands, and further guesses distinguish those two cases not at all.
	case extraGranted > 0:
		return receiverAuthDecision{
			Result: ReceiverAuthHardLocked, NewAttempts: next, JustLocked: true, SetHardLocked: true,
		}
	default:
		return receiverAuthDecision{
			Result: ReceiverAuthLocked, NewAttempts: next, JustLocked: true, SetLocked: true,
		}
	}
}

// VerifyReceiverCode checks a delivery code typed by whoever is holding
// the label, and moves the parcel's lockout state accordingly.
//
// Runs entirely inside one transaction with the parcel row locked FOR
// UPDATE. Read-then-write in two statements would let N concurrent
// attempts all read the same attempt count and all pass the limit
// check — which for a six-digit code is the difference between three
// guesses and as many as the attacker can open sockets for.
//
// A parcel that does not exist returns PASSED=false via a WRONG outcome
// with no parcel id, never NOT_FOUND. The tracking code is printed on
// the box and this endpoint is public; answering "no such parcel"
// distinguishably would turn it into a code enumerator, the same oracle
// RequestParcelClaimOtp spends its uniform response avoiding.
func VerifyReceiverCode(
	ctx context.Context, pool *pgxpool.Pool, code, deliveryCode, actorIP string,
) (*ReceiverAuthOutcome, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var parcelID, storedCode string
	var attempts, extraGranted int
	var lockedAt, hardLockedAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, "deliveryCode", "receiverAuthAttempts", "receiverAuthExtraGranted",
		       "receiverAuthLockedAt", "receiverAuthHardLockedAt"
		FROM parcel WHERE code = $1 FOR UPDATE`, strings.TrimSpace(code)).
		Scan(&parcelID, &storedCode, &attempts, &extraGranted, &lockedAt, &hardLockedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ReceiverAuthOutcome{Result: ReceiverAuthWrong}, nil
	}
	if err != nil {
		return nil, err
	}

	// Case-insensitive and trimmed, matching DeliverParcel's own compare
	// and for the reason given there: a code read aloud between two
	// people does not reliably survive with its case intact. Not
	// constant-time, unlike the msisdn compare in parcel_claim.go —
	// there the secret is one an attacker may guess at indefinitely,
	// here the budget is three, which is a far harder wall than any
	// timing signal could climb.
	matches := strings.EqualFold(strings.TrimSpace(deliveryCode), strings.TrimSpace(storedCode))
	d := decideReceiverAuth(attempts, extraGranted, lockedAt != nil, hardLockedAt != nil, matches)

	out := &ReceiverAuthOutcome{
		Result: d.Result, TriesLeft: d.TriesLeft, JustLocked: d.JustLocked, ParcelID: parcelID,
	}
	// An already-locked parcel is reported, not rewritten — no UPDATE,
	// no event, nothing to commit. Recording a row every time somebody
	// reloads a locked page would bury the three attempts that matter.
	if !d.ClearCounters && !d.JustLocked && d.Result != ReceiverAuthWrong {
		return out, nil
	}

	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET
			"receiverAuthAttempts"     = $2,
			"receiverAuthExtraGranted" = CASE WHEN $3::boolean THEN 0 ELSE "receiverAuthExtraGranted" END,
			"receiverAuthLockedAt"     = CASE WHEN $3::boolean THEN NULL
			                                  WHEN $4::boolean THEN now()
			                                  ELSE "receiverAuthLockedAt" END,
			"receiverAuthHardLockedAt" = CASE WHEN $5::boolean THEN now()
			                                  ELSE "receiverAuthHardLockedAt" END
		WHERE id = $1`,
		parcelID, d.NewAttempts, d.ClearCounters, d.SetLocked, d.SetHardLocked); err != nil {
		return nil, err
	}

	if err := appendParcelEventTx(ctx, tx, receiverAuthEvent(parcelID, actorIP, d,
		ReceiverAuthMaxAttempts+extraGranted)); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

// receiverAuthEvent is the history row for one attempt.
//
// Which of these carry a publicLabel is the whole editorial decision of
// this feature, so it lives in one function rather than scattered
// across branches:
//
//   - A pass is staff-only. "Somebody proved they are the receiver" is
//     not news to a stranger tracking the box, and telling a prober
//     their probe registered is a gift.
//   - A single wrong code is staff-only, for the same reason and
//     because a receiver who mistypes once does not need it published.
//   - A lock IS public. The parcel has visibly stopped, and both the
//     receiver and the sender reading the same page need to know why.
//     It reveals nothing a successful guesser would not already have.
func receiverAuthEvent(parcelID, actorIP string, d receiverAuthDecision, allowed int) parcelEventInput {
	base := parcelEventInput{ParcelID: parcelID, ActorType: "GUEST", ActorIP: actorIP}
	switch {
	case d.ClearCounters:
		base.Kind, base.Severity = "RECEIVER_AUTH_PASSED", "INFO"
		base.StaffDetail = "Receiver authenticated with the delivery code"
	case d.SetHardLocked:
		base.Kind, base.Severity = "RECEIVER_AUTH_HARD_LOCKED", "CRITICAL"
		base.PublicLabel = strPtr("Receiver could not be verified — a new delivery code is needed")
		base.StaffDetail = fmt.Sprintf("Hard locked after %d attempts including granted retries", d.NewAttempts)
	case d.SetLocked:
		base.Kind, base.Severity = "RECEIVER_AUTH_LOCKED", "WARNING"
		base.PublicLabel = strPtr("Receiver authentication failed")
		base.StaffDetail = fmt.Sprintf("Locked after %d wrong delivery codes", d.NewAttempts)
	default:
		base.Kind, base.Severity = "RECEIVER_AUTH_FAILED", "INFO"
		base.StaffDetail = fmt.Sprintf("Wrong delivery code (attempt %d of %d)", d.NewAttempts, allowed)
	}
	return base
}

// GrantReceiverAuthRetry gives a locked-out receiver two more tries.
//
// Refuses once the parcel is hard-locked. That is the whole point of
// the second state: a grant that could itself be re-granted is not a
// limit, it is a speed bump, and this endpoint is reachable by every
// clerk at the carrying company.
func GrantReceiverAuthRetry(
	ctx context.Context, pool *pgxpool.Pool, code, staffPartyID string,
) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var parcelID string
	var extraGranted int
	var lockedAt, hardLockedAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, "receiverAuthExtraGranted", "receiverAuthLockedAt", "receiverAuthHardLockedAt"
		FROM parcel WHERE code = $1 FOR UPDATE`, strings.TrimSpace(code)).
		Scan(&parcelID, &extraGranted, &lockedAt, &hardLockedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if hardLockedAt != nil {
		return &ParcelError{"BAD_INPUT", "This parcel is hard locked — issue a new delivery code instead"}
	}
	if lockedAt == nil {
		return &ParcelError{"BAD_INPUT", "This parcel isn't locked"}
	}
	if extraGranted > 0 {
		return &ParcelError{"BAD_INPUT", "Extra tries have already been granted once for this parcel"}
	}

	// Attempts reset alongside the grant so the two tries are actually
	// two. Leaving the count at its ceiling and only raising the ceiling
	// works out the same today, but couples the grant to the exact
	// arithmetic of the check, which is how off-by-ones get in.
	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET "receiverAuthAttempts" = 0, "receiverAuthExtraGranted" = $2,
		                  "receiverAuthLockedAt" = NULL
		WHERE id = $1`, parcelID, ReceiverAuthExtraAttempts); err != nil {
		return err
	}
	if err := appendParcelEventTx(ctx, tx, parcelEventInput{
		ParcelID: parcelID, Kind: "RECEIVER_AUTH_RETRY_GRANTED", Severity: "INFO",
		PublicLabel: strPtr("Two more verification attempts allowed"),
		StaffDetail: fmt.Sprintf("Granted %d more attempts", ReceiverAuthExtraAttempts),
		ActorType:   "STAFF", ActorPartyID: nilIfEmpty(staffPartyID),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ReissueDeliveryCode mints a replacement and clears every lock.
//
// The first write to parcel."deliveryCode" after insert anywhere in the
// codebase — until now the column was set once at booking and was
// simply unrecoverable if it went wrong, which is the gap that made a
// hard lock a dead end rather than a state.
//
// Returns the new code so the caller can text it. Deliberately returned
// rather than left for the caller to re-read: the only reason to fetch
// a delivery code out of the database is to send it to somebody, and a
// function that makes that a separate query invites a second caller who
// fetches it for some other reason.
func ReissueDeliveryCode(
	ctx context.Context, pool *pgxpool.Pool, code, staffPartyID string,
) (newCode string, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var parcelID, status string
	err = tx.QueryRow(ctx, `
		SELECT id, status::text FROM parcel WHERE code = $1 FOR UPDATE`, strings.TrimSpace(code)).
		Scan(&parcelID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return "", err
	}
	// A code is proof of receipt at handover. Once the parcel is
	// delivered or its journey is closed there is no handover left to
	// prove, and minting one would put a live-looking credential on a
	// finished parcel.
	switch status {
	case "DELIVERED", "CANCELLED", "RETURNED_TO_SENDER":
		return "", &ParcelError{"BAD_INPUT", "This parcel's journey is already closed"}
	}

	newCode, err = generateUniqueDeliveryCode(ctx, tx)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE parcel SET "deliveryCode" = $2,
		                  "deliveryCodeVersion" = "deliveryCodeVersion" + 1,
		                  "deliveryCodeIssuedAt" = now(),
		                  "receiverAuthAttempts" = 0,
		                  "receiverAuthExtraGranted" = 0,
		                  "receiverAuthLockedAt" = NULL,
		                  "receiverAuthHardLockedAt" = NULL
		WHERE id = $1`, parcelID, newCode); err != nil {
		return "", err
	}
	if err := appendParcelEventTx(ctx, tx, parcelEventInput{
		ParcelID: parcelID, Kind: "DELIVERY_CODE_REISSUED", Severity: "INFO",
		// Public and deliberately so: this is the one event on the list a
		// receiver must see, because their old code has just stopped
		// working and nothing else on the page would explain it.
		PublicLabel: strPtr("A new delivery code was issued"),
		StaffDetail: "Delivery code reissued; lockout cleared",
		ActorType:   "STAFF", ActorPartyID: nilIfEmpty(staffPartyID),
	}); err != nil {
		return "", err
	}
	// The plaintext code is never put in an event row. staffDetail is
	// read by every clerk with console access, which is a far wider set
	// than "the receiver", and the whole control here is that only the
	// receiver knows it.
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return newCode, nil
}

// ReleaseHeldCourierEarnings pays out a self-confirmed delivery whose
// accrual was held (see DeliverParcel's RECEIVER_SELF_AGENT branch).
//
// Idempotent through AccrueCourierEarnings itself, which returns early
// on a parcel that already has courierEarningsKes set. The hold column
// is cleared regardless, so a second release is a no-op rather than an
// error — releasing twice is not a mistake worth failing a clerk over.
//
// Note AccrueCourierEarnings also returns early for a parcel carried by
// a ParcelOrg, which already took its share at payment. The hold is
// therefore only ever real money for Esoqo-operated parcels; on a
// company parcel it is a visible marker that a delivery closed without
// a witness, which is worth keeping for its own sake.
func ReleaseHeldCourierEarnings(
	ctx context.Context, pool *pgxpool.Pool, code, staffPartyID string,
) error {
	var parcelID string
	var heldUntil *time.Time
	err := pool.QueryRow(ctx, `
		SELECT id, "courierEarningsHeldUntil" FROM parcel WHERE code = $1`,
		strings.TrimSpace(code)).Scan(&parcelID, &heldUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return err
	}
	if heldUntil == nil {
		return &ParcelError{"BAD_INPUT", "Nothing is being held on this parcel"}
	}
	if err := AccrueCourierEarnings(ctx, pool, parcelID); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `
		UPDATE parcel SET "courierEarningsHeldUntil" = NULL WHERE id = $1`, parcelID); err != nil {
		return err
	}
	return AppendParcelEvent(ctx, pool, parcelEventInput{
		ParcelID: parcelID, Kind: "COURIER_EARNINGS_RELEASED", Severity: "INFO",
		StaffDetail: "Held courier earnings released",
		ActorType:   "STAFF", ActorPartyID: nilIfEmpty(staffPartyID),
	})
}

// CanReceiverSelfConfirm answers whether this parcel may be closed by
// the receiver themselves, and if not, why not in words a guest can
// read.
//
// Exists so the rule has exactly one author. The handler previously
// re-derived it from ParcelPartyView, which does not carry a COD
// STATUS — only an amount — so it hid the button on a parcel whose
// cash had already been collected, while DeliverParcel (reading the
// real columns) would have allowed it. Two implementations of one
// rule, disagreeing in the direction that quietly denies a legitimate
// receiver.
//
// Still advisory: DeliverParcel re-checks both conditions itself and
// must, because it is the one holding the row when the write happens.
// This exists to explain, not to authorise.
func CanReceiverSelfConfirm(ctx context.Context, pool *pgxpool.Pool, code string) (bool, string, error) {
	var status, codStatus string
	var codAmount *string
	err := pool.QueryRow(ctx, `
		SELECT status::text, "codAmountKes"::text, "codStatus"
		FROM parcel WHERE code = $1`, strings.TrimSpace(code)).
		Scan(&status, &codAmount, &codStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, "", &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return false, "", err
	}
	if status != "HELD_AT_AGENT" {
		return false, "The courier completes the handover for this parcel.", nil
	}
	if codIsOutstanding(codAmount, codStatus) {
		return false, "There's cash to pay on collection, so the agent has to complete the handover.", nil
	}
	return true, "", nil
}

// codIsOutstanding — money still to change hands on this parcel.
//
// Shared with DeliverParcel's own guard so the two cannot drift. An
// amount alone is not the question: a COD parcel whose cash the
// courier already took at an earlier leg is, for this purpose, an
// ordinary parcel.
func codIsOutstanding(codAmount *string, codStatus string) bool {
	if codAmount == nil || strings.TrimSpace(*codAmount) == "" {
		return false
	}
	switch codStatus {
	case "COLLECTED", "REMITTED", "SETTLED":
		return false
	}
	return true
}

// ReceiverAuthState is the lockout picture staff act on, read alongside
// a parcel rather than folded into ParcelStatusView — none of it is
// guest-safe, and ParcelStatusView's whole contract is that it is.
type ReceiverAuthState struct {
	Attempts            int        `json:"attempts"`
	MaxAttempts         int        `json:"maxAttempts"`
	ExtraGranted        int        `json:"extraGranted"`
	LockedAt            *time.Time `json:"lockedAt,omitempty"`
	HardLockedAt        *time.Time `json:"hardLockedAt,omitempty"`
	DeliveryCodeVersion int        `json:"deliveryCodeVersion"`
	CourierEarningsHeld *time.Time `json:"courierEarningsHeldUntil,omitempty"`
}

// GetReceiverAuthState reads it for one parcel.
func GetReceiverAuthState(ctx context.Context, pool *pgxpool.Pool, code string) (*ReceiverAuthState, error) {
	s := &ReceiverAuthState{MaxAttempts: ReceiverAuthMaxAttempts}
	err := pool.QueryRow(ctx, `
		SELECT "receiverAuthAttempts", "receiverAuthExtraGranted", "receiverAuthLockedAt",
		       "receiverAuthHardLockedAt", "deliveryCodeVersion", "courierEarningsHeldUntil"
		FROM parcel WHERE code = $1`, strings.TrimSpace(code)).
		Scan(&s.Attempts, &s.ExtraGranted, &s.LockedAt, &s.HardLockedAt,
			&s.DeliveryCodeVersion, &s.CourierEarningsHeld)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ParcelError{"NOT_FOUND", "That parcel was not found"}
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

// ── The event log ────────────────────────────────────────────────────

// parcelEventInput is one row of parcel_event. A struct rather than
// eight positional arguments because five of them are optional and
// AppendParcelEvent is called from a dozen places.
type parcelEventInput struct {
	ParcelID string
	// Kind must be a value of the ParcelEventKind enum; Postgres rejects
	// anything else, which is the point of it being an enum rather than
	// text. Severity likewise.
	Kind     string
	Severity string
	// PublicLabel nil means staff-only. When set it is the exact
	// sentence a guest reads on the tracking page — see the model's own
	// comment on why visibility and wording are one field.
	PublicLabel  *string
	StaffDetail  string
	ActorType    string // GUEST | STAFF | SYSTEM
	ActorPartyID *string
	ActorIP      string
}

// AppendParcelEvent writes one history row outside any transaction.
func AppendParcelEvent(ctx context.Context, pool *pgxpool.Pool, in parcelEventInput) error {
	_, err := pool.Exec(ctx, insertParcelEventSQL, parcelEventArgs(in)...)
	return err
}

// appendParcelEventTx is the same write inside a caller's transaction,
// which is how every state change in this file uses it: the row and its
// history entry commit together or not at all. A parcel locked with no
// event explaining why is worse than one that was never locked, because
// the first is invisible to the queue that exists to find it.
func appendParcelEventTx(ctx context.Context, tx pgx.Tx, in parcelEventInput) error {
	_, err := tx.Exec(ctx, insertParcelEventSQL, parcelEventArgs(in)...)
	return err
}

const insertParcelEventSQL = `
	INSERT INTO parcel_event ("parcelId", kind, severity, "publicLabel", "staffDetail",
	                          "actorType", "actorPartyId", "actorIp")
	VALUES ($1, $2::"ParcelEventKind", $3::"ParcelEventSeverity", $4, $5, $6, $7, $8)`

func parcelEventArgs(in parcelEventInput) []any {
	severity := in.Severity
	if severity == "" {
		severity = "INFO"
	}
	actorType := in.ActorType
	if actorType == "" {
		actorType = "SYSTEM"
	}
	return []any{
		in.ParcelID, in.Kind, severity, in.PublicLabel,
		nilIfEmpty(in.StaffDetail), actorType, in.ActorPartyID, nilIfEmpty(in.ActorIP),
	}
}

func nilIfEmpty(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

func strPtr(s string) *string { return &s }
