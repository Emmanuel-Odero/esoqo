-- Structured weight boundaries for ParcelPricingRule, alongside the
-- existing free-text weightLabel — lets the mobile app (and any future
-- server-side check) match an entered weight to a bracket by number
-- instead of parsing prose.

-- AlterTable
ALTER TABLE "parcel_pricing_rule"
    ADD COLUMN "minWeightKg" DECIMAL(6,2),
    ADD COLUMN "maxWeightKg" DECIMAL(6,2);

-- Backfill from the standard rate card's own bracket boundaries (see
-- 20260910000001_parcel_pricing_and_payment's seed rows).
UPDATE "parcel_pricing_rule" SET "minWeightKg" = 0,    "maxWeightKg" = 0.5  WHERE "parcelType" = 'ENVELOPE_DOCUMENT';
UPDATE "parcel_pricing_rule" SET "minWeightKg" = 0.5,  "maxWeightKg" = 2.2  WHERE "parcelType" = 'SMALL';
UPDATE "parcel_pricing_rule" SET "minWeightKg" = 2.2,  "maxWeightKg" = 9    WHERE "parcelType" = 'MEDIUM';
UPDATE "parcel_pricing_rule" SET "minWeightKg" = 9,    "maxWeightKg" = 22.5 WHERE "parcelType" = 'LARGE';
UPDATE "parcel_pricing_rule" SET "minWeightKg" = 22.5, "maxWeightKg" = 31.5 WHERE "parcelType" = 'HEAVY_OVERSIZE';

-- Now that every existing row has a value, require it going forward.
ALTER TABLE "parcel_pricing_rule"
    ALTER COLUMN "minWeightKg" SET NOT NULL,
    ALTER COLUMN "maxWeightKg" SET NOT NULL;
