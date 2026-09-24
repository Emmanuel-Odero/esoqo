-- Create polymorphic org table to unify courier, ticket, hotel, eatery, chama, tout
-- This replaces the separate parcel_org and ticket_org tables for new org types
-- Existing parcel_org and ticket_org remain for backward compatibility
CREATE TABLE "org" (
  "id" UUID NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,                          -- 'courier', 'hotel', 'eatery', 'chama', 'tout', etc.
  "enterpriseId" UUID,                           -- Links to enterprise (optional for non-enterprise orgs like chama)
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',        -- DRAFT, ACTIVE, SUSPENDED
  "metadata" JSONB,                              -- Type-specific data (hotel rooms, eatery cuisine, etc.)
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE("slug", "type")
);

CREATE INDEX "org_enterprise_id_idx" ON "org"("enterpriseId");
CREATE INDEX "org_type_idx" ON "org"("type");
CREATE INDEX "org_status_idx" ON "org"("status");

-- Create generic org staff table
-- Replaces separate parcel_org_staff and ticket_org_staff tables for new org types
CREATE TABLE "org_staff" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL REFERENCES "org"("id") ON DELETE CASCADE,
  "partyId" UUID,                                -- Links to party (person); null for staff without Esoqo accounts
  "name" TEXT NOT NULL,                          -- Staff member's name
  "role" TEXT NOT NULL,                          -- Role ID (RIDER, MANAGER, RECEPTIONIST, etc.)
  "customCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],  -- Custom capability overrides
  "active" BOOLEAN NOT NULL DEFAULT true,        -- Can this staff member log in?
  "isContact" BOOLEAN DEFAULT false,             -- Is this a primary contact person?
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "org_staff_org_id_idx" ON "org_staff"("orgId");
CREATE INDEX "org_staff_party_id_idx" ON "org_staff"("partyId");
CREATE INDEX "org_staff_active_idx" ON "org_staff"("active");
CREATE UNIQUE INDEX "org_staff_party_per_org_idx" ON "org_staff"("orgId", "partyId") WHERE "partyId" IS NOT NULL;

-- Create generic org config table for type-specific settings
-- This replaces parcel_pricing_rule, parcel_org_station, etc. with a flexible schema
CREATE TABLE "org_config" (
  "id" UUID NOT NULL PRIMARY KEY,
  "orgId" UUID NOT NULL REFERENCES "org"("id") ON DELETE CASCADE,
  "configKey" TEXT NOT NULL,                     -- 'pricing:standard', 'room:deluxe', 'menu:appetizers', etc.
  "configData" JSONB NOT NULL,                   -- Type-specific configuration as JSON
  "priority" INTEGER DEFAULT 100,                -- Lower number = higher priority (for pricing tiers, etc.)
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE("orgId", "configKey")
);

CREATE INDEX "org_config_org_id_idx" ON "org_config"("orgId");
CREATE INDEX "org_config_key_idx" ON "org_config"("configKey");

-- Backward compatibility views that map new generic tables to old courier-specific names
-- This allows existing queries to keep working during migration
CREATE VIEW "org_staff_view" AS
  SELECT
    "id",
    "orgId" AS "orgId",
    "partyId" AS "partyId",
    "name",
    "role",
    "customCapabilities",
    "active",
    "isContact",
    "createdAt",
    "updatedAt"
  FROM "org_staff"
  WHERE (
    SELECT "type" FROM "org" WHERE "org"."id" = "org_staff"."orgId"
  ) IN ('courier', 'hotel', 'eatery', 'chama', 'tout');

-- Add gin index for JSONB queries on metadata (useful for searching org-specific fields)
CREATE INDEX "org_metadata_gin_idx" ON "org" USING GIN("metadata");
CREATE INDEX "org_config_data_gin_idx" ON "org_config" USING GIN("configData");
