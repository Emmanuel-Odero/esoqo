-- Business payments made through the public /pay page.
--
-- A payer scans a business's QR, chooses an amount, and pays from their
-- own phone. The payee is an ORGANISATION Party, which is why this is a
-- new table rather than another column on donation or store_order:
-- neither of those has a payee, and the payer here is usually someone
-- with no Esoqo account at all.
--
-- Deliberate constraints, all load-bearing:
--   · mpesaCheckoutRequestId is unique and nullable — it is the ONLY
--     way the Daraja callback can find the row it is confirming, so a
--     duplicate would mean a callback paying two payments.
--   · receiptCode is ours and distinct from mpesaReceiptCode, because
--     Safaricom's number is not ours to quote back to a payer.
--   · journalEntryId is unique so a payment can hold at most one ledger
--     entry, and so confirmBusinessPayment's replay guard has somewhere
--     to land.
--
-- ON DELETE RESTRICT on the payee: a payment is a financial record, and
-- deleting the business must not silently delete the proof it was paid.
-- Soft delete (party.deletedAt) is the erasure path.

-- CreateEnum
CREATE TYPE "BusinessPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'BUSINESS_REVENUE';

-- CreateTable
CREATE TABLE "business_payment" (
    "id" UUID NOT NULL,
    "payeePartyId" UUID NOT NULL,
    "payeeEsoqoId" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "payerMsisdn" TEXT NOT NULL,
    "payerName" TEXT,
    "payerEsoqoId" TEXT,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "status" "BusinessPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "mpesaCheckoutRequestId" TEXT,
    "mpesaReceiptCode" TEXT,
    "receiptCode" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "business_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_payment_mpesaCheckoutRequestId_key" ON "business_payment"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "business_payment_receiptCode_key" ON "business_payment"("receiptCode");

-- CreateIndex
CREATE UNIQUE INDEX "business_payment_journalEntryId_key" ON "business_payment"("journalEntryId");

-- CreateIndex
CREATE INDEX "business_payment_payeePartyId_status_idx" ON "business_payment"("payeePartyId", "status");

-- CreateIndex
CREATE INDEX "business_payment_status_createdAt_idx" ON "business_payment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "business_payment" ADD CONSTRAINT "business_payment_payeePartyId_fkey" FOREIGN KEY ("payeePartyId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_payment" ADD CONSTRAINT "business_payment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
