-- Courier counter dashboard: lets a courier company's cut of a parcel
-- (Parcel.orgEarningsKes) be disbursed automatically to whatever payout
-- destination it was onboarded with (phone, till, paybill, or bank),
-- the moment a parcel is settled, instead of just sitting frozen on the
-- parcel row as before.

-- CreateEnum
CREATE TYPE "ParcelOrgPayoutMethod" AS ENUM ('PHONE', 'TILL', 'PAYBILL', 'BANK');

-- CreateEnum
CREATE TYPE "ParcelOrgPayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED', 'MANUAL');

-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'PARCEL_ORG_EARNINGS_PAYABLE';

-- AlterTable
ALTER TABLE "parcel_org" ADD COLUMN "payoutMethod" "ParcelOrgPayoutMethod",
    ADD COLUMN "payoutMsisdn" TEXT,
    ADD COLUMN "payoutTillNumber" TEXT,
    ADD COLUMN "payoutPaybillNumber" TEXT,
    ADD COLUMN "payoutPaybillAccount" TEXT,
    ADD COLUMN "payoutBankCode" TEXT,
    ADD COLUMN "payoutBankAccountNumber" TEXT,
    ADD COLUMN "payoutBankAccountName" TEXT;

-- CreateTable
CREATE TABLE "parcel_org_payout" (
    "id" UUID NOT NULL,
    "parcelOrgId" UUID NOT NULL,
    "parcelId" UUID NOT NULL,
    "amountKes" DECIMAL(10,2) NOT NULL,
    "method" "ParcelOrgPayoutMethod",
    "payoutMsisdn" TEXT,
    "payoutTillNumber" TEXT,
    "payoutPaybillNumber" TEXT,
    "payoutPaybillAccount" TEXT,
    "payoutBankCode" TEXT,
    "payoutBankAccountNumber" TEXT,
    "payoutBankAccountName" TEXT,
    "status" "ParcelOrgPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "mpesaConversationId" TEXT,
    "mpesaTransactionId" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "parcel_org_payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parcel_org_payout_parcelId_key" ON "parcel_org_payout"("parcelId");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_org_payout_mpesaConversationId_key" ON "parcel_org_payout"("mpesaConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "parcel_org_payout_journalEntryId_key" ON "parcel_org_payout"("journalEntryId");

-- CreateIndex
CREATE INDEX "parcel_org_payout_parcelOrgId_status_idx" ON "parcel_org_payout"("parcelOrgId", "status");

-- CreateIndex
CREATE INDEX "parcel_org_payout_status_createdAt_idx" ON "parcel_org_payout"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "parcel_org_payout" ADD CONSTRAINT "parcel_org_payout_parcelOrgId_fkey" FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_org_payout" ADD CONSTRAINT "parcel_org_payout_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_org_payout" ADD CONSTRAINT "parcel_org_payout_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
