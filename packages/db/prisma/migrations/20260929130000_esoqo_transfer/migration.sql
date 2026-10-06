-- Esoqo-to-Esoqo transfer by handle — no M-Pesa leg, no PENDING state,
-- created and settled in one transaction.

-- CreateTable
CREATE TABLE "esoqo_transfer" (
    "id" UUID NOT NULL,
    "senderPartyId" UUID NOT NULL,
    "receiverPartyId" UUID NOT NULL,
    "receiverEsoqoId" TEXT NOT NULL,
    "receiverName" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "feeKes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esoqo_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "esoqo_transfer_journalEntryId_key" ON "esoqo_transfer"("journalEntryId");

-- CreateIndex
CREATE INDEX "esoqo_transfer_senderPartyId_createdAt_idx" ON "esoqo_transfer"("senderPartyId", "createdAt");

-- CreateIndex
CREATE INDEX "esoqo_transfer_receiverPartyId_createdAt_idx" ON "esoqo_transfer"("receiverPartyId", "createdAt");

-- AddForeignKey
ALTER TABLE "esoqo_transfer" ADD CONSTRAINT "esoqo_transfer_senderPartyId_fkey" FOREIGN KEY ("senderPartyId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esoqo_transfer" ADD CONSTRAINT "esoqo_transfer_receiverPartyId_fkey" FOREIGN KEY ("receiverPartyId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esoqo_transfer" ADD CONSTRAINT "esoqo_transfer_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
