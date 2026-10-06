-- Counter-intake cash accountability — ParcelCodRemittance's
-- counterpart for cash taken at a walk-in counter instead of collected
-- by a rider on delivery. See dbx.SettleCounterParcel / RemitCounterCash.

ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'PARCEL_COUNTER_CASH_HELD';

CREATE TABLE "parcel_counter_cash_remittance" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "collectedByStaffId" UUID NOT NULL,
    "receivedByStaffId" UUID NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "expectedKes" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_counter_cash_remittance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "parcel_counter_cash_remittance_collectedByStaffId_createdAt_idx"
    ON "parcel_counter_cash_remittance"("collectedByStaffId", "createdAt");

ALTER TABLE "parcel"
    ADD COLUMN "counterCashRemittanceId" UUID;

ALTER TABLE "parcel"
    ADD CONSTRAINT "parcel_counterCashRemittanceId_fkey"
    FOREIGN KEY ("counterCashRemittanceId") REFERENCES "parcel_counter_cash_remittance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "What is this clerk still holding?" is the query the whole flow runs
-- on, and it's a narrow slice (PAY_AT_COUNTER, cash, unremitted) of a
-- table that is mostly something else — hence a partial index.
CREATE INDEX "parcel_counter_cash_held_by_staff_idx"
    ON "parcel"("paidByStaffId")
    WHERE "paymentMethod" = 'PAY_AT_COUNTER' AND "paidAt" IS NOT NULL
      AND "mpesaReceiptCode" IS NULL AND "counterCashRemittanceId" IS NULL;
