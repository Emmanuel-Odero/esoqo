-- A courier company's bus earnings now clear through the exact same
-- automatic Daraja/Co-op payout pipeline (and manual-payouts fallback)
-- its parcel earnings already do, instead of a second payout system
-- for a second product line on the same company. parcelId becomes
-- optional and a new busBookingId appears beside it; a check
-- constraint keeps the table from ever representing a payout for
-- neither or for both.

-- AlterTable
ALTER TABLE "parcel_org_payout" ALTER COLUMN "parcelId" DROP NOT NULL;
ALTER TABLE "parcel_org_payout" ADD COLUMN "busBookingId" UUID;

ALTER TABLE "parcel_org_payout"
  ADD CONSTRAINT "parcel_org_payout_busBookingId_fkey"
  FOREIGN KEY ("busBookingId") REFERENCES "bus_booking"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE UNIQUE INDEX "parcel_org_payout_busBookingId_key" ON "parcel_org_payout"("busBookingId");

ALTER TABLE "parcel_org_payout"
  ADD CONSTRAINT "parcel_org_payout_exactly_one_source_check"
  CHECK ((("parcelId" IS NOT NULL)::int + ("busBookingId" IS NOT NULL)::int) = 1);
