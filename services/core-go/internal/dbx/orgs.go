// Package dbx (orgs.go) — Generic organization data access layer.
//
// This file provides database access functions for the polymorphic org system,
// supporting any organization type (courier, hotel, eatery, chama, tout, etc.)
// through a unified interface. It replaces courier-specific functions like
// GetParcelOrg, ListMyParcelOrgs, etc. with generic equivalents.
//
// The org table stores all organization types with a 'type' discriminator,
// org_staff stores all staff members across org types, and org_config stores
// flexible type-specific configuration.
package dbx

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OrgStatus values
const (
	OrgStatusDraft     = "DRAFT"
	OrgStatusActive    = "ACTIVE"
	OrgStatusSuspended = "SUSPENDED"
)

// Org represents a generic organization (courier, hotel, eatery, chama, etc.)
type Org struct {
	ID           string
	Type         string // 'courier', 'hotel', 'eatery', 'chama', 'tout'
	EnterpriseID *string
	Name         string
	Slug         string
	Status       string
	Metadata     json.RawMessage // Type-specific data as JSON
	CreatedAt    string
	UpdatedAt    string
}

// OrgStaff represents a staff member at an organization
type OrgStaff struct {
	ID                   string
	OrgID                string
	PartyID              *string
	Name                 string
	Role                 string
	CustomCapabilities   []string
	Active               bool
	IsContact            bool
	CreatedAt            string
	UpdatedAt            string
}

// OrgConfig represents a configuration entry for an organization
type OrgConfig struct {
	ID         string
	OrgID      string
	ConfigKey  string
	ConfigData json.RawMessage
	Priority   int
	CreatedAt  string
	UpdatedAt  string
}

// MyOrg represents an organization from the perspective of a staff member
type MyOrg struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Status string `json:"status"`
	Role   string `json:"role"`
}

