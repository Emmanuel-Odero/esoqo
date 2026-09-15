-- Gamified bill funding (targetKes + BillContribution — real money,
-- unlike BillPayment's self-reported log) and employer FUEL/TRAVEL
-- allowance vouchers (VoucherBatch — one payment fanning out to N
-- employee vouchers). Go (services/core-go) is the sole writer; Prisma
-- holds DDL only.

-- AlterEnum
ALTER TYPE "VoucherPurpose" ADD VALUE 'FUEL';
ALTER TYPE "VoucherPurpose" ADD VALUE 'TRAVEL';

-- AlterEnum
-- A contribution settles SETTLEMENT <-> the bill owner's own held-funds
-- account, same 2-account shape every other ledger.go caller uses (see
-- dbx.ConfirmBillContributionByCheckoutID).
ALTER TYPE "AccountKind" ADD VALUE 'BILL_FUNDING';

-- AlterTable
ALTER TABLE "bill" ADD COLUMN "targetKes" DECIMAL(12,2);
ALTER TABLE "bill" ADD COLUMN "autoPayEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "BillContributionStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "bill_contribution" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "contributorPartyId" UUID,
    "contributorName" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "status" "BillContributionStatus" NOT NULL DEFAULT 'PENDING',
    "mpesaCheckoutRequestId" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bill_contribution_mpesaCheckoutRequestId_key" ON "bill_contribution"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE INDEX "bill_contribution_billId_status_idx" ON "bill_contribution"("billId", "status");

-- AddForeignKey
ALTER TABLE "bill_contribution" ADD CONSTRAINT "bill_contribution_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "voucher_batch" (
    "id" UUID NOT NULL,
    "employerPartyId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountPerEmployeeKes" DECIMAL(12,2) NOT NULL,
    "employeePartyIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mpesaCheckoutRequestId" TEXT,
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voucher_batch_mpesaCheckoutRequestId_key" ON "voucher_batch"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE INDEX "voucher_batch_employerPartyId_createdAt_idx" ON "voucher_batch"("employerPartyId", "createdAt");
