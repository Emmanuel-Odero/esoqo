-- Brings the parcel vertical up to the baseline every courier platform
-- ships, in four related pieces:
--
--   1. Failed-delivery / agent-hold / return statuses. A failed doorstep
--      attempt previously had NO representation: the courier kept
--      holding the parcel and it silently aged past slaDeadlineAt,
--      surfacing in the admin's overdueDeliveries KPI as a courier
--      failure when it was usually nobody-home. FAILED_DELIVERY is
--      deliberately non-terminal — custody doesn't move, the next event
--      is another attempt, an agent drop, or a return.
--   2. Proof of delivery. deliveryCode proves the receiver knew a code,
--      never that the parcel physically moved or to whom; podReceivedByName
--      captures the watchman/attendant/neighbour who actually took it.
--   3. The agent (pickup-point) network — the cheap leg.
--   4. Declared value + admin-priced coverage tiers.

-- ── 1. Statuses ──────────────────────────────────────────────────────
-- Postgres will not let a value added to an enum be used in the same
-- transaction that adds it (pre-12 hard error; still the safe pattern),
-- and Prisma runs each migration file in one transaction. These three
-- are only ever written by later migrations/application code, never by
-- this file, so that restriction doesn't bite here.
ALTER TYPE "ParcelStatus" ADD VALUE IF NOT EXISTS 'FAILED_DELIVERY';
ALTER TYPE "ParcelStatus" ADD VALUE IF NOT EXISTS 'HELD_AT_AGENT';
ALTER TYPE "ParcelStatus" ADD VALUE IF NOT EXISTS 'RETURNED_TO_SENDER';

-- ── 3. Agent network ─────────────────────────────────────────────────
CREATE TABLE "parcel_agent" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "partyId" UUID,
    "zoneId" UUID,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "msisdn" TEXT NOT NULL,
    "locationHint" TEXT NOT NULL,
    "openingHours" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "capacity" INTEGER NOT NULL DEFAULT 50,
    "holdingFeeKes" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByStaffId" UUID,

    CONSTRAINT "parcel_agent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "parcel_agent_zoneId_active_idx" ON "parcel_agent"("zoneId", "active");

ALTER TABLE "parcel_agent"
    ADD CONSTRAINT "parcel_agent_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "parcel_zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. Coverage tiers ────────────────────────────────────────────────
CREATE TABLE "parcel_coverage_tier" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "maxCoverKes" DECIMAL(12,2) NOT NULL,
    "feeKes" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "feePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "parcel_coverage_tier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parcel_coverage_tier_name_key" ON "parcel_coverage_tier"("name");

-- ── 1b + 2 + 4b. Parcel columns ──────────────────────────────────────
ALTER TABLE "parcel"
    ADD COLUMN "podPhotoUrl" TEXT,
    ADD COLUMN "podLat" DECIMAL(10,7),
    ADD COLUMN "podLng" DECIMAL(10,7),
    ADD COLUMN "podReceivedByName" TEXT,
    ADD COLUMN "podMethod" TEXT,
    ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
    ADD COLUMN "lastAttemptReason" TEXT,
    ADD COLUMN "declaredValueKes" DECIMAL(12,2),
    ADD COLUMN "coverageTierId" UUID,
    ADD COLUMN "coverageFeeKes" DECIMAL(10,2),
    ADD COLUMN "destinationAgentId" UUID,
    ADD COLUMN "agentHeldSince" TIMESTAMP(3);

ALTER TABLE "parcel"
    ADD CONSTRAINT "parcel_coverageTierId_fkey"
    FOREIGN KEY ("coverageTierId") REFERENCES "parcel_coverage_tier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "parcel"
    ADD CONSTRAINT "parcel_destinationAgentId_fkey"
    FOREIGN KEY ("destinationAgentId") REFERENCES "parcel_agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dispatch's "which parcels are waiting at this shop" query, and the
-- capacity check that refuses to route a 51st parcel to a 50-slot agent.
CREATE INDEX "parcel_destinationAgentId_status_idx" ON "parcel"("destinationAgentId", "status");

-- ── 1c. Attempt log ──────────────────────────────────────────────────
-- Append-only, same shape and same reasoning as parcel_handoff: the
-- lastAttempt* columns above are a denormalised "most recent" for list
-- queries, this is the record that can actually be reconstructed.
CREATE TABLE "parcel_delivery_attempt" (
    "id" UUID NOT NULL,
    "parcelId" UUID NOT NULL,
    "byPartyId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_delivery_attempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "parcel_delivery_attempt_parcelId_createdAt_idx"
    ON "parcel_delivery_attempt"("parcelId", "createdAt");

ALTER TABLE "parcel_delivery_attempt"
    ADD CONSTRAINT "parcel_delivery_attempt_parcelId_fkey"
    FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The agent-collection discount, per parcel type — the price signal
-- that makes the cheap leg visibly cheap at the moment of choosing.
-- Defaults to 0 (agent collection priced the same as doorstep), which
-- is a legitimate admin choice rather than an unconfigured state; the
-- seeded 20% below is the pilot's opening position.
ALTER TABLE "parcel_pricing_rule"
    ADD COLUMN "agentDropDiscountPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

UPDATE "parcel_pricing_rule" SET "agentDropDiscountPct" = 20.00;

-- Seed the three coverage tiers the pilot quotes against. Admin-editable
-- from here on (see ParcelCoverageTier) — these are a starting rate card,
-- not a constant.
INSERT INTO "parcel_coverage_tier" ("id", "name", "maxCoverKes", "feeKes", "feePct", "sortOrder", "updatedAt")
VALUES
    (gen_random_uuid(), 'Basic',    5000.00,  0.00, 0.00, 0, now()),
    (gen_random_uuid(), 'Standard', 25000.00, 50.00, 1.00, 1, now()),
    (gen_random_uuid(), 'Premium',  100000.00, 150.00, 1.50, 2, now());