// GetOrg retrieves a single organization by ID
func GetOrg(ctx context.Context, pool *pgxpool.Pool, orgID string) (*Org, error) {
	var org Org
	err := pool.QueryRow(ctx, `
		SELECT id, type, "enterpriseId", name, slug, status, metadata, "createdAt", "updatedAt"
		FROM "org"
		WHERE id = $1
	`, orgID).Scan(
		&org.ID, &org.Type, &org.EnterpriseID, &org.Name, &org.Slug,
		&org.Status, &org.Metadata, &org.CreatedAt, &org.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &org, nil
}

// GetOrgBySlug retrieves an organization by slug and type
func GetOrgBySlug(ctx context.Context, pool *pgxpool.Pool, slug string, orgType string) (*Org, error) {
	var org Org
	err := pool.QueryRow(ctx, `
		SELECT id, type, "enterpriseId", name, slug, status, metadata, "createdAt", "updatedAt"
		FROM "org"
		WHERE slug = $1 AND type = $2 AND status != $3
	`, slug, orgType, OrgStatusDraft).Scan(
		&org.ID, &org.Type, &org.EnterpriseID, &org.Name, &org.Slug,
		&org.Status, &org.Metadata, &org.CreatedAt, &org.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &org, nil
}

// ListMyOrgs lists all organizations a person is staff of
func ListMyOrgs(ctx context.Context, pool *pgxpool.Pool, partyID string) ([]MyOrg, error) {
	rows, err := pool.Query(ctx, `
		SELECT o.id, o.type, o.name, o.slug, o.status, os.role
		FROM "org" o
		JOIN "org_staff" os ON os."orgId" = o.id
		WHERE os."partyId" = $1 AND os.active
		ORDER BY o.name ASC
	`, partyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orgs []MyOrg
	for rows.Next() {
		var org MyOrg
		if err := rows.Scan(&org.ID, &org.Type, &org.Name, &org.Slug, &org.Status, &org.Role); err != nil {
			return nil, err
		}
		orgs = append(orgs, org)
	}
	return orgs, rows.Err()
}

// ListOrgsByType lists all organizations of a specific type
func ListOrgsByType(ctx context.Context, pool *pgxpool.Pool, orgType string) ([]Org, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, type, "enterpriseId", name, slug, status, metadata, "createdAt", "updatedAt"
		FROM "org"
		WHERE type = $1
		ORDER BY name ASC
	`, orgType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orgs []Org
	for rows.Next() {
		var org Org
		if err := rows.Scan(
			&org.ID, &org.Type, &org.EnterpriseID, &org.Name, &org.Slug,
			&org.Status, &org.Metadata, &org.CreatedAt, &org.UpdatedAt,
		); err != nil {
			return nil, err
		}
		orgs = append(orgs, org)
	}
	return orgs, rows.Err()
}

// FindOrgStaff finds a staff member in an organization
func FindOrgStaff(ctx context.Context, pool *pgxpool.Pool, orgID string, staffID string) (*OrgStaff, error) {
	var staff OrgStaff
	err := pool.QueryRow(ctx, `
		SELECT id, "orgId", "partyId", name, role, "customCapabilities", active, "isContact", "createdAt", "updatedAt"
		FROM "org_staff"
		WHERE "orgId" = $1 AND id = $2
	`, orgID, staffID).Scan(
		&staff.ID, &staff.OrgID, &staff.PartyID, &staff.Name, &staff.Role,
		&staff.CustomCapabilities, &staff.Active, &staff.IsContact, &staff.CreatedAt, &staff.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &staff, nil
}

// FindOrgStaffByParty finds a staff member by party ID (person) in an organization
func FindOrgStaffByParty(ctx context.Context, pool *pgxpool.Pool, orgID string, partyID string) (*OrgStaff, error) {
	var staff OrgStaff
	err := pool.QueryRow(ctx, `
		SELECT id, "orgId", "partyId", name, role, "customCapabilities", active, "isContact", "createdAt", "updatedAt"
		FROM "org_staff"
		WHERE "orgId" = $1 AND "partyId" = $2 AND active
	`, orgID, partyID).Scan(
		&staff.ID, &staff.OrgID, &staff.PartyID, &staff.Name, &staff.Role,
		&staff.CustomCapabilities, &staff.Active, &staff.IsContact, &staff.CreatedAt, &staff.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &staff, nil
}

// ListOrgStaff lists all active staff in an organization
func ListOrgStaff(ctx context.Context, pool *pgxpool.Pool, orgID string) ([]OrgStaff, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, "orgId", "partyId", name, role, "customCapabilities", active, "isContact", "createdAt", "updatedAt"
		FROM "org_staff"
		WHERE "orgId" = $1 AND active
		ORDER BY name ASC
	`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var staff []OrgStaff
	for rows.Next() {
		var s OrgStaff
		if err := rows.Scan(
			&s.ID, &s.OrgID, &s.PartyID, &s.Name, &s.Role,
			&s.CustomCapabilities, &s.Active, &s.IsContact, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, err
		}
		staff = append(staff, s)
	}
	return staff, rows.Err()
}

// GetOrgConfig retrieves a configuration entry for an organization
func GetOrgConfig(ctx context.Context, pool *pgxpool.Pool, orgID string, configKey string) (*OrgConfig, error) {
	var config OrgConfig
	err := pool.QueryRow(ctx, `
		SELECT id, "orgId", "configKey", "configData", priority, "createdAt", "updatedAt"
		FROM "org_config"
		WHERE "orgId" = $1 AND "configKey" = $2
	`, orgID, configKey).Scan(
		&config.ID, &config.OrgID, &config.ConfigKey, &config.ConfigData,
		&config.Priority, &config.CreatedAt, &config.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// ListOrgConfigs lists all configuration entries for an organization
// If prefix is non-empty, only returns configs with keys starting with that prefix
func ListOrgConfigs(ctx context.Context, pool *pgxpool.Pool, orgID string, prefix string) ([]OrgConfig, error) {
	var query string
	var args []interface{}

	if prefix != "" {
		query = `
			SELECT id, "orgId", "configKey", "configData", priority, "createdAt", "updatedAt"
			FROM "org_config"
			WHERE "orgId" = $1 AND "configKey" LIKE $2
			ORDER BY priority ASC, "configKey" ASC
		`
		args = []interface{}{orgID, prefix + "%"}
	} else {
		query = `
			SELECT id, "orgId", "configKey", "configData", priority, "createdAt", "updatedAt"
			FROM "org_config"
			WHERE "orgId" = $1
			ORDER BY priority ASC, "configKey" ASC
		`
		args = []interface{}{orgID}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var configs []OrgConfig
	for rows.Next() {
		var c OrgConfig
		if err := rows.Scan(
			&c.ID, &c.OrgID, &c.ConfigKey, &c.ConfigData,
			&c.Priority, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		configs = append(configs, c)
	}
	return configs, rows.Err()
}

// UpsertOrgConfig creates or updates a configuration entry
func UpsertOrgConfig(ctx context.Context, pool *pgxpool.Pool, orgID string, configKey string, configData json.RawMessage, priority int) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO "org_config" ("id", "orgId", "configKey", "configData", "priority", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT ("orgId", "configKey")
		DO UPDATE SET "configData" = $3, "priority" = $4, "updatedAt" = NOW()
	`, orgID, configKey, configData, priority)
	return err
}

// CreateOrgStaff creates a new staff member in an organization
func CreateOrgStaff(ctx context.Context, pool *pgxpool.Pool, orgID string, partyID *string, name string, role string) (*OrgStaff, error) {
	var staff OrgStaff
	err := pool.QueryRow(ctx, `
		INSERT INTO "org_staff" ("id", "orgId", "partyId", "name", "role", "active", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, true, NOW(), NOW())
		RETURNING id, "orgId", "partyId", name, role, "customCapabilities", active, "isContact", "createdAt", "updatedAt"
	`, orgID, partyID, name, role).Scan(
		&staff.ID, &staff.OrgID, &staff.PartyID, &staff.Name, &staff.Role,
		&staff.CustomCapabilities, &staff.Active, &staff.IsContact, &staff.CreatedAt, &staff.UpdatedAt,
	)
	return &staff, err
}

// DeleteOrgStaff soft-deletes a staff member (sets active=false)
func DeleteOrgStaff(ctx context.Context, pool *pgxpool.Pool, staffID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE "org_staff"
		SET active = false, "updatedAt" = NOW()
		WHERE id = $1
	`, staffID)
	return err
}

// CreateOrg creates a new organization
func CreateOrg(ctx context.Context, pool *pgxpool.Pool, orgType string, enterpriseID *string, name string, slug string, metadata json.RawMessage) (*Org, error) {
	var org Org
	err := pool.QueryRow(ctx, `
		INSERT INTO "org" ("id", "type", "enterpriseId", "name", "slug", "status", "metadata", "createdAt", "updatedAt")
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
		RETURNING id, type, "enterpriseId", name, slug, status, metadata, "createdAt", "updatedAt"
	`, orgType, enterpriseID, name, slug, OrgStatusDraft, metadata).Scan(
		&org.ID, &org.Type, &org.EnterpriseID, &org.Name, &org.Slug,
		&org.Status, &org.Metadata, &org.CreatedAt, &org.UpdatedAt,
	)
	return &org, err
}

// UpdateOrgStatus updates the status of an organization
func UpdateOrgStatus(ctx context.Context, pool *pgxpool.Pool, orgID string, status string) error {
	_, err := pool.Exec(ctx, `
		UPDATE "org"
		SET status = $1, "updatedAt" = NOW()
		WHERE id = $2
	`, status, orgID)
	return err
}

// UpdateOrgMetadata updates the metadata for an organization
func UpdateOrgMetadata(ctx context.Context, pool *pgxpool.Pool, orgID string, metadata json.RawMessage) error {
	_, err := pool.Exec(ctx, `
		UPDATE "org"
		SET metadata = $1, "updatedAt" = NOW()
		WHERE id = $2
	`, metadata, orgID)
	return err
}

// OrgExistsError represents a conflict when creating an org with a duplicate slug
type OrgExistsError struct {
	Slug    string
	OrgType string
}

func (e *OrgExistsError) Error() string {
	return "organization " + e.OrgType + " with slug " + e.Slug + " already exists"
}

// CountOrgsByTypeAndStatus counts organizations by type and status
func CountOrgsByTypeAndStatus(ctx context.Context, pool *pgxpool.Pool, orgType string, status string) (int, error) {
	var count int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM "org"
		WHERE type = $1 AND status = $2
	`, orgType, status).Scan(&count)
	return count, err
}

// ArchiveOrg archives (soft-deletes) an organization by setting status to SUSPENDED
func ArchiveOrg(ctx context.Context, pool *pgxpool.Pool, orgID string) error {
	return UpdateOrgStatus(ctx, pool, orgID, OrgStatusSuspended)
}

// GetOrgMetadataField extracts a specific field from org metadata
// Returns the field value or nil if not found
func GetOrgMetadataField(ctx context.Context, pool *pgxpool.Pool, orgID string, fieldPath string) (interface{}, error) {
	var metadata json.RawMessage
	err := pool.QueryRow(ctx, `
		SELECT metadata->$1
		FROM "org"
		WHERE id = $2
	`, fieldPath, orgID).Scan(&metadata)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var value interface{}
	if err := json.Unmarshal(metadata, &value); err != nil {
		return nil, err
	}
	return value, nil
}

// OrgDoesNotExistError represents an error when accessing a non-existent org
type OrgDoesNotExistError struct {
	OrgID string
}

func (e *OrgDoesNotExistError) Error() string {
	return "organization " + e.OrgID + " does not exist"
}

// RequireOrg is a helper that returns an error if org doesn't exist
func RequireOrg(ctx context.Context, pool *pgxpool.Pool, orgID string) (*Org, error) {
	org, err := GetOrg(ctx, pool, orgID)
	if err != nil {
		return nil, err
	}
	if org == nil {
		return nil, &OrgDoesNotExistError{OrgID: orgID}
	}
	return org, nil
}

// ValidateOrgOwnership validates that a party owns/staffs an organization
func ValidateOrgOwnership(ctx context.Context, pool *pgxpool.Pool, orgID string, partyID string) (bool, error) {
	var count int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM "org_staff"
		WHERE "orgId" = $1 AND "partyId" = $2 AND active
	`, orgID, partyID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// BatchCreateOrgStaff creates multiple staff members at once
func BatchCreateOrgStaff(ctx context.Context, pool *pgxpool.Pool, orgID string, staffList []struct {
	PartyID *string
	Name    string
	Role    string
}) ([]OrgStaff, error) {
	var result []OrgStaff

	for _, s := range staffList {
		staff, err := CreateOrgStaff(ctx, pool, orgID, s.PartyID, s.Name, s.Role)
		if err != nil {
			return nil, err
		}
		result = append(result, *staff)
	}

	return result, nil
}

// SearchOrgsByName searches organizations by name (case-insensitive)
func SearchOrgsByName(ctx context.Context, pool *pgxpool.Pool, query string, limit int) ([]Org, error) {
	if limit <= 0 {
		limit = 10
	}

	rows, err := pool.Query(ctx, `
		SELECT id, type, "enterpriseId", name, slug, status, metadata, "createdAt", "updatedAt"
		FROM "org"
		WHERE name ILIKE $1
		ORDER BY name ASC
		LIMIT $2
	`, "%"+query+"%", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orgs []Org
	for rows.Next() {
		var org Org
		if err := rows.Scan(
			&org.ID, &org.Type, &org.EnterpriseID, &org.Name, &org.Slug,
			&org.Status, &org.Metadata, &org.CreatedAt, &org.UpdatedAt,
		); err != nil {
			return nil, err
		}
		orgs = append(orgs, org)
	}
	return orgs, rows.Err()
}

// OrgStaffWithPin holds a staff row plus the PIN hash needed for sign-in.
type OrgStaffWithPin struct {
	OrgStaff
	PinHash string
}

// FindOrgStaffByName looks up a staff member by name (case-insensitive) and
// returns the PIN hash for authentication. Used by the generic staff sign-in
// flow. Returns nil if no active staff member with that name exists in the org.
func FindOrgStaffByName(ctx context.Context, pool *pgxpool.Pool, orgID string, name string) (*OrgStaffWithPin, error) {
	var s OrgStaffWithPin
	err := pool.QueryRow(ctx, `
		SELECT
			os.id, os."orgId", os."partyId", os.name, os.role,
			COALESCE(os."customCapabilities", ARRAY[]::TEXT[]),
			os.active, COALESCE(os."isContact", false),
			os."createdAt", os."updatedAt",
			COALESCE(osp."pinHash", '') AS "pinHash"
		FROM "org_staff" os
		LEFT JOIN "org_staff_pin" osp ON osp."staffId" = os.id
		WHERE os."orgId" = $1
		  AND LOWER(os.name) = LOWER($2)
		  AND os.active = true
		LIMIT 1
	`, orgID, name).Scan(
		&s.ID, &s.OrgID, &s.PartyID, &s.Name, &s.Role,
		&s.CustomCapabilities, &s.Active, &s.IsContact,
		&s.CreatedAt, &s.UpdatedAt,
		&s.PinHash,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}
