-- Cashing a WALLET balance back out to M-Pesa via Daraja B2C — the
-- reverse of wallet_top_up.

-- CreateEnum
CREATE TYPE "WalletWithdrawalStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "wallet_withdrawal" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "msisdn" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "feeKes" DECIMAL(12,2) NOT NULL,
    "netPayoutKes" DECIMAL(12,2) NOT NULL,
    "status" "WalletWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "mpesaConversationId" TEXT,
    "mpesaTransactionId" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "wallet_withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_withdrawal_mpesaConversationId_key" ON "wallet_withdrawal"("mpesaConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_withdrawal_journalEntryId_key" ON "wallet_withdrawal"("journalEntryId");

-- CreateIndex
CREATE INDEX "wallet_withdrawal_partyId_status_idx" ON "wallet_withdrawal"("partyId", "status");

-- CreateIndex
CREATE INDEX "wallet_withdrawal_status_createdAt_idx" ON "wallet_withdrawal"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "wallet_withdrawal" ADD CONSTRAINT "wallet_withdrawal_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_withdrawal" ADD CONSTRAINT "wallet_withdrawal_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
