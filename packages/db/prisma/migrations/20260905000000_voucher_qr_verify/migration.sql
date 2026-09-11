-- Esoko voucher cards + unified loyalty + trip QR + fare verification.
-- Go (services/core-go) is the sole writer; Prisma holds DDL only.

-- New platform float account kind for voucher KES backing.
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'VOUCHER_FLOAT';

-- Purpose/status enums
DO $$ BEGIN
  CREATE TYPE "VoucherPurpose" AS ENUM ('FARE', 'RENT', 'SHOPPING', 'GENERAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'FROZEN', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Trip QR columns (per active trip boarding code)
ALTER TABLE "trip" ADD COLUMN IF NOT EXISTS "qrToken" TEXT;
ALTER TABLE "trip" ADD COLUMN IF NOT EXISTS "qrShortCode" TEXT;
ALTER TABLE "trip" ADD COLUMN IF NOT EXISTS "qrRotatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "trip_qrToken_key" ON "trip"("qrToken");
CREATE UNIQUE INDEX IF NOT EXISTS "trip_qrShortCode_key" ON "trip"("qrShortCode");

-- Fare extensions: payer identity, voucher link, receipt lookup
ALTER TABLE "fare_payment" ADD COLUMN IF NOT EXISTS "buyerPartyId" UUID;
ALTER TABLE "fare_payment" ADD COLUMN IF NOT EXISTS "voucherId" UUID;
ALTER TABLE "fare_payment" ADD COLUMN IF NOT EXISTS "buyerName" TEXT;
CREATE INDEX IF NOT EXISTS "fare_payment_receiptCode_idx" ON "fare_payment"("mpesaReceiptCode");
CREATE INDEX IF NOT EXISTS "fare_payment_buyerParty_idx" ON "fare_payment"("buyerPartyId");

-- Voucher card
CREATE TABLE IF NOT EXISTS "voucher_card" (
    "id" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "giftedByPartyId" UUID,
    "label" TEXT NOT NULL DEFAULT 'Voucher',
    "purpose" "VoucherPurpose" NOT NULL DEFAULT 'GENERAL',
    "status" "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "qrToken" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "mpesaCheckoutRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voucher_card_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "voucher_card_qrToken_key" ON "voucher_card"("qrToken");
CREATE UNIQUE INDEX IF NOT EXISTS "voucher_card_shortCode_key" ON "voucher_card"("shortCode");
CREATE INDEX IF NOT EXISTS "voucher_card_owner_idx" ON "voucher_card"("ownerPartyId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "voucher_card_checkout_key" ON "voucher_card"("mpesaCheckoutRequestId");

-- Voucher ledger (points moves; balance = SUM)
CREATE TABLE IF NOT EXISTS "voucher_ledger_entry" (
    "id" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "kesEquiv" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voucher_ledger_entry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "voucher_ledger_voucher_idx" ON "voucher_ledger_entry"("voucherId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "voucher_ledger_journal_key" ON "voucher_ledger_entry"("journalEntryId");

-- Unified party loyalty
CREATE TABLE IF NOT EXISTS "party_loyalty_entry" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "party_loyalty_entry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "party_loyalty_party_idx" ON "party_loyalty_entry"("partyId", "createdAt");

-- Fare verification log (tout scans; anti-reuse analytics)
CREATE TABLE IF NOT EXISTS "fare_verification" (
    "id" UUID NOT NULL,
    "fareId" UUID NOT NULL,
    "verifierPartyId" TEXT,
    "verifierAgentId" TEXT,
    "scopeTripId" UUID,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fare_verification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "fare_verification_fare_idx" ON "fare_verification"("fareId", "createdAt");
CREATE INDEX IF NOT EXISTS "fare_verification_scope_idx" ON "fare_verification"("scopeTripId", "createdAt");

-- FKs (validated lazily to avoid locking on large tables)
ALTER TABLE "fare_payment" ADD CONSTRAINT "fare_payment_buyerParty_fkey" FOREIGN KEY ("buyerPartyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fare_payment" ADD CONSTRAINT "fare_payment_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "voucher_card"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "voucher_card" ADD CONSTRAINT "voucher_card_owner_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "voucher_ledger_entry" ADD CONSTRAINT "voucher_ledger_voucher_fkey" FOREIGN KEY ("voucherId") REFERENCES "voucher_card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_ledger_entry" ADD CONSTRAINT "voucher_ledger_journal_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fare_verification" ADD CONSTRAINT "fare_verification_fare_fkey" FOREIGN KEY ("fareId") REFERENCES "fare_payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
