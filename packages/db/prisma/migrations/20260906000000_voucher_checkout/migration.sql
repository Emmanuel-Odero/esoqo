-- Voucher acceptance on store orders + bookings.
-- Go (services/core-go) is the sole writer; Prisma holds DDL only.

ALTER TYPE "StoreOrderPaymentMethod" ADD VALUE IF NOT EXISTS 'VOUCHER';
ALTER TYPE "BookingPaymentMethod" ADD VALUE IF NOT EXISTS 'VOUCHER';

ALTER TABLE "store_order" ADD COLUMN IF NOT EXISTS "voucherId" UUID;
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "voucherId" UUID;
CREATE INDEX IF NOT EXISTS "store_order_voucher_idx" ON "store_order"("voucherId");
CREATE INDEX IF NOT EXISTS "booking_voucher_idx" ON "booking"("voucherId");

ALTER TABLE "store_order" ADD CONSTRAINT "store_order_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "voucher_card"("id")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "booking" ADD CONSTRAINT "booking_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "voucher_card"("id")
  ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
