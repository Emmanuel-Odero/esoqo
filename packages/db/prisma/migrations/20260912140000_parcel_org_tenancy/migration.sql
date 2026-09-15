-- Parcel companies become real tenants.
--
-- Until now every parcel belonged to Esoko-run dispatch: couriers,
-- teams, fleets, zones and rate cards all lived under /admin, and a
-- partner courier company logged into nothing. This adds the operator
-- side — a company, its own staff with their own PIN logins, its own
-- rate card, and the revenue split that makes carrying a parcel worth
-- something to it.
--
-- Everything here is additive and nullable. A NULL parcelOrgId means
-- Esoko-operated, which is every existing row and every parcel Esoko's
-- own couriers still carry. No existing data is migrated into a default
-- tenant: inventing an "Esoko Logistics Ltd" company to avoid a
-- nullable column would put real money under a business that does not
-- exist.

-- ── The company and its people ───────────────────────────────────────
CREATE TABLE "parcel_org" (
    "id" UUID NOT NULL,
    "enterpriseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "contactPerson" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "settlementPhone" TEXT,
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByStaffId" UUID,

    CONSTRAINT "parcel_org_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parcel_org_slug_key" ON "parcel_org"("slug");
CREATE INDEX "parcel_org_enterpriseId_idx" ON "parcel_org"("enterpriseId");
CREATE INDEX "parcel_org_status_idx" ON "parcel_org"("status");

ALTER TABLE "parcel_org"
    ADD CONSTRAINT "parcel_org_enterpriseId_fkey"
    FOREIGN KEY ("enterpriseId") REFERENCES "enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "parcel_org_staff" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'RIDER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "partyId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcel_org_staff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "parcel_org_staff_orgId_idx" ON "parcel_org_staff"("orgId");

ALTER TABLE "parcel_org_staff"
    ADD CONSTRAINT "parcel_org_staff_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "parcel_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Parcels carry an owner and a frozen split ────────────────────────
ALTER TABLE "parcel"
    ADD COLUMN "parcelOrgId" UUID,
    ADD COLUMN "platformFeeKes" DECIMAL(10,2),
    ADD COLUMN "orgEarningsKes" DECIMAL(10,2);

ALTER TABLE "parcel"
    ADD CONSTRAINT "parcel_parcelOrgId_fkey"
    FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The operator portal's only list query: this company's parcels,
-- newest first, usually filtered by status.
CREATE INDEX "parcel_parcelOrgId_status_createdAt_idx"
    ON "parcel"("parcelOrgId", "status", "createdAt" DESC);

-- ── Couriers belong to a company (or to nobody) ──────────────────────
ALTER TABLE "parcel_courier" ADD COLUMN "parcelOrgId" UUID;

ALTER TABLE "parcel_courier"
    ADD CONSTRAINT "parcel_courier_parcelOrgId_fkey"
    FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "parcel_courier_parcelOrgId_idx" ON "parcel_courier"("parcelOrgId");

-- ── Per-company rate cards ───────────────────────────────────────────
-- "One row per parcel type" was only ever true while there was one
-- operator. The key becomes (org, type), with NULL org meaning the
-- platform default every existing row already is.
ALTER TABLE "parcel_pricing_rule" ADD COLUMN "parcelOrgId" UUID;

ALTER TABLE "parcel_pricing_rule"
    ADD CONSTRAINT "parcel_pricing_rule_parcelOrgId_fkey"
    FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "parcel_pricing_rule_parcelType_key";

CREATE UNIQUE INDEX "parcel_pricing_rule_parcelOrgId_parcelType_key"
    ON "parcel_pricing_rule"("parcelOrgId", "parcelType");

-- The composite index above does NOT protect the platform defaults.
-- Postgres treats NULLs as distinct in a unique index, so without this
-- second, partial index two rows of (NULL, 'SMALL') would both be
-- accepted — and "what does a parcel with no company cost?" would have
-- two answers, picked by whichever the planner returned first.
--
-- A partial unique index rather than PG15's UNIQUE NULLS NOT DISTINCT:
-- Prisma's schema language can express neither, but a partial index
-- sits alongside the @@unique it does generate without the two
-- fighting, whereas replacing the constraint outright would show up as
-- drift on every subsequent migrate diff.
CREATE UNIQUE INDEX "parcel_pricing_rule_platform_default_key"
    ON "parcel_pricing_rule"("parcelType") WHERE "parcelOrgId" IS NULL;
