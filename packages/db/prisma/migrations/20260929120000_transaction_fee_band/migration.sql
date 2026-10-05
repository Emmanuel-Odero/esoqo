-- A banded, staff-editable schedule for boundary-crossing money
-- transactions (wallet withdrawal, third-party M-Pesa payout) — priced
-- cost-plus against Safaricom's own tariff bands rather than a guessed
-- flat fee.

-- CreateEnum
CREATE TYPE "TransactionFeeKind" AS ENUM ('WALLET_WITHDRAWAL', 'THIRDPARTY_PAYOUT');

-- CreateTable
CREATE TABLE "transaction_fee_band" (
    "id" UUID NOT NULL,
    "kind" "TransactionFeeKind" NOT NULL,
    "minKes" DECIMAL(12,2) NOT NULL,
    "maxKes" DECIMAL(12,2) NOT NULL,
    "feeKes" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "transaction_fee_band_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_fee_band_kind_minKes_maxKes_idx" ON "transaction_fee_band"("kind", "minKes", "maxKes");

-- AddForeignKey
ALTER TABLE "transaction_fee_band" ADD CONSTRAINT "transaction_fee_band_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
