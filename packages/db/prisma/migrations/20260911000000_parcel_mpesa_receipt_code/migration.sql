-- Same "store the receipt so it can be quoted back to the payer and
-- looked up later" pattern fare_payment/booking_payment already follow
-- (their own "mpesaReceiptCode" columns) — Parcel never had one, which
-- is exactly why the payment-confirmation SMS could only ever say
-- "payment received," never point at which M-Pesa transaction it was.

-- AlterTable
ALTER TABLE "parcel"
    ADD COLUMN "mpesaReceiptCode" TEXT;
