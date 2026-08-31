// Package dbx (treasury.go) ports packages/db/src/dal/treasury.ts's
// self-serve surface — contributions, the derived balance, and the
// scheduled multisig withdrawal flow — line for line, including the
// standby-window walk and the HMAC withdrawal-signature scheme. Officer
// settings (setTreasuryPolicy, add/removeGroupSigner) and meetings stay
// TypeScript-only for mobile v1 (see the plan's own scope note).
package dbx

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/authsvc"
	"github.com/esoko/core-go/internal/ledger"
)

// IsOfficer mirrors treasury.ts's isOfficer.
func IsOfficer(ctx context.Context, pool *pgxpool.Pool, orgID, personID string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT true FROM membership
		WHERE "orgId" = $1 AND "personId" = $2 AND "exitedAt" IS NULL
		  AND role IN ('CHAIRPERSON', 'TREASURER', 'SECRETARY') LIMIT 1`, orgID, personID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return exists, err
}

// assertActiveMember mirrors treasury.ts's assertActiveMember (folded
// into a single error message here — the two-part "pay the join fee
// first" distinction is a nicety the mobile UI can add later from the
// membership status it already has on hand).
var ErrNotActiveMember = errors.New("you are not an active member of this group")

func assertActiveMember(ctx context.Context, pool *pgxpool.Pool, orgID, personID string) error {
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT true FROM membership
		WHERE "orgId" = $1 AND "personId" = $2 AND "exitedAt" IS NULL AND status = 'ACTIVE' LIMIT 1`,
		orgID, personID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotActiveMember
	}
	return err
}

