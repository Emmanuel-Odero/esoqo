-- Cash a person adds to their own personal WALLET Account via M-Pesa
-- STK push. Same shape as business_payment on purpose — write the row,
-- push, attach the checkoutRequestId, confirm once — because the
-- settlement mechanics don't change when the payee is the payer's own
-- account instead of a business's. The WALLET AccountKind already
-- exists (added when personal wallet accounts were first created at
-- registration); nothing to add there.

-- CreateEnum
CREATE TYPE "WalletTopUpStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "wallet_top_up" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "msisdn" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "status" "WalletTopUpStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "mpesaCheckoutRequestId" TEXT,
    "mpesaReceiptCode" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "wallet_top_up_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_up_mpesaCheckoutRequestId_key" ON "wallet_top_up"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_top_up_journalEntryId_key" ON "wallet_top_up"("journalEntryId");

-- CreateIndex
CREATE INDEX "wallet_top_up_partyId_status_idx" ON "wallet_top_up"("partyId", "status");

-- CreateIndex
CREATE INDEX "wallet_top_up_status_createdAt_idx" ON "wallet_top_up"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "wallet_top_up" ADD CONSTRAINT "wallet_top_up_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_top_up" ADD CONSTRAINT "wallet_top_up_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
