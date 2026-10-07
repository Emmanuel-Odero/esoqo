-- Automatic courier payouts over the Co-op Bank M-Pesa B2C API.
--
-- A payout can now be in flight: created PENDING with the MessageReference
-- sent to the bank, then PAID or FAILED once the bank reports the outcome.
-- Every row that existed before this migration was a human recording money
-- they had already sent, so the default is PAID.

ALTER TABLE "parcel_courier_payout"
  ADD COLUMN "status"        TEXT NOT NULL DEFAULT 'PAID',
  ADD COLUMN "coopReference" TEXT,
  ADD COLUMN "destinationMsisdn" TEXT,
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "settledAt"     TIMESTAMP(3);

CREATE UNIQUE INDEX "parcel_courier_payout_coopReference_key"
  ON "parcel_courier_payout"("coopReference");

CREATE INDEX "parcel_courier_payout_status_idx"
  ON "parcel_courier_payout"("status");