// GetEffectiveSignerIds mirrors getEffectiveSignerIds — configured
// GroupSigner rows if any exist, else the group's own officers, so a
// brand-new group is never signer-less.
func GetEffectiveSignerIds(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]string, error) {
	rows, err := pool.Query(ctx, `SELECT "personId" FROM group_signer WHERE "orgId" = $1 AND "removedAt" IS NULL`, orgID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) > 0 {
		return ids, nil
	}

	rows, err = pool.Query(ctx, `
		SELECT "personId" FROM membership
		WHERE "orgId" = $1 AND "exitedAt" IS NULL AND role IN ('CHAIRPERSON', 'TREASURER', 'SECRETARY')`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

type TreasuryPolicy struct {
	RequiredSigners       int
	WithdrawalLeadMinutes int
	ActiveHoursStart      int
	ActiveHoursEnd        int
	RequireQuorateMeeting bool
	ContributionsEnabled  bool
	ContributionAmountKES *string
	ContributionCycle     *string
	JoinFeeKES            *string
	IsConfigured          bool
}

// GetTreasuryPolicy mirrors getTreasuryPolicy's POLICY_DEFAULTS fallback
// — a group that never configured one still gets sane defaults, not an
// error.
func GetTreasuryPolicy(ctx context.Context, pool *pgxpool.Pool, orgID string) (*TreasuryPolicy, error) {
	p := &TreasuryPolicy{
		RequiredSigners: 2, WithdrawalLeadMinutes: 70, ActiveHoursStart: 7, ActiveHoursEnd: 20,
		ContributionsEnabled: true,
	}
	err := pool.QueryRow(ctx, `
		SELECT "requiredSigners", "withdrawalLeadMinutes", "activeHoursStart", "activeHoursEnd",
		       "requireQuorateMeeting", "contributionsEnabled", "contributionAmountKes"::text,
		       "contributionCycle", "joinFeeKes"::text
		FROM group_treasury_policy WHERE "orgId" = $1`, orgID).
		Scan(&p.RequiredSigners, &p.WithdrawalLeadMinutes, &p.ActiveHoursStart, &p.ActiveHoursEnd,
			&p.RequireQuorateMeeting, &p.ContributionsEnabled, &p.ContributionAmountKES,
			&p.ContributionCycle, &p.JoinFeeKES)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil // defaults only, isConfigured stays false
	}
	if err != nil {
		return nil, err
	}
	p.IsConfigured = true
	return p, nil
}

func findOrCreateGroupSavingsAccount(ctx context.Context, tx pgx.Tx, orgID string) (string, error) {
	return findOrCreateAccountTx(ctx, tx, &orgID, "GROUP_SAVINGS")
}

func findOrCreateSettlementAccountTx(ctx context.Context, tx pgx.Tx) (string, error) {
	return findOrCreateAccountTx(ctx, tx, nil, "SETTLEMENT")
}

func findOrCreateAccountTx(ctx context.Context, tx pgx.Tx, partyID *string, kind string) (string, error) {
	var id string
	var err error
	if partyID == nil {
		err = tx.QueryRow(ctx, `SELECT id FROM account WHERE "partyId" IS NULL AND kind = $1 AND currency = 'KES'`, kind).Scan(&id)
	} else {
		err = tx.QueryRow(ctx, `SELECT id FROM account WHERE "partyId" = $1 AND kind = $2 AND currency = 'KES'`, *partyID, kind).Scan(&id)
	}
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO account (id, "partyId", kind, currency) VALUES (gen_random_uuid(), $1, $2, 'KES')
		RETURNING id`, partyID, kind).Scan(&id)
	return id, err
}

// ── contributions ──────────────────────────────────────────────────

type TreasuryError struct {
	Code    string
	Message string
}

func (e *TreasuryError) Error() string { return e.Message }

func DeclareContribution(ctx context.Context, pool *pgxpool.Pool, orgID, contributorID string, amountKES float64, method, reference, note *string) (string, error) {
	if err := assertActiveMember(ctx, pool, orgID, contributorID); err != nil {
		return "", err
	}
	if !(amountKES > 0) {
		return "", errors.New("enter an amount above zero")
	}

	var contributionsEnabled bool
	err := pool.QueryRow(ctx, `SELECT "contributionsEnabled" FROM group_treasury_policy WHERE "orgId" = $1`, orgID).Scan(&contributionsEnabled)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if err == nil && !contributionsEnabled {
		return "", &TreasuryError{"CONTRIBUTIONS_DISABLED", "This group is not currently taking contributions"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	accountID, err := findOrCreateGroupSavingsAccount(ctx, tx, orgID)
	if err != nil {
		return "", err
	}

	var contributionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO group_contribution (id, "orgId", "accountId", "contributorId", "amountKes", method, reference, "declaredNote", status, "declaredAt", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'DECLARED', now(), now(), now())
		RETURNING id`, orgID, accountID, contributorID, amountKES, method, reference, note).Scan(&contributionID)
	if err != nil {
		return "", err
	}
	return contributionID, tx.Commit(ctx)
}

