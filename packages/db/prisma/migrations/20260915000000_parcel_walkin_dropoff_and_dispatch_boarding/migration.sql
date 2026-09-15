-- Walk-in station drop-off (Part A) + dispatch scan-to-board with
-- left-behind detection (Part B). See the notify/dbx comments this
-- migration's columns are referenced from for the full rationale.

-- ── Part A: a company can be a physical front desk, not just a payee ──
CREATE TYPE "ParcelOriginMethod" AS ENUM ('SCHEDULED_PICKUP', 'SELF_DROPOFF');

ALTER TABLE "parcel_org"
    ADD COLUMN "acceptsWalkIn" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "lat" DECIMAL(9, 6),
    ADD COLUMN "lng" DECIMAL(9, 6),
    ADD COLUMN "locationHint" TEXT,
    ADD COLUMN "openingHours" TEXT;

CREATE INDEX "parcel_org_acceptsWalkIn_idx" ON "parcel_org"("acceptsWalkIn");

-- Every parcel booked before this migration was, by definition, someone
-- scheduling a pickup — SCHEDULED_PICKUP is the honest default, the
-- same "don't invent a fact for old rows" rule the two most recent
-- parcel migrations already followed.
ALTER TABLE "parcel"
    ADD COLUMN "originMethod" "ParcelOriginMethod" NOT NULL DEFAULT 'SCHEDULED_PICKUP';

-- ── Part B: boarding is a scanned fact, not a bulk-assignment side effect ──
ALTER TABLE "parcel"
    ADD COLUMN "courierTripBoardedAt" TIMESTAMP(3),
    ADD COLUMN "courierTripBoardedByPartyId" UUID;

ALTER TABLE "courier_trip"
    ADD COLUMN "checkedAt" TIMESTAMP(3),
    ADD COLUMN "checkedByStaffId" UUID;
