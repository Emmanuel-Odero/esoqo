-- Parcels: pricing, bargaining, payment and collection scheduling.
-- Go remains the sole writer of "parcel"/"parcel_handoff"; the admin
-- app (Prisma) is the sole writer of the new "parcel_pricing_rule"
-- table, same shared-table-different-writer split the rest of this
-- migration set already follows. DRAFT_PENDING_PAYMENT itself was
-- added in 20260910000000, split out so it's committed before use.

-- CreateEnum
CREATE TYPE "ParcelType" AS ENUM ('ENVELOPE_DOCUMENT', 'SMALL', 'MEDIUM', 'LARGE', 'HEAVY_OVERSIZE');

-- CreateEnum
CREATE TYPE "ParcelTransportMode" AS ENUM ('BODA', 'TUKTUK', 'VAN', 'TRUCK');

-- AlterTable
ALTER TABLE "parcel" ADD COLUMN "parcelType" "ParcelType" NOT NULL DEFAULT 'SMALL',
    ADD COLUMN "weightKg" DECIMAL(6,2),
    ADD COLUMN "fragile" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "transportMode" "ParcelTransportMode",
    ADD COLUMN "priceKes" DECIMAL(10,2),
    ADD COLUMN "bargainReason" TEXT,
    ADD COLUMN "paymentMethod" TEXT,
    ADD COLUMN "paymentCheckoutRequestId" TEXT,
    ADD COLUMN "paidAt" TIMESTAMP(3),
    ADD COLUMN "assignedCollectorPartyId" UUID,
    ADD COLUMN "collectionScheduledAt" TIMESTAMP(3),
    ADD COLUMN "collectionNote" TEXT;

ALTER TABLE "parcel" ALTER COLUMN "status" SET DEFAULT 'DRAFT_PENDING_PAYMENT';

-- The default above only matters for new rows going forward; drop the
-- transitional parcelType default now that every existing row has been
-- backfilled with an explicit value.
ALTER TABLE "parcel" ALTER COLUMN "parcelType" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "parcel_status_idx" ON "parcel"("status");

-- CreateTable
CREATE TABLE "parcel_pricing_rule" (
    "id" UUID NOT NULL,
    "parcelType" "ParcelType" NOT NULL,
    "weightLabel" TEXT NOT NULL,
    "minKes" DECIMAL(10,2) NOT NULL,
    "maxKes" DECIMAL(10,2) NOT NULL,
    "bargainMinPct" DECIMAL(5,2) NOT NULL,
    "bargainMaxPct" DECIMAL(5,2) NOT NULL,
    "bargainReasons" JSONB NOT NULL DEFAULT '[]',
    "suggestedTransportMode" "ParcelTransportMode" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "parcel_pricing_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parcel_pricing_rule_parcelType_key" ON "parcel_pricing_rule"("parcelType");

-- AddForeignKey
ALTER TABLE "parcel_pricing_rule" ADD CONSTRAINT "parcel_pricing_rule_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the standard domestic rate card (the framework this feature ships against).
INSERT INTO "parcel_pricing_rule"
    (id, "parcelType", "weightLabel", "minKes", "maxKes", "bargainMinPct", "bargainMaxPct", "bargainReasons", "suggestedTransportMode", "updatedAt")
VALUES
    (gen_random_uuid(), 'ENVELOPE_DOCUMENT', 'Up to 0.5kg', 650, 970, 5, 15,
        '[{"reason":"Not fragile","extraDiscountPct":5},{"reason":"Flexible pickup time","extraDiscountPct":5}]', 'BODA', now()),
    (gen_random_uuid(), 'SMALL', '0.5kg to 2.2kg', 910, 1430, 5, 15,
        '[{"reason":"Not fragile","extraDiscountPct":5},{"reason":"Flexible pickup time","extraDiscountPct":5}]', 'BODA', now()),
    (gen_random_uuid(), 'MEDIUM', '2.2kg to 9kg', 1430, 2860, 5, 15,
        '[{"reason":"Not fragile","extraDiscountPct":5},{"reason":"Flexible pickup time","extraDiscountPct":5}]', 'TUKTUK', now()),
    (gen_random_uuid(), 'LARGE', '9kg to 22.5kg', 2860, 7150, 5, 10,
        '[{"reason":"Not fragile","extraDiscountPct":3},{"reason":"Flexible pickup time","extraDiscountPct":5}]', 'VAN', now()),
    (gen_random_uuid(), 'HEAVY_OVERSIZE', '22.5kg to 31.5kg', 7150, 9750, 5, 10,
        '[{"reason":"Not fragile","extraDiscountPct":3},{"reason":"Flexible pickup time","extraDiscountPct":5}]', 'TRUCK', now());