// CreateJoinFeePayment mirrors createJoinFeePayment.
func CreateJoinFeePayment(ctx context.Context, pool *pgxpool.Pool, orgID, personID string, method, reference *string) (string, error) {
	var membershipID, status string
	err := pool.QueryRow(ctx, `
		SELECT id, status::text FROM membership WHERE "orgId" = $1 AND "personId" = $2 AND "exitedAt" IS NULL`,
		orgID, personID).Scan(&membershipID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotActiveMember
	}
	if err != nil {
		return "", err
	}
	if status != "PENDING" {
		return "", &TreasuryError{"NOT_PENDING", "Your membership is already active — nothing to pay"}
	}

	var joinFeeText *string
	if err := pool.QueryRow(ctx, `SELECT "joinFeeKes"::text FROM group_treasury_policy WHERE "orgId" = $1`, orgID).Scan(&joinFeeText); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if joinFeeText == nil {
		return "", &TreasuryError{"NO_JOIN_FEE", "This group does not charge a join fee"}
	}
	joinFeeKES, err := strconv.ParseFloat(*joinFeeText, 64)
	if err != nil || !(joinFeeKES > 0) {
		return "", &TreasuryError{"NO_JOIN_FEE", "This group does not charge a join fee"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	accountID, err := findOrCreateGroupSavingsAccount(ctx, tx, orgID)
	if err != nil {
		return "", err
	}
	note := "Join fee"
	var contributionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO group_contribution (id, "orgId", "accountId", "contributorId", "membershipId", "amountKes", method, reference, "declaredNote", status, "declaredAt", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'DECLARED', now(), now(), now())
		RETURNING id`, orgID, accountID, personID, membershipID, joinFeeKES, method, reference, note).Scan(&contributionID)
	if err != nil {
		return "", err
	}
	return contributionID, tx.Commit(ctx)
}

// postContribution mirrors treasury.ts's postContribution helper: posts
// a 2-account JournalEntry, flips the contribution CONFIRMED, and — for
// a join-fee contribution — activates the PENDING membership it belongs
// to. reference, if non-empty, overwrites the declared reference (an
// M-Pesa receipt code replacing whatever the member typed in).
func postContribution(ctx context.Context, tx pgx.Tx, contributionID, orgID, accountID string, amountKES float64, membershipID *string, mpesaReceipt *string) error {
	settlementID, err := findOrCreateSettlementAccountTx(ctx, tx)
	if err != nil {
		return err
	}

	var journalEntryID string
	err = tx.QueryRow(ctx, `
		INSERT INTO journal_entry (id, reference, description, "occurredAt", "recordedAt")
		VALUES (gen_random_uuid(), $1, 'Group contribution', now(), now())
		RETURNING id`, "CONTRIBUTION-"+contributionID).Scan(&journalEntryID)
	if err != nil {
		return err
	}
	for _, p := range []ledger.Posting{{AccountID: accountID, AmountKES: amountKES}, {AccountID: settlementID, AmountKES: -amountKES}} {
		_, err = tx.Exec(ctx, `
			INSERT INTO posting (id, "entryId", "accountId", amount) VALUES (gen_random_uuid(), $1, $2, $3)`,
			journalEntryID, p.AccountID, p.AmountKES)
		if err != nil {
			return err
		}
	}

	if mpesaReceipt != nil {
		_, err = tx.Exec(ctx, `
			UPDATE group_contribution SET status = 'CONFIRMED', "confirmedAt" = now(), "journalEntryId" = $1, reference = $2, "updatedAt" = now()
			WHERE id = $3`, journalEntryID, *mpesaReceipt, contributionID)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE group_contribution SET status = 'CONFIRMED', "confirmedAt" = now(), "journalEntryId" = $1, "updatedAt" = now()
			WHERE id = $2`, journalEntryID, contributionID)
	}
	if err != nil {
		return err
	}

	if membershipID != nil {
		_, err = tx.Exec(ctx, `UPDATE membership SET status = 'ACTIVE' WHERE id = $1`, *membershipID)
	}
	return err
}

