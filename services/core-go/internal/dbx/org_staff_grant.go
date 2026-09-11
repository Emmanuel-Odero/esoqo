// Package dbx (org_staff_grant.go) — unified crew identity
// (docs/proposals/esoko-unified-crew-identity.md). A grant makes a real
// Party *eligible* to act as SCANNER/MANAGER/ADMIN/CREW staff for one
// TicketOrg; it never authorises anything by itself — every org-scoped
// request also needs a live authsvc.OrgContextService activation, and
// every activation attempt re-checks the grant's status here, live, so
// a suspension bites mid-shift rather than only at next login.
package dbx

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/esoko/core-go/internal/authsvc"
)

var (
	ErrGrantNotFound = errors.New("no staff grant found for that person and org")
	ErrGrantExists   = errors.New("that person already holds a staff grant for this org")
)

type OrgStaffGrant struct {
	ID          string
	OrgID       string
	PartyID     string
	Role        string // SCANNER | MANAGER | ADMIN | CREW
	Status      string // active | suspended
	GrantedBy   string
	SuspendedBy *string
	SuspendedAt *time.Time
	// CrewMemberID — set only for role = CREW; mirrors
	// TicketOrgStaff.crewMemberId (see dbx.CreateTicketOrgStaff's own
	// comment). Resolved fresh on every trip.close:own check via
	// CrewMemberIDForGrant, never cached on Ctx.
	CrewMemberID *string
	CreatedAt    time.Time
	UpdatedAt    time.Time

	// Joined display fields — populated by ListOrgStaffGrants* only.
	PartyName   string
	PartyMsisdn *string
	OrgName     string
}

