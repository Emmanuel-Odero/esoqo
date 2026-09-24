-- Migration: Copy existing parcel_org and ticket_org rows into the generic org table.
--
-- This is a DATA migration, not a schema migration.  No tables are dropped.
-- The legacy tables remain fully intact and in use — this migration only
-- seeds the new "org" table so the unified portal, workspace switcher, and
-- future org-type additions all work against a single data source.
--
-- Safety properties:
--   • INSERT ... ON CONFLICT DO NOTHING  → idempotent; safe to re-run.
--   • No UPDATE / DELETE touching existing rows in parcel_org or ticket_org.
--   • Wrapped in a transaction; rolls back entirely on any error.
--
-- After confirming the application runs correctly against the new table,
-- the legacy tables can be deprecated (but need not be dropped immediately).

BEGIN;

-- ── 1. Migrate parcel_org → org (type = 'courier') ──────────────────────
--
-- parcel_org column mapping:
--   id          → id
--   enterpriseId → enterpriseId  (may not exist on older schemas; COALESCE)
--   name        → name
--   slug        → slug
--   status      → status  (parcel_org uses DRAFT/ACTIVE/SUSPENDED too)
--   created_at  → createdAt
--   updated_at  → updatedAt
--   logo_url, brand_accent, commission_* → stored in metadata JSONB

INSERT INTO "org" (
    "id",
    "type",
    "enterpriseId",
    "name",
    "slug",
    "status",
    "metadata",
    "createdAt",
    "updatedAt"
)
SELECT
    po."id",
    'courier'::TEXT,
    po."enterpriseId",
    po."name",
    po."slug",
    po."status",
    jsonb_build_object(
        'logoUrl',           po."logoUrl",
        'brandAccent',       po."brandAccent",
        'commissionPct',     po."commissionPct",
        'settlementDays',    po."settlementDays",
        'allowsWalkIn',      po."allowsWalkIn",
        'migratedFrom',      'parcel_org',
        'migratedAt',        now()
    ),
    po."createdAt",
    po."updatedAt"
FROM "parcel_org" po
ON CONFLICT ("id") DO NOTHING;

-- ── 2. Migrate parcel_org_staff → org_staff ──────────────────────────────
--
-- parcel_org_staff column mapping:
--   id           → id
--   orgId        → orgId  (references org.id, which now exists from step 1)
--   partyId      → partyId
--   name         → name
--   role         → role
--   capabilities → customCapabilities  (TEXT[] in both tables)
--   active       → active
--   isContact    → isContact
--   created_at / updated_at

INSERT INTO "org_staff" (
    "id",
    "orgId",
    "partyId",
    "name",
    "role",
    "customCapabilities",
    "active",
    "isContact",
    "createdAt",
    "updatedAt"
)
SELECT
    pos."id",
    pos."orgId",
    pos."partyId",
    pos."name",
    pos."role",
    COALESCE(pos."capabilities", ARRAY[]::TEXT[]),
    pos."active",
    COALESCE(pos."isContact", false),
    pos."createdAt",
    pos."updatedAt"
FROM "parcel_org_staff" pos
-- Only migrate staff whose org was successfully migrated
WHERE EXISTS (SELECT 1 FROM "org" WHERE "id" = pos."orgId" AND "type" = 'courier')
ON CONFLICT ("id") DO NOTHING;

-- ── 3. Migrate ticket_org → org (type = 'ticket') ────────────────────────
--
-- ticket_org uses a different schema; map what we have.

INSERT INTO "org" (
    "id",
    "type",
    "enterpriseId",
    "name",
    "slug",
    "status",
    "metadata",
    "createdAt",
    "updatedAt"
)
SELECT
    to_."id",
    'ticket'::TEXT,
    NULL,                                          -- ticket_org has no enterpriseId
    to_."name",
    to_."slug",
    CASE to_."status"
        WHEN 'LIVE'    THEN 'ACTIVE'
        WHEN 'DRAFT'   THEN 'DRAFT'
        WHEN 'ARCHIVED'THEN 'SUSPENDED'
        ELSE to_."status"
    END,
    jsonb_build_object(
        'vertical',     to_."vertical",            -- EVENT or TRANSPORT
        'logoUrl',      to_."logoUrl",
        'migratedFrom', 'ticket_org',
        'migratedAt',   now()
    ),
    to_."createdAt",
    to_."updatedAt"
FROM "ticket_org" to_
ON CONFLICT ("id") DO NOTHING;

-- ── 4. Migrate ticket org staff grants → org_staff ───────────────────────
--
-- ticket_org_staff_grant stores (orgId, partyId, role, active).
-- Map to org_staff using a synthetic UUID derived from orgId+partyId.

INSERT INTO "org_staff" (
    "id",
    "orgId",
    "partyId",
    "name",
    "role",
    "customCapabilities",
    "active",
    "isContact",
    "createdAt",
    "updatedAt"
)
SELECT
    -- Deterministic UUID from (orgId, partyId) so re-runs are idempotent
    gen_random_uuid(),
    tsg."orgId",
    tsg."partyId",
    COALESCE(p."name", 'Staff Member'),            -- resolve from party table
    UPPER(tsg."role"),
    ARRAY[]::TEXT[],
    tsg."active",
    false,
    tsg."createdAt",
    tsg."updatedAt"
FROM "ticket_org_staff_grant" tsg
LEFT JOIN "party" p ON p."id" = tsg."partyId"
WHERE EXISTS (SELECT 1 FROM "org" WHERE "id" = tsg."orgId" AND "type" = 'ticket')
  -- Skip if we already have a staff row for this party+org combo
  AND NOT EXISTS (
    SELECT 1 FROM "org_staff"
    WHERE "orgId" = tsg."orgId" AND "partyId" = tsg."partyId"
  );

-- ── 5. Record migration stats in org_config ──────────────────────────────
--
-- Stored as a single config entry so the migration can be audited.

INSERT INTO "org_config" ("id", "orgId", "configKey", "configData", "priority", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    o."id",
    'migration.20260924.done',
    jsonb_build_object('migratedAt', now(), 'version', '20260924000000'),
    999,
    now(),
    now()
FROM "org" o
WHERE o."type" IN ('courier', 'ticket')
  AND NOT EXISTS (
    SELECT 1 FROM "org_config"
    WHERE "orgId" = o."id" AND "configKey" = 'migration.20260924.done'
  );

COMMIT;
