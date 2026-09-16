-- Parcel.serviceTicketNumber: what a self-service booking's response
-- actually carries now, not the real tracking `code` (see that column's
-- own schema comment). Added nullable, backfilled for the handful of
-- rows already in this dev database, then locked to NOT NULL + UNIQUE
-- like every other short code column here.

ALTER TABLE "parcel" ADD COLUMN "serviceTicketNumber" TEXT;

-- Backfill: same TCK- + 6 random uppercase alphanumerics shape
-- fleetqr.ShortCodeChecked mints going forward, close enough for a
-- one-off backfill of pre-existing rows that were never shown one.
UPDATE "parcel"
SET "serviceTicketNumber" = 'TCK-' || upper(substr(md5(random()::text || id::text), 1, 6))
WHERE "serviceTicketNumber" IS NULL;

ALTER TABLE "parcel" ALTER COLUMN "serviceTicketNumber" SET NOT NULL;

CREATE UNIQUE INDEX "parcel_serviceTicketNumber_key" ON "parcel"("serviceTicketNumber");
