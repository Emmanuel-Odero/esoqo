-- AlterTable: Party gains subCounty/district, below county, above ward.
ALTER TABLE "party"
  ADD COLUMN "subCounty" TEXT,
  ADD COLUMN "district" TEXT;

-- AlterTable: Organisation gains member tags + business-only fields.
ALTER TABLE "organisation"
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "businessType" TEXT,
  ADD COLUMN "businessTypeOther" TEXT,
  ADD COLUMN "intendsToRegister" BOOLEAN;

-- AlterTable: Enterprise gains the operational-detail fields captured
-- during business onboarding (employees, revenue, banking, channels).
ALTER TABLE "enterprise"
  ADD COLUMN "employeeCount" INTEGER,
  ADD COLUMN "revenueGoodDayKes" DECIMAL(12,2),
  ADD COLUMN "revenueBadDayKes" DECIMAL(12,2),
  ADD COLUMN "bankProvider" TEXT,
  ADD COLUMN "paymentChannels" TEXT[] NOT NULL DEFAULT '{}';

-- AlterTable: Registration funnel gains group-detail fields (only asked
-- when creating a brand-new group) and the full business sub-flow.
ALTER TABLE "registration"
  ADD COLUMN "orgKind" TEXT,
  ADD COLUMN "orgSubCounty" TEXT,
  ADD COLUMN "orgDistrict" TEXT,
  ADD COLUMN "orgTags" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "bizName" TEXT,
  ADD COLUMN "bizIsRegistered" TEXT,
  ADD COLUMN "bizIntendsToRegister" TEXT,
  ADD COLUMN "bizPartyId" UUID,
  ADD COLUMN "bizSector" TEXT,
  ADD COLUMN "bizType" TEXT,
  ADD COLUMN "bizTypeOther" TEXT,
  ADD COLUMN "bizEmployeeCount" INTEGER,
  ADD COLUMN "bizRevenueGoodKes" DECIMAL(12,2),
  ADD COLUMN "bizRevenueBadKes" DECIMAL(12,2),
  ADD COLUMN "bizBankProvider" TEXT,
  ADD COLUMN "bizPaymentChannels" TEXT[] NOT NULL DEFAULT '{}';

-- AddForeignKey: bizPartyId mirrors groupPartyId — set when the joiner
-- picked an existing business from the live search.
ALTER TABLE "registration"
  ADD CONSTRAINT "registration_bizPartyId_fkey"
  FOREIGN KEY ("bizPartyId") REFERENCES "party"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: RegistrationPayment gains the STK-push idempotency guard.
ALTER TABLE "registration_payment"
  ADD COLUMN "checkoutRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "registration_payment_checkoutRequestId_key"
  ON "registration_payment"("checkoutRequestId");
