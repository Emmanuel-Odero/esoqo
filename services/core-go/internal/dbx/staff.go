package dbx

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TicketStaff is the sign-in projection of ticket_org_staff — never
// exposes anything beyond what the PIN check needs.
type TicketStaff struct {
	ID      string
	OrgID   string
	Name    string
	Role    string
	Active  bool
	PinHash string
}

// FindTicketStaffForSignIn ports TS getTicketOrgStaffPinHashForSignIn:
// scoped by org slug (public knowledge, same trust boundary as the
// storefront), resolved by name in free text, null on miss so the caller
// verifies against DummyPinHash and keeps wrong-name/wrong-PIN
// indistinguishable.
func FindTicketStaffForSignIn(ctx context.Context, pool *pgxpool.Pool, orgSlug, name string) (*TicketStaff, error) {
	var orgID, orgStatus string
	err := pool.QueryRow(ctx, `SELECT id, status::text FROM ticket_org WHERE slug = $1`, orgSlug).Scan(&orgID, &orgStatus)
	if errors.Is(err, pgx.ErrNoRows) || orgStatus != "ACTIVE" {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var s TicketStaff
	err = pool.QueryRow(ctx, `
		SELECT id, "orgId", name, role, active, "pinHash"
		FROM ticket_org_staff
		WHERE "orgId" = $1 AND active = true AND LOWER(name) = LOWER($2)`,
		orgID, name).Scan(&s.ID, &s.OrgID, &s.Name, &s.Role, &s.Active, &s.PinHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}
