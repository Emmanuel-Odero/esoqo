-- What a gig courier earns, and how they get paid.
--
-- Until now a courier who claimed a job on the Nearby tab, collected a
-- parcel, carried it across town and handed it over had no record of
-- having earned anything at all. The gig half of the dispatch model was
-- operationally real and financially imaginary.
--
-- The one rule that matters, enforced in dbx.AccrueCourierEarnings and
-- repeated here because getting it wrong costs real money: earnings
-- accrue ONLY on a parcel with no carrying company. A parcel with a
-- parcelOrgId has already been split into platformFeeKes (Esoko's) and
-- orgEarningsKes (the company's), and that company pays its own riders
-- out of its share. Accruing here as well would pay twice for one
-- delivery.

-- ── Account kinds ────────────────────────────────────────────────────
-- PARCEL_COURIER_COST is the first genuine expense account in this
-- enum. Every other kind is an asset or a revenue pool, because until
-- couriers had to be paid nothing here cost the platform money on a
-- per-event basis.
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'PARCEL_COURIER_PAYABLE';
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'PARCEL_COURIER_COST';

-- ── The rate ─────────────────────────────────────────────────────────
-- Two components that stack: a flat amount per delivery plus a
-- percentage of what the sender paid. Either may be zero, which is how
-- "flat rate only" and "commission only" are expressed without a mode
-- flag nobody would remember the meaning of.
CREATE TABLE "parcel_courier_tariff" (
    "id" UUID NOT NULL,
    "perDeliveryKes" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pctOfPrice" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "maxPerDeliveryKes" DECIMAL(10,2) NOT NULL DEFAULT 2000,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "parcel_courier_tariff_pkey" PRIMARY KEY ("id")
);

-- Seeded at 60% of the delivery fee with no flat component. A starting
-- position an admin is expected to change, not a considered rate —
-- but seeded non-zero on purpose: a tariff of zero would silently
-- accrue nothing and look exactly like the bug this migration fixes.
INSERT INTO "parcel_courier_tariff"
    ("id", "perDeliveryKes", "pctOfPrice", "maxPerDeliveryKes", "updatedAt")
VALUES (gen_random_uuid(), 0, 60, 2000, now());

-- ── Payout runs ──────────────────────────────────────────────────────
CREATE TABLE "parcel_courier_payout" (
    "id" UUID NOT NULL,
    "courierPartyId" UUID NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "expectedKes" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "paidByStaffId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_courier_payout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "parcel_courier_payout_courierPartyId_createdAt_idx"
    ON "parcel_courier_payout"("courierPartyId", "createdAt");

-- ── Parcel columns ───────────────────────────────────────────────────
ALTER TABLE "parcel"
    ADD COLUMN "courierEarningsKes" DECIMAL(10,2),
    ADD COLUMN "courierPayoutId" UUID;

ALTER TABLE "parcel"
    ADD CONSTRAINT "parcel_courierPayoutId_fkey"
    FOREIGN KEY ("courierPayoutId") REFERENCES "parcel_courier_payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "What is this courier owed?" — the query both the courier's own
-- earnings screen and every payout run answer. Partial, because an
-- unpaid accrual is a small and shrinking slice of a table that is
-- mostly delivered-and-settled history.
CREATE INDEX "parcel_courier_unpaid_earnings_idx"
    ON "parcel"("currentHolderPartyId")
    WHERE "courierEarningsKes" IS NOT NULL AND "courierPayoutId" IS NULL;