// CreateOrgStaffGrant — org owner/admin-staff onboards a crew member who
// already holds an Esoko account (partyID resolved by the caller via
// FindPersonByMsisdn first; there is no account-less path by design, see
// the proposal's "crew must have accounts" decision). Upserts on
// (orgId, partyId): re-granting a previously suspended person reinstates
// the same row with a fresh role rather than leaving a stale duplicate.
//
// crewMemberID mirrors CreateTicketOrgStaff's own contract exactly:
// only meaningful (and only persisted) for role == "CREW" — any other
// role passing one is a caller mistake, silently dropped rather than
// letting a MANAGER/ADMIN grant end up impersonating a crew member's
// trip access.
func CreateOrgStaffGrant(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, partyID, role string, crewMemberID *string) (*OrgStaffGrant, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTicketOrgStaff); err != nil {
		return nil, err
	}
	if role != "CREW" {
		crewMemberID = nil
	}
	if crewMemberID != nil && strings.TrimSpace(*crewMemberID) != "" {
		var crewOrg string
		if err := pool.QueryRow(ctx, `SELECT "orgId" FROM crew_member WHERE id = $1`, *crewMemberID).Scan(&crewOrg); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, &OrgError{"NOT_FOUND", "Crew member not found"}
			}
			return nil, err
		}
		if crewOrg != orgID {
			return nil, &OrgError{"BAD_INPUT", "That crew member belongs to another organiser"}
		}
	} else {
		crewMemberID = nil
	}
	var g OrgStaffGrant
	err := pool.QueryRow(ctx, `
		INSERT INTO org_staff_grant ("orgId", "partyId", role, status, "grantedBy", "crewMemberId", "updatedAt")
		VALUES ($1, $2, $3, 'active', $4, $5, now())
		ON CONFLICT ("orgId", "partyId") DO UPDATE SET
			role = EXCLUDED.role, status = 'active',
			"grantedBy" = EXCLUDED."grantedBy", "crewMemberId" = EXCLUDED."crewMemberId",
			"suspendedBy" = NULL, "suspendedAt" = NULL, "updatedAt" = now()
		RETURNING id, "orgId", "partyId", role, status, "grantedBy", "suspendedBy", "suspendedAt", "crewMemberId", "createdAt", "updatedAt"`,
		orgID, partyID, role, c.PartyID, crewMemberID).
		Scan(&g.ID, &g.OrgID, &g.PartyID, &g.Role, &g.Status, &g.GrantedBy, &g.SuspendedBy, &g.SuspendedAt, &g.CrewMemberID, &g.CreatedAt, &g.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

// GetOrgStaffGrant — the one live check every activation attempt and
// every capability-layering request makes. Deliberately capability-free
// (mirrors FindPersonByMsisdn's own "pre-auth lookup" contract): the
// caller is always asking about themselves via their own session, or is
// an org admin who has already passed AssertOwnsOrg via a sibling call.
func GetOrgStaffGrant(ctx context.Context, pool *pgxpool.Pool, orgID, partyID string) (*OrgStaffGrant, error) {
	var g OrgStaffGrant
	err := pool.QueryRow(ctx, `
		SELECT id, "orgId", "partyId", role, status, "grantedBy", "suspendedBy", "suspendedAt", "crewMemberId", "createdAt", "updatedAt"
		FROM org_staff_grant WHERE "orgId" = $1 AND "partyId" = $2`,
		orgID, partyID).
		Scan(&g.ID, &g.OrgID, &g.PartyID, &g.Role, &g.Status, &g.GrantedBy, &g.SuspendedBy, &g.SuspendedAt, &g.CrewMemberID, &g.CreatedAt, &g.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

// CrewMemberIDForGrant resolves a CREW SUBJECT-context grant's linked
// CrewMember — the org-context-activation equivalent of fleet.go's
// crewMemberIDForStaff (AGENT path). Looked up fresh from the database
// on every call, same reasoning: a manager re-linking or unlinking takes
// effect on the very next request, never a stale grant.
func CrewMemberIDForGrant(ctx context.Context, pool *pgxpool.Pool, orgID, partyID string) (string, error) {
	var crewMemberID *string
	err := pool.QueryRow(ctx, `SELECT "crewMemberId" FROM org_staff_grant WHERE "orgId" = $1 AND "partyId" = $2`, orgID, partyID).Scan(&crewMemberID)
	if errors.Is(err, pgx.ErrNoRows) || crewMemberID == nil {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return *crewMemberID, nil
}

// ListOrgStaffGrantsForOrg — the manager-facing roster: who can act as
// staff for this org, and their current status.
func ListOrgStaffGrantsForOrg(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID string) ([]OrgStaffGrant, error) {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTicketOrgStaff); err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, `
		SELECT g.id, g."orgId", g."partyId", g.role, g.status, g."grantedBy", g."suspendedBy", g."suspendedAt", g."crewMemberId", g."createdAt", g."updatedAt",
		       pr."officialName", pr.msisdn
		FROM org_staff_grant g
		JOIN person pr ON pr."partyId" = g."partyId"
		WHERE g."orgId" = $1
		ORDER BY g."createdAt" DESC`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrgStaffGrant
	for rows.Next() {
		var g OrgStaffGrant
		if err := rows.Scan(&g.ID, &g.OrgID, &g.PartyID, &g.Role, &g.Status, &g.GrantedBy, &g.SuspendedBy, &g.SuspendedAt, &g.CrewMemberID, &g.CreatedAt, &g.UpdatedAt, &g.PartyName, &g.PartyMsisdn); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ListOrgStaffGrantsForParty — the switcher's data source: every org a
// signed-in person can additionally act for. Self-scoped by partyID,
// which the caller must take from the session (ctx.PartyID), never a
// request param — there is nothing to authorise beyond "this is you".
func ListOrgStaffGrantsForParty(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]OrgStaffGrant, error) {
	rows, err := pool.Query(ctx, `
		SELECT g.id, g."orgId", g."partyId", g.role, g.status, g."grantedBy", g."suspendedBy", g."suspendedAt", g."crewMemberId", g."createdAt", g."updatedAt",
		       o.name
		FROM org_staff_grant g
		JOIN ticket_org o ON o.id = g."orgId"
		WHERE g."partyId" = $1
		ORDER BY g."createdAt" DESC`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrgStaffGrant
	for rows.Next() {
		var g OrgStaffGrant
		if err := rows.Scan(&g.ID, &g.OrgID, &g.PartyID, &g.Role, &g.Status, &g.GrantedBy, &g.SuspendedBy, &g.SuspendedAt, &g.CrewMemberID, &g.CreatedAt, &g.UpdatedAt, &g.OrgName); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// SuspendOrgStaffGrant — an owner/ADMIN-staff kill switch. The caller
// (handler) must also call OrgContextService.Deactivate for the same
// (orgID, partyID) in the same request so a live session loses its
// staff capabilities immediately rather than waiting out the Redis TTL;
// this function only owns the durable status, not the live activation.
func SuspendOrgStaffGrant(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, partyID string) error {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTicketOrgStaff); err != nil {
		return err
	}
	tag, err := pool.Exec(ctx, `
		UPDATE org_staff_grant SET status = 'suspended', "suspendedBy" = $3, "suspendedAt" = now(), "updatedAt" = now()
		WHERE "orgId" = $1 AND "partyId" = $2`, orgID, partyID, c.PartyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrGrantNotFound
	}
	return nil
}

// ReinstateOrgStaffGrant — deliberate two-step per the proposal: this
// only clears the suspension. It never restores a live activation — the
// next context-activation attempt still requires OTP, exactly like any
// other lapsed activation, suspension or not.
func ReinstateOrgStaffGrant(ctx context.Context, pool *pgxpool.Pool, c authsvc.Ctx, orgID, partyID string) error {
	if _, err := AssertOwnsOrg(ctx, pool, c, orgID, authsvc.CapTicketOrgStaff); err != nil {
		return err
	}
	tag, err := pool.Exec(ctx, `
		UPDATE org_staff_grant SET status = 'active', "suspendedBy" = NULL, "suspendedAt" = NULL, "updatedAt" = now()
		WHERE "orgId" = $1 AND "partyId" = $2 AND status = 'suspended'`, orgID, partyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrGrantNotFound
	}
	return nil
}
