-- Our own customer-facing reference code for wallet top-ups, withdrawals
-- and Esoqo-to-Esoqo transfers — see generateTransactionCode in
-- @esoqo/domain. Nullable everywhere, same as BusinessPayment/Donation's
-- existing receiptCode: a row that predates this column has nothing to
-- backfill it with. Also adds EsoqoTransfer.idempotencyKey so a client
-- retry can no longer post the same transfer twice.

-- AlterTable
ALTER TABLE "wallet_top_up" ADD COLUMN "referenceCode" TEXT;

-- AlterTable
ALTER TABLE "wallet_withdrawal" ADD COLUMN "referenceCode" TEXT;

-- AlterTable
ALTER TABLE "esoqo_transfer" ADD COLUMN "referenceCode" TEXT;
ALTER TABLE "esoqo_transfer" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_up_referenceCode_key" ON "wallet_top_up"("referenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_withdrawal_referenceCode_key" ON "wallet_withdrawal"("referenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "esoqo_transfer_referenceCode_key" ON "esoqo_transfer"("referenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "esoqo_transfer_idempotencyKey_key" ON "esoqo_transfer"("idempotencyKey");