// ConfirmContribution mirrors confirmContribution — single-signature
// officer confirmation (money-in carries far less risk than money-out).
func ConfirmContribution(ctx context.Context, pool *pgxpool.Pool, contributionID, confirmerID string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var orgID, accountID, status string
	var amountKESText string
	var membershipID *string
	err = tx.QueryRow(ctx, `
		SELECT "orgId", "accountId", status::text, "amountKes"::text, "membershipId"
		FROM group_contribution WHERE id = $1 FOR UPDATE`, contributionID).
		Scan(&orgID, &accountID, &status, &amountKESText, &membershipID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &TreasuryError{"NOT_FOUND", "Contribution not found"}
	}
	if err != nil {
		return err
	}
	if status == "CONFIRMED" {
		return nil
	}
	if status == "REJECTED" || status == "WAIVED" {
		return &TreasuryError{"ALREADY_SETTLED", "This contribution has already been settled"}
	}

	officer, err := IsOfficer(ctx, pool, orgID, confirmerID)
	if err != nil {
		return err
	}
	if !officer {
		return &TreasuryError{"NOT_AN_OFFICER", "Only an officer can confirm a contribution"}
	}

	amountKES, err := strconv.ParseFloat(amountKESText, 64)
	if err != nil {
		return err
	}
	if err := postContribution(ctx, tx, contributionID, orgID, accountID, amountKES, membershipID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var ErrContributionNotFound = errors.New("no contribution matches this checkout request")

// ConfirmContributionByCheckoutID — the webhook path, mirrors
// confirmContributionByCheckoutId. Idempotent: a callback delivered
// twice is a no-op.
func ConfirmContributionByCheckoutID(ctx context.Context, pool *pgxpool.Pool, checkoutRequestID, mpesaReceipt string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var id, orgID, accountID, status, amountKESText string
	var membershipID *string
	err = tx.QueryRow(ctx, `
		SELECT id, "orgId", "accountId", status::text, "amountKes"::text, "membershipId"
		FROM group_contribution WHERE "checkoutRequestId" = $1 FOR UPDATE`, checkoutRequestID).
		Scan(&id, &orgID, &accountID, &status, &amountKESText, &membershipID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrContributionNotFound
	}
	if err != nil {
		return err
	}
	if status == "CONFIRMED" {
		return nil
	}

	amountKES, err := strconv.ParseFloat(amountKESText, 64)
	if err != nil {
		return err
	}
	if err := postContribution(ctx, tx, id, orgID, accountID, amountKES, membershipID, &mpesaReceipt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func AttachContributionCheckoutRequestID(ctx context.Context, pool *pgxpool.Pool, contributionID, checkoutRequestID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE group_contribution SET "checkoutRequestId" = $1, method = 'MPESA', "updatedAt" = now() WHERE id = $2`,
		checkoutRequestID, contributionID)
	return err
}

type ContributionRow struct {
	ID              string
	ContributorName string
	AmountKES       string
	Status          string
	Method          *string
	CreatedAt       time.Time
}

func ListContributions(ctx context.Context, pool *pgxpool.Pool, orgID string, limit int) ([]ContributionRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT gc.id, COALESCE(pe."knownAs", pe."officialName"), gc."amountKes"::text, gc.status::text, gc.method::text, gc."createdAt"
		FROM group_contribution gc
		JOIN person pe ON pe."partyId" = gc."contributorId"
		WHERE gc."orgId" = $1
		ORDER BY gc."createdAt" DESC LIMIT $2`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ContributionRow
	for rows.Next() {
		var c ContributionRow
		if err := rows.Scan(&c.ID, &c.ContributorName, &c.AmountKES, &c.Status, &c.Method, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetGroupBalance — derived, never stored: the sum of the group's own
// GROUP_SAVINGS postings.
func GetGroupBalance(ctx context.Context, pool *pgxpool.Pool, orgID string) (float64, error) {
	var balanceText *string
	err := pool.QueryRow(ctx, `
		SELECT SUM(p.amount)::text FROM posting p
		JOIN account a ON a.id = p."accountId"
		WHERE a."partyId" = $1 AND a.kind = 'GROUP_SAVINGS'`, orgID).Scan(&balanceText)
	if err != nil {
		return 0, err
	}
	if balanceText == nil {
		return 0, nil
	}
	return strconv.ParseFloat(*balanceText, 64)
}

// ── standby window & withdrawal signatures ────────────────────────

// ComputeStandbyOpensAt ports computeStandbyOpensAt verbatim: walks
// `from` forward by leadMinutes of ACTIVE-HOURS time only — the clock
// pauses outside [activeHoursStart, activeHoursEnd) and resumes next
// activeHoursStart, so a request raised at 9pm doesn't expire while
// every signer is asleep.
func ComputeStandbyOpensAt(from time.Time, leadMinutes, activeHoursStart, activeHoursEnd int) time.Time {
	remaining := leadMinutes
	cur := from

	for guard := 0; guard < 2000 && remaining > 0; guard++ {
		hour := cur.Hour()
		if hour < activeHoursStart {
			cur = time.Date(cur.Year(), cur.Month(), cur.Day(), activeHoursStart, 0, 0, 0, cur.Location())
			continue
		}
		if hour >= activeHoursEnd {
			next := cur.AddDate(0, 0, 1)
			cur = time.Date(next.Year(), next.Month(), next.Day(), activeHoursStart, 0, 0, 0, next.Location())
			continue
		}
		windowEnd := time.Date(cur.Year(), cur.Month(), cur.Day(), activeHoursEnd, 0, 0, 0, cur.Location())
		minutesLeftInWindow := int(windowEnd.Sub(cur).Minutes())
		consume := remaining
		if minutesLeftInWindow < consume {
			consume = minutesLeftInWindow
		}
		cur = cur.Add(time.Duration(consume) * time.Minute)
		remaining -= consume
	}
	return cur
}

func signWithdrawalSignature(secret, withdrawalID, signerID, decision string, at time.Time) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%s|%s|%s|%s", withdrawalID, signerID, decision, at.UTC().Format("2006-01-02T15:04:05.000Z"))))
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyWithdrawalSignature ports verifyWithdrawalSignature — re-checked
// on every read, not trusted just because this server wrote it (defense
// in depth against a corrupted row going unnoticed).
func VerifyWithdrawalSignature(secret, withdrawalID, signerID, decision string, signedAt time.Time, signature string) bool {
	expected := signWithdrawalSignature(secret, withdrawalID, signerID, decision, signedAt)
	expectedBytes, err1 := hex.DecodeString(expected)
	actualBytes, err2 := hex.DecodeString(signature)
	if err1 != nil || err2 != nil {
		return false
	}
	return hmac.Equal(expectedBytes, actualBytes)
}

// ── withdrawals ────────────────────────────────────────────────────

type RequestWithdrawalInput struct {
	OrgID       string
	RequestedBy string
	AmountKES   float64
	Purpose     string
	PayeeName   string
	PayeeMsisdn *string
	MeetingID   *string
}

// RequestWithdrawal mirrors requestWithdrawal — officer-only, balance
// check, the quorate-meeting policy check (faithfully ported even
// though mobile v1 has no meeting UI — see the plan's own note),
// snapshots requiredSigners so a later policy change never reaches back
// into an in-flight request.
func RequestWithdrawal(ctx context.Context, pool *pgxpool.Pool, in RequestWithdrawalInput, sessionSecret string) (string, error) {
	if err := assertActiveMember(ctx, pool, in.OrgID, in.RequestedBy); err != nil {
		return "", err
	}
	officer, err := IsOfficer(ctx, pool, in.OrgID, in.RequestedBy)
	if err != nil {
		return "", err
	}
	if !officer {
		return "", &TreasuryError{"NOT_AN_OFFICER", "Only your group's officers can propose a withdrawal"}
	}
	if !(in.AmountKES > 0) {
		return "", errors.New("enter an amount above zero")
	}
	if in.Purpose == "" {
		return "", errors.New("state what the withdrawal is for")
	}

	var accountID string
	err = pool.QueryRow(ctx, `SELECT id FROM account WHERE "partyId" = $1 AND kind = 'GROUP_SAVINGS'`, in.OrgID).Scan(&accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &TreasuryError{"NOT_FOUND", "This group has no savings account yet"}
	}
	if err != nil {
		return "", err
	}

	balance, err := GetGroupBalance(ctx, pool, in.OrgID)
	if err != nil {
		return "", err
	}
	if in.AmountKES > balance {
		return "", errors.New("that is more than the group currently holds")
	}

	policy, err := GetTreasuryPolicy(ctx, pool, in.OrgID)
	if err != nil {
		return "", err
	}
	if policy.RequireQuorateMeeting {
		quorate := false
		if in.MeetingID != nil {
			var present, activeCount, quorumPct int
			err = pool.QueryRow(ctx, `
				SELECT COALESCE((SELECT count(*) FROM attendance_record WHERE "meetingId" = $1 AND present), 0),
				       (SELECT count(*) FROM membership WHERE "orgId" = $2 AND "exitedAt" IS NULL),
				       COALESCE((SELECT "quorumPct" FROM meeting WHERE id = $1), 50)`,
				*in.MeetingID, in.OrgID).Scan(&present, &activeCount, &quorumPct)
			if err != nil {
				return "", err
			}
			quorate = activeCount > 0 && (present*100/activeCount) >= quorumPct
		}
		if !quorate {
			return "", errors.New("this group requires a quorate meeting behind a withdrawal request")
		}
	}

	now := time.Now()
	standbyOpensAt := ComputeStandbyOpensAt(now, policy.WithdrawalLeadMinutes, policy.ActiveHoursStart, policy.ActiveHoursEnd)

	var withdrawalID string
	err = pool.QueryRow(ctx, `
		INSERT INTO withdrawal_request (id, "orgId", "accountId", "meetingId", "requestedById", "amountKes",
			purpose, "payeeName", "payeeMsisdn", "requiredSigners", "broadcastAt", "standbyOpensAt", status)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING_SIGNATURES')
		RETURNING id`,
		in.OrgID, accountID, in.MeetingID, in.RequestedBy, in.AmountKES, in.Purpose, in.PayeeName,
		in.PayeeMsisdn, policy.RequiredSigners, now, standbyOpensAt).Scan(&withdrawalID)
	return withdrawalID, err
}

type SignWithdrawalResult struct {
	Status   string
	Executed bool
}

// SignWithdrawal mirrors signWithdrawal — a live, present-tense PIN
// re-verification (never a client "already verified" flag), one REJECT
// halts immediately.
func SignWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID, signerID, decision, pin, ip, sessionSecret string) (*SignWithdrawalResult, error) {
	var pinHash *string
	err := pool.QueryRow(ctx, `SELECT "pinHash" FROM user_credential WHERE "personId" = $1`, signerID).Scan(&pinHash)
	if errors.Is(err, pgx.ErrNoRows) || pinHash == nil {
		return nil, &TreasuryError{"NO_PIN_SET", "Set a PIN before signing"}
	}
	if err != nil {
		return nil, err
	}
	if !authsvc.VerifyPin(pin, *pinHash) {
		return nil, &TreasuryError{"WRONG_PIN", "Wrong PIN"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var orgID, status string
	err = tx.QueryRow(ctx, `SELECT "orgId", status::text FROM withdrawal_request WHERE id = $1 FOR UPDATE`, withdrawalID).Scan(&orgID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &TreasuryError{"NOT_FOUND", "Withdrawal request not found"}
	}
	if err != nil {
		return nil, err
	}
	if status != "PENDING_SIGNATURES" {
		return nil, &TreasuryError{"ALREADY_SETTLED", "This withdrawal has already been decided"}
	}

	signerIDs, err := GetEffectiveSignerIds(ctx, pool, orgID)
	if err != nil {
		return nil, err
	}
	isSigner := false
	for _, id := range signerIDs {
		if id == signerID {
			isSigner = true
			break
		}
	}
	if !isSigner {
		return nil, &TreasuryError{"NOT_A_SIGNER", "You are not a signer for this group"}
	}

	var alreadySigned bool
	err = tx.QueryRow(ctx, `SELECT true FROM withdrawal_signature WHERE "withdrawalId" = $1 AND "signerId" = $2`, withdrawalID, signerID).Scan(&alreadySigned)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if alreadySigned {
		return nil, &TreasuryError{"ALREADY_SIGNED", "You have already signed this withdrawal"}
	}

	signedAt := time.Now()
	signature := signWithdrawalSignature(sessionSecret, withdrawalID, signerID, decision, signedAt)
	_, err = tx.Exec(ctx, `
		INSERT INTO withdrawal_signature (id, "withdrawalId", "signerId", decision, "pinVerifiedAt", signature, "signedAt", ip)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
		withdrawalID, signerID, decision, signedAt, signature, signedAt, ip)
	if err != nil {
		return nil, err
	}

	if decision == "REJECT" {
		_, err = tx.Exec(ctx, `UPDATE withdrawal_request SET status = 'REJECTED', "decidedAt" = $1 WHERE id = $2`, signedAt, withdrawalID)
		if err != nil {
			return nil, err
		}
		return &SignWithdrawalResult{Status: "REJECTED"}, tx.Commit(ctx)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &SignWithdrawalResult{Status: "PENDING_SIGNATURES"}, nil
}

// ExecuteWithdrawalIfDue mirrors executeWithdrawalIfDue — requires BOTH
// the standby window elapsed AND the signature threshold met, never
// either alone. Meant to run from a periodic sweep (see
// SweepDueWithdrawals and cmd/api/main.go's ticker), not a request.
func ExecuteWithdrawalIfDue(ctx context.Context, pool *pgxpool.Pool, withdrawalID string) (string, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var orgID, accountID, status, purpose, payeeName, amountKESText string
	var standbyOpensAt time.Time
	var requiredSigners int
	err = tx.QueryRow(ctx, `
		SELECT "orgId", "accountId", status::text, purpose, "payeeName", "amountKes"::text, "standbyOpensAt", "requiredSigners"
		FROM withdrawal_request WHERE id = $1 FOR UPDATE`, withdrawalID).
		Scan(&orgID, &accountID, &status, &purpose, &payeeName, &amountKESText, &standbyOpensAt, &requiredSigners)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", &TreasuryError{"NOT_FOUND", "Withdrawal request not found"}
	}
	if err != nil {
		return "", err
	}
	if status != "PENDING_SIGNATURES" {
		return status, nil
	}
	if time.Now().Before(standbyOpensAt) {
		return "", &TreasuryError{"WINDOW_NOT_ELAPSED", "The standby window has not elapsed yet"}
	}

	var approvals int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM withdrawal_signature WHERE "withdrawalId" = $1 AND decision = 'APPROVE'`, withdrawalID).Scan(&approvals)
	if err != nil {
		return "", err
	}

	if approvals < requiredSigners {
		_, err = tx.Exec(ctx, `UPDATE withdrawal_request SET status = 'EXPIRED', "decidedAt" = now() WHERE id = $1`, withdrawalID)
		if err != nil {
			return "", err
		}
		return "EXPIRED", tx.Commit(ctx)
	}

	amountKES, err := strconv.ParseFloat(amountKESText, 64)
	if err != nil {
		return "", err
	}
	settlementID, err := findOrCreateSettlementAccountTx(ctx, tx)
	if err != nil {
		return "", err
	}
	var journalEntryID string
	err = tx.QueryRow(ctx, `
		INSERT INTO journal_entry (id, reference, description, "occurredAt", "recordedAt")
		VALUES (gen_random_uuid(), $1, $2, now(), now())
		RETURNING id`, "WITHDRAWAL-"+withdrawalID, "Withdrawal: "+purpose).Scan(&journalEntryID)
	if err != nil {
		return "", err
	}
	for _, p := range []ledger.Posting{{AccountID: accountID, AmountKES: -amountKES}, {AccountID: settlementID, AmountKES: amountKES}} {
		_, err = tx.Exec(ctx, `INSERT INTO posting (id, "entryId", "accountId", amount) VALUES (gen_random_uuid(), $1, $2, $3)`,
			journalEntryID, p.AccountID, p.AmountKES)
		if err != nil {
			return "", err
		}
	}

	_, err = tx.Exec(ctx, `
		UPDATE withdrawal_request SET status = 'EXECUTED', "decidedAt" = now(), "journalEntryId" = $1 WHERE id = $2`,
		journalEntryID, withdrawalID)
	if err != nil {
		return "", err
	}
	return "EXECUTED", tx.Commit(ctx)
}

// SweepDueWithdrawals — the periodic-sweep half of ExecuteWithdrawalIfDue.
// Called from a ticker in cmd/api/main.go, not from any HTTP handler.
func SweepDueWithdrawals(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	rows, err := pool.Query(ctx, `
		SELECT id FROM withdrawal_request WHERE status = 'PENDING_SIGNATURES' AND "standbyOpensAt" <= now()`)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()

	swept := 0
	for _, id := range ids {
		if _, err := ExecuteWithdrawalIfDue(ctx, pool, id); err != nil {
			continue // one bad row must not block the rest of the sweep
		}
		swept++
	}
	return swept, nil
}

type SignatureRow struct {
	SignerID   string
	SignerName string
	Decision   string
	SignedAt   time.Time
	Valid      bool
}

type WithdrawalRow struct {
	ID              string
	Status          string
	AmountKES       string
	Purpose         string
	PayeeName       string
	RequiredSigners int
	ApproveCount    int
	StandbyOpensAt  time.Time
	BroadcastAt     time.Time
	CanSign         bool
	Signatures      []SignatureRow
}

func ListWithdrawals(ctx context.Context, pool *pgxpool.Pool, orgID, sessionSecret string, limit int) ([]WithdrawalRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, status::text, "amountKes"::text, purpose, "payeeName", "requiredSigners", "standbyOpensAt", "broadcastAt"
		FROM withdrawal_request WHERE "orgId" = $1 ORDER BY "broadcastAt" DESC LIMIT $2`, orgID, limit)
	if err != nil {
		return nil, err
	}
	var out []WithdrawalRow
	for rows.Next() {
		var w WithdrawalRow
		if err := rows.Scan(&w.ID, &w.Status, &w.AmountKES, &w.Purpose, &w.PayeeName, &w.RequiredSigners, &w.StandbyOpensAt, &w.BroadcastAt); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, w)
	}
	rows.Close()

	for i := range out {
		sigs, approveCount, err := listSignatures(ctx, pool, out[i].ID, sessionSecret)
		if err != nil {
			return nil, err
		}
		out[i].Signatures = sigs
		out[i].ApproveCount = approveCount
	}
	return out, nil
}

func listSignatures(ctx context.Context, pool *pgxpool.Pool, withdrawalID, sessionSecret string) ([]SignatureRow, int, error) {
	rows, err := pool.Query(ctx, `
		SELECT ws."signerId", COALESCE(pe."knownAs", pe."officialName"), ws.decision::text, ws."signedAt", ws.signature
		FROM withdrawal_signature ws JOIN person pe ON pe."partyId" = ws."signerId"
		WHERE ws."withdrawalId" = $1 ORDER BY ws."signedAt" ASC`, withdrawalID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []SignatureRow
	approveCount := 0
	for rows.Next() {
		var s SignatureRow
		var signature string
		if err := rows.Scan(&s.SignerID, &s.SignerName, &s.Decision, &s.SignedAt, &signature); err != nil {
			return nil, 0, err
		}
		s.Valid = VerifyWithdrawalSignature(sessionSecret, withdrawalID, s.SignerID, s.Decision, s.SignedAt, signature)
		if s.Decision == "APPROVE" {
			approveCount++
		}
		out = append(out, s)
	}
	return out, approveCount, rows.Err()
}

func GetWithdrawal(ctx context.Context, pool *pgxpool.Pool, withdrawalID, viewerID, sessionSecret string) (*WithdrawalRow, error) {
	var w WithdrawalRow
	var orgID string
	err := pool.QueryRow(ctx, `
		SELECT id, "orgId", status::text, "amountKes"::text, purpose, "payeeName", "requiredSigners", "standbyOpensAt", "broadcastAt"
		FROM withdrawal_request WHERE id = $1`, withdrawalID).
		Scan(&w.ID, &orgID, &w.Status, &w.AmountKES, &w.Purpose, &w.PayeeName, &w.RequiredSigners, &w.StandbyOpensAt, &w.BroadcastAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	sigs, approveCount, err := listSignatures(ctx, pool, withdrawalID, sessionSecret)
	if err != nil {
		return nil, err
	}
	w.Signatures = sigs
	w.ApproveCount = approveCount

	signerIDs, err := GetEffectiveSignerIds(ctx, pool, orgID)
	if err != nil {
		return nil, err
	}
	isSigner, alreadySigned := false, false
	for _, id := range signerIDs {
		if id == viewerID {
			isSigner = true
		}
	}
	for _, s := range sigs {
		if s.SignerID == viewerID {
			alreadySigned = true
		}
	}
	w.CanSign = isSigner && !alreadySigned && w.Status == "PENDING_SIGNATURES"
	return &w, nil
}
