-- Independent per-signatory permissions (approve withdrawals, add/remove
-- members, manage other signatories, edit treasury settings, notify on
-- contributions/withdrawals), replacing GroupSigner's flat "can sign,
-- yes/no". Plus the KES 50 fee for every signatory beyond the first 5
-- free ones per group, settled by whichever method the adding officer
-- picks (new signer's own STK, the officer's own STK, or an immediate
-- debit from the group's treasury) — always credited to the platform's
-- own FEE_INCOME account, never the group's or the new signer's.

-- AlterTable
ALTER TABLE "group_signer"
  ADD COLUMN "approveWithdrawals" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "addMembers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "removeMembers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "manageSignatories" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "editTreasurySettings" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notifyOnContributions" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notifyOnWithdrawals" BOOLEAN NOT NULL DEFAULT true;

-- CreateEnum
CREATE TYPE "SignatoryFeeMethod" AS ENUM ('STK_NEW_SIGNER', 'STK_OFFICER', 'GROUP_TREASURY');

-- CreateEnum
CREATE TYPE "SignatoryFeeStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "signatory_fee_payment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "addedById" UUID NOT NULL,
    "method" "SignatoryFeeMethod" NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL DEFAULT 50,
    "status" "SignatoryFeeStatus" NOT NULL DEFAULT 'PENDING',
    "pendingPermissions" JSONB NOT NULL,
    "failureReason" TEXT,
    "mpesaCheckoutRequestId" TEXT,
    "mpesaReceiptCode" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "signatory_fee_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signatory_fee_payment_mpesaCheckoutRequestId_key" ON "signatory_fee_payment"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "signatory_fee_payment_journalEntryId_key" ON "signatory_fee_payment"("journalEntryId");

-- CreateIndex
CREATE INDEX "signatory_fee_payment_orgId_status_idx" ON "signatory_fee_payment"("orgId", "status");

-- AddForeignKey
ALTER TABLE "signatory_fee_payment" ADD CONSTRAINT "signatory_fee_payment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatory_fee_payment" ADD CONSTRAINT "signatory_fee_payment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatory_fee_payment" ADD CONSTRAINT "signatory_fee_payment_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatory_fee_payment" ADD CONSTRAINT "signatory_fee_payment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
