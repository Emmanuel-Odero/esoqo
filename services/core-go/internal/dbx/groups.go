// Package dbx (groups.go) ports the self-serve slice of
// packages/db/src/dal/groups.ts — founding/joining a group and reading
// its roster. Staff-side functions (createGroup, addNewMember,
// assignPersonToGroup, searchGroupsForStaff) stay TypeScript-only; there's
// no mobile admin console (see the plan's own scope note).
package dbx

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type GroupSummary struct {
	ID           string
	OfficialName string
	KnownAs      *string
	Kind         string
	County       string
	MemberCount  int
	// BalanceKES and PendingSignatures — the two figures the mobile
	// Chama hub's hero card needs. Computed inline here rather than
	// left to the per-group family providers (groupBalance/
	// pendingWithdrawals) the detail screen already watches, because
	// a list of N groups fetching both per row is an N+1 the hub
	// itself would trigger on open; SearchGroupsPublic's callers never
	// need either, so both are zero there.
	BalanceKES        string
	PendingSignatures int
}

// CreateOwnGroup mirrors createOwnGroup — the founder is seeded as
// CHAIRPERSON, not a bare MEMBER, so getEffectiveSignerIds' officer
// fallback makes them a signer from the moment the group exists, no
// separate signer-setup step.
func CreateOwnGroup(ctx context.Context, pool *pgxpool.Pool, founderPartyID, orgKind, officialName, knownAs, county string) (string, error) {
	officialName = strings.TrimSpace(officialName)
	if officialName == "" {
		return "", errors.New("a group name is required")
	}
	if county == "" {
		return "", errors.New("a county is required")
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var orgID string
	err = tx.QueryRow(ctx, `
		INSERT INTO party (id, kind, county, "sourceSystem", "updatedAt")
		VALUES (gen_random_uuid(), 'ORGANISATION', $1, 'ESOKO', now())
		RETURNING id`, county).Scan(&orgID)
	if err != nil {
		return "", err
	}

	var knownAsPtr *string
	if strings.TrimSpace(knownAs) != "" {
		k := strings.TrimSpace(knownAs)
		knownAsPtr = &k
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO organisation ("partyId", kind, "officialName", "knownAs")
		VALUES ($1, $2::"OrgKind", $3, $4)`, orgID, orgKind, officialName, knownAsPtr)
	if err != nil {
		return "", err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO account (id, "partyId", kind, currency)
		VALUES (gen_random_uuid(), $1, 'GROUP_SAVINGS', 'KES')`, orgID)
	if err != nil {
		return "", err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO membership (id, "personId", "orgId", role, status, "joinedAt")
		VALUES (gen_random_uuid(), $1, $2, 'CHAIRPERSON', 'ACTIVE', now())`, founderPartyID, orgID)
	if err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return orgID, nil
}

// ErrAlreadyMember — JoinGroup is idempotent about reinstating an exited
// membership (same as addMember) but returns this when the caller is
// already an active/pending member, since re-joining is a no-op a
// mobile UI should surface, not silently swallow.
var ErrAlreadyMember = errors.New("you are already a member of this group")

// JoinGroup is new — there's no self-serve equivalent in groups.ts
// (addMember is officer-gated, assignPersonToGroup is staff-only). It
// mirrors resolveJoinStatus's PENDING-if-join-fee-else-ACTIVE rule and
// addMember's idempotent reinstate-a-past-exit shape, just self-directed.
func JoinGroup(ctx context.Context, pool *pgxpool.Pool, personID, orgID string) (status string, err error) {
	var existingID string
	var exitedAt *string
	scanErr := pool.QueryRow(ctx, `
		SELECT id, "exitedAt"::text FROM membership WHERE "personId" = $1 AND "orgId" = $2`,
		personID, orgID).Scan(&existingID, &exitedAt)
	if scanErr == nil && exitedAt == nil {
		return "", ErrAlreadyMember
	}
	if scanErr != nil && !errors.Is(scanErr, pgx.ErrNoRows) {
		return "", scanErr
	}
	hasExitedRow := scanErr == nil // found a row, but it's a past exit

	joinStatus, err := resolveJoinStatus(ctx, pool, orgID)
	if err != nil {
		return "", err
	}

	if hasExitedRow {
		_, err = pool.Exec(ctx, `
			UPDATE membership SET "exitedAt" = NULL, status = $1, "joinedAt" = now() WHERE id = $2`,
			joinStatus, existingID)
		return joinStatus, err
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO membership (id, "personId", "orgId", role, status, "joinedAt")
		VALUES (gen_random_uuid(), $1, $2, 'MEMBER', $3, now())`, personID, orgID, joinStatus)
	if err != nil {
		return "", err
	}
	return joinStatus, nil
}

// resolveJoinStatus mirrors groups.ts's own resolveJoinStatus.
func resolveJoinStatus(ctx context.Context, pool *pgxpool.Pool, orgID string) (string, error) {
	var joinFeeKES *string
	err := pool.QueryRow(ctx, `SELECT "joinFeeKes"::text FROM group_treasury_policy WHERE "orgId" = $1`, orgID).Scan(&joinFeeKES)
	if errors.Is(err, pgx.ErrNoRows) || joinFeeKES == nil || *joinFeeKES == "0.00" || *joinFeeKES == "0" {
		return "ACTIVE", nil
	}
	if err != nil {
		return "", err
	}
	return "PENDING", nil
}

type MemberRow struct {
	MembershipID string
	PersonID     string
	Name         string
	Msisdn       *string
	Role         string
	CustomRole   *string
	Status       string
}

type GroupDetail struct {
	GroupSummary
	Members []MemberRow
}

func GetGroup(ctx context.Context, pool *pgxpool.Pool, orgID string) (*GroupDetail, error) {
	var d GroupDetail
	err := pool.QueryRow(ctx, `
		SELECT o."partyId", o."officialName", o."knownAs", o.kind::text, p.county
		FROM organisation o JOIN party p ON p.id = o."partyId"
		WHERE o."partyId" = $1`, orgID).
		Scan(&d.ID, &d.OfficialName, &d.KnownAs, &d.Kind, &d.County)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	rows, err := pool.Query(ctx, `
		SELECT m.id, m."personId", COALESCE(pe."knownAs", pe."officialName"), pe.msisdn, m.role::text, m."customRole", m.status::text
		FROM membership m
		JOIN person pe ON pe."partyId" = m."personId"
		WHERE m."orgId" = $1 AND m."exitedAt" IS NULL
		ORDER BY m."joinedAt" ASC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m MemberRow
		if err := rows.Scan(&m.MembershipID, &m.PersonID, &m.Name, &m.Msisdn, &m.Role, &m.CustomRole, &m.Status); err != nil {
			return nil, err
		}
		d.Members = append(d.Members, m)
	}
	d.MemberCount = len(d.Members)
	return &d, rows.Err()
}

// ListMyGroups — every group this person actively (or pending-ly)
// belongs to, newest membership first. Balance and pending-signature
// count ride along as correlated subqueries rather than a second
// round trip per group:
//
//   - balance mirrors GetGroupBalance exactly (sum of GROUP_SAVINGS
//     postings) — derived, never stored, same as that function.
//   - pendingSignatures mirrors GetEffectiveSignerIds' own fallback
//     (explicit group_signer rows if any exist, else the officer
//     roles) intersected with withdrawal_request rows this person
//     hasn't signed yet. Kept in sync by hand with that Go function
//     since there's no single source both can share across a SQL/Go
//     boundary — if the signer-eligibility rule changes there, it
//     has to change here too.
func ListMyGroups(ctx context.Context, pool *pgxpool.Pool, personID string) ([]GroupSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT o."partyId", o."officialName", o."knownAs", o.kind::text, p.county,
		       (SELECT count(*) FROM membership m2 WHERE m2."orgId" = o."partyId" AND m2."exitedAt" IS NULL),
		       COALESCE((
		         SELECT SUM(pst.amount)::text FROM posting pst
		         JOIN account a ON a.id = pst."accountId"
		         WHERE a."partyId" = o."partyId" AND a.kind = 'GROUP_SAVINGS'
		       ), '0'),
		       (SELECT count(*) FROM withdrawal_request wr
		        WHERE wr."orgId" = o."partyId" AND wr.status = 'PENDING_SIGNATURES'
		          AND NOT EXISTS (
		            SELECT 1 FROM withdrawal_signature ws
		            WHERE ws."withdrawalId" = wr.id AND ws."signerId" = $1
		          )
		          AND (
		            EXISTS (
		              SELECT 1 FROM group_signer gs
		              WHERE gs."orgId" = o."partyId" AND gs."removedAt" IS NULL AND gs."personId" = $1
		            )
		            OR (
		              NOT EXISTS (
		                SELECT 1 FROM group_signer gs2
		                WHERE gs2."orgId" = o."partyId" AND gs2."removedAt" IS NULL
		              )
		              AND EXISTS (
		                SELECT 1 FROM membership m3
		                WHERE m3."orgId" = o."partyId" AND m3."personId" = $1 AND m3."exitedAt" IS NULL
		                  AND m3.role IN ('CHAIRPERSON', 'TREASURER', 'SECRETARY')
		              )
		            )
		          )
		       )
		FROM membership m
		JOIN organisation o ON o."partyId" = m."orgId"
		JOIN party p ON p.id = o."partyId"
		WHERE m."personId" = $1 AND m."exitedAt" IS NULL
		ORDER BY m."joinedAt" DESC`, personID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GroupSummary
	for rows.Next() {
		var g GroupSummary
		if err := rows.Scan(&g.ID, &g.OfficialName, &g.KnownAs, &g.Kind, &g.County, &g.MemberCount,
			&g.BalanceKES, &g.PendingSignatures); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// SearchGroupsPublic mirrors searchGroupsPublic — anonymous, name-only,
// no PII, so a joiner can link to a real Organisation instead of typing
// a name that goes nowhere. JOINABLE_GROUP_KINDS excludes BUSINESS.
func SearchGroupsPublic(ctx context.Context, pool *pgxpool.Pool, q string) ([]GroupSummary, error) {
	if len(strings.TrimSpace(q)) < 2 {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT o."partyId", o."officialName", o."knownAs", o.kind::text, p.county, 0
		FROM organisation o JOIN party p ON p.id = o."partyId"
		WHERE p."deletedAt" IS NULL AND o.kind != 'BUSINESS'
		  AND (o."officialName" ILIKE '%' || $1 || '%' OR o."knownAs" ILIKE '%' || $1 || '%')
		LIMIT 8`, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GroupSummary
	for rows.Next() {
		var g GroupSummary
		if err := rows.Scan(&g.ID, &g.OfficialName, &g.KnownAs, &g.Kind, &g.County, &g.MemberCount); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}
