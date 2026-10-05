-- A wallet holder paying an arbitrary M-Pesa number that is not another
-- Esoqo party. Gated behind THIRDPARTY_PAYOUT_ENABLED in
-- dal/thirdparty-payout.ts; see docs/proposals/money-representation.md's
-- "Step 1c addendum".

-- CreateEnum
CREATE TYPE "ThirdPartyPayoutStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "thirdparty_payout" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "payeeMsisdn" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "feeKes" DECIMAL(12,2) NOT NULL,
    "netPayoutKes" DECIMAL(12,2) NOT NULL,
    "status" "ThirdPartyPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "mpesaConversationId" TEXT,
    "mpesaTransactionId" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "thirdparty_payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "thirdparty_payout_mpesaConversationId_key" ON "thirdparty_payout"("mpesaConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "thirdparty_payout_journalEntryId_key" ON "thirdparty_payout"("journalEntryId");

-- CreateIndex
CREATE INDEX "thirdparty_payout_partyId_status_idx" ON "thirdparty_payout"("partyId", "status");

-- CreateIndex
CREATE INDEX "thirdparty_payout_partyId_createdAt_idx" ON "thirdparty_payout"("partyId", "createdAt");

-- CreateIndex
CREATE INDEX "thirdparty_payout_status_createdAt_idx" ON "thirdparty_payout"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "thirdparty_payout" ADD CONSTRAINT "thirdparty_payout_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thirdparty_payout" ADD CONSTRAINT "thirdparty_payout_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
