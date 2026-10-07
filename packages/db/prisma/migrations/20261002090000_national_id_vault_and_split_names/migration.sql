-- Encrypted national ID vault, split names, and premium esoqo IDs (commit 4436f12)

-- CreateEnum
CREATE TYPE "EsoqoIdSource" AS ENUM ('SYSTEM_GENERATED', 'PREMIUM_FULL_NAME', 'PREMIUM_CUSTOM', 'PREMIUM_PHONE', 'PREMIUM_EMAIL');

-- CreateEnum
CREATE TYPE "EsoqoIdPurchaseKind" AS ENUM ('FULL_NAME', 'CUSTOM_DIGITS', 'PHONE', 'EMAIL', 'RENEWAL');

-- CreateEnum
CREATE TYPE "EsoqoIdPurchaseStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- AlterTable
ALTER TABLE "person" ADD COLUMN "dateOfBirth" DATE,
ADD COLUMN "firstName" TEXT,
ADD COLUMN "middleName" TEXT,
ADD COLUMN "surname" TEXT;

-- AlterTable
ALTER TABLE "registration" ADD COLUMN "dateOfBirth" DATE,
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "firstName" TEXT,
ADD COLUMN "middleName" TEXT,
ADD COLUMN "surname" TEXT;

-- AlterTable
ALTER TABLE "esoko_payment_id" ADD COLUMN "premiumExpiresAt" TIMESTAMP(3),
ADD COLUMN "source" "EsoqoIdSource" NOT NULL DEFAULT 'SYSTEM_GENERATED';

-- CreateTable
CREATE TABLE "national_id_record" (
    "partyId" UUID NOT NULL,
    "idNumberEnc" BYTEA NOT NULL,
    "serialNumberEnc" BYTEA,
    "sex" TEXT,
    "districtOfBirth" TEXT,
    "dateOfIssue" DATE,
    "frontDocumentId" UUID,
    "backDocumentId" UUID,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "national_id_record_pkey" PRIMARY KEY ("partyId")
);

-- CreateTable
CREATE TABLE "esoqo_id_purchase" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "esoqoId" UUID NOT NULL,
    "kind" "EsoqoIdPurchaseKind" NOT NULL,
    "requestedHandle" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "status" "EsoqoIdPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "mpesaCheckoutRequestId" TEXT,
    "mpesaReceiptCode" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "esoqo_id_purchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "esoqo_id_purchase_mpesaCheckoutRequestId_key" ON "esoqo_id_purchase"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "esoqo_id_purchase_journalEntryId_key" ON "esoqo_id_purchase"("journalEntryId");

-- CreateIndex
CREATE INDEX "esoqo_id_purchase_partyId_status_idx" ON "esoqo_id_purchase"("partyId", "status");

-- AddForeignKey
ALTER TABLE "national_id_record" ADD CONSTRAINT "national_id_record_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "person"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esoqo_id_purchase" ADD CONSTRAINT "esoqo_id_purchase_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esoqo_id_purchase" ADD CONSTRAINT "esoqo_id_purchase_esoqoId_fkey" FOREIGN KEY ("esoqoId") REFERENCES "esoko_payment_id"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esoqo_id_purchase" ADD CONSTRAINT "esoqo_id_purchase_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
