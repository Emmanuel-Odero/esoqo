-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('PERSON', 'ORGANISATION');

-- CreateEnum
CREATE TYPE "OrgKind" AS ENUM ('CHAMA', 'SELF_HELP_GROUP', 'TABLE_BANKING', 'WELFARE_GROUP', 'CBO', 'FBO', 'COOPERATIVE', 'SACCO', 'NGO', 'BUSINESS', 'SCHOOL', 'CLINIC', 'MARKET_ASSOCIATION', 'OTHER');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('CHAIRPERSON', 'TREASURER', 'SECRETARY', 'MEMBER');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTRATION', 'SIGN_IN', 'PIN_RESET', 'STEP_UP', 'CONSENT_GRANT');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('MSISDN_VERIFIED', 'EMAIL_VERIFIED', 'NATIONAL_ID_CONFIRMED', 'GROUP_REGISTERED', 'BUSINESS_REGISTERED', 'KRA_PIN', 'ETIMS_ACTIVE', 'MEDIATION_TRAINED', 'SINGLE_BUSINESS_PERMIT', 'FOOD_HANDLER', 'HEALTH_CLEARANCE', 'SECTOR_LICENCE', 'FIELD_VISIT', 'DELIVERY_CONFIRMED', 'TRADING_RECORD');

-- CreateEnum
CREATE TYPE "AttestationMethod" AS ENUM ('MANUAL', 'API', 'DOCUMENT', 'FIELD_VISIT', 'SELF_DECLARED');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('CREDIT_ASSESSMENT', 'INSURANCE_QUOTE', 'SUPPLY_CONTRACT', 'COUNTY_LICENSING', 'PROGRAMME_ENROLMENT');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('WALLET', 'ESCROW', 'GROUP_SAVINGS', 'FEE_INCOME', 'SETTLEMENT', 'SUSPENSE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MPESA', 'BANK_TRANSFER', 'CASH_TO_AGENT');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_DECLARED', 'DECLARED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'WAIVED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('STARTED', 'AWAITING_OTP', 'VERIFIED', 'COMPLETE', 'ABANDONED');

-- CreateEnum
CREATE TYPE "JoinPath" AS ENUM ('SELF_WEB', 'SELF_USSD', 'AGENT_ASSISTED', 'COHORT', 'INSTITUTION');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "party" (
    "id" UUID NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "county" TEXT NOT NULL,
    "ward" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "partyId" UUID NOT NULL,
    "officialName" TEXT NOT NULL,
    "knownAs" TEXT,
    "msisdn" TEXT NOT NULL,
    "nationalIdHash" TEXT,
    "email" CITEXT,
    "gender" TEXT,
    "yearOfBirth" INTEGER,
    "msisdnVerifiedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "displayPrefs" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "person_pkey" PRIMARY KEY ("partyId")
);

-- CreateTable
CREATE TABLE "organisation" (
    "partyId" UUID NOT NULL,
    "kind" "OrgKind" NOT NULL,
    "officialName" TEXT NOT NULL,
    "knownAs" TEXT,
    "registrationNo" TEXT,
    "memberCount" INTEGER,
    "formedOn" TIMESTAMP(3),

    CONSTRAINT "organisation_pkey" PRIMARY KEY ("partyId")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "workRaw" TEXT NOT NULL,
    "segment" TEXT,
    "sector" TEXT,
    "isRegistered" BOOLEAN NOT NULL DEFAULT false,
    "hasKraPin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credential" (
    "personId" UUID NOT NULL,
    "pinHash" TEXT,
    "pinSetAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_credential_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "otp_challenge" (
    "id" UUID NOT NULL,
    "msisdn" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "otp_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "partyId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attestation" (
    "id" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "claimType" "ClaimType" NOT NULL,
    "claimValue" JSONB NOT NULL DEFAULT '{}',
    "issuerOrgId" UUID,
    "issuerUserId" UUID,
    "method" "AttestationMethod" NOT NULL DEFAULT 'MANUAL',
    "evidenceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "signature" TEXT,
    "prevHash" TEXT,
    "hash" TEXT,

    CONSTRAINT "attestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issuer" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "kind" TEXT NOT NULL,
    "allowedClaims" "ClaimType"[] DEFAULT ARRAY[]::"ClaimType"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issuer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_grant" (
    "id" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "granteeId" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "scope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wordingShown" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revocationChannel" TEXT,

    CONSTRAINT "consent_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_access" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ip" TEXT,

    CONSTRAINT "consent_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "partyId" UUID,
    "kind" "AccountKind" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,

    CONSTRAINT "journal_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',

    CONSTRAINT "posting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration" (
    "id" UUID NOT NULL,
    "partyId" UUID,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'STARTED',
    "path" "JoinPath" NOT NULL DEFAULT 'SELF_WEB',
    "joiningAs" TEXT NOT NULL,
    "officialName" TEXT,
    "knownAs" TEXT,
    "msisdn" TEXT,
    "email" CITEXT,
    "county" TEXT,
    "ward" TEXT,
    "workRaw" TEXT,
    "segment" TEXT,
    "orgName" TEXT,
    "orgKnownAs" TEXT,
    "orgRole" TEXT,
    "memberCount" INTEGER,
    "hasRegisteredBusiness" TEXT,
    "registrationNo" TEXT,
    "belongsToGroup" TEXT,
    "groupName" TEXT,
    "hasKraPin" TEXT,
    "wantsPriceSms" BOOLEAN NOT NULL DEFAULT false,
    "wantsReceiptSms" BOOLEAN NOT NULL DEFAULT true,
    "wantsExpirySms" BOOLEAN NOT NULL DEFAULT true,
    "ussdSetupChoice" TEXT,
    "msisdnVerifiedAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "agentId" UUID,
    "language" TEXT NOT NULL DEFAULT 'en',
    "ip" TEXT,
    "userAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,

    CONSTRAINT "registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_payment" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "method" "PaymentMethod",
    "reference" CITEXT,
    "amountKes" DECIMAL(12,2),
    "declaredNote" TEXT,
    "declaredAt" TIMESTAMP(3),
    "status" "PaymentStatus" NOT NULL DEFAULT 'NOT_DECLARED',
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "registration_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_approval" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "approverId" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "note" TEXT,
    "signature" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,

    CONSTRAINT "payment_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "partyId" UUID,
    "registrationId" UUID,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewNote" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByType" TEXT NOT NULL DEFAULT 'SUBJECT',
    "uploadedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "extracted" JSONB,
    "ocrConfidence" INTEGER,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_record" (
    "id" UUID NOT NULL,
    "partyId" UUID,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "deviceId" TEXT,

    CONSTRAINT "session_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_user" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "orgId" UUID,
    "rolePreset" TEXT DEFAULT 'VIEWER',
    "countyScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invitedById" UUID,
    "mustChangePin" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" BIGSERIAL NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "county" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hasFieldOfficer" BOOLEAN NOT NULL DEFAULT false,
    "pricesLive" BOOLEAN NOT NULL DEFAULT false,
    "population" TEXT,
    "financeActRef" TEXT,
    "verifiedOn" TIMESTAMP(3),

    CONSTRAINT "county_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "market" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "countyCode" TEXT NOT NULL,
    "marketDays" TEXT,
    "reporting" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit" (
    "id" UUID NOT NULL,
    "countyCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "feeText" TEXT NOT NULL,
    "note" TEXT,
    "claimType" "ClaimType",

    CONSTRAINT "permit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commodity" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "commodity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_quote" (
    "id" UUID NOT NULL,
    "commodityId" UUID NOT NULL,
    "marketId" UUID NOT NULL,
    "priceKes" DECIMAL(12,2) NOT NULL,
    "quotedFor" DATE NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "collectedBy" TEXT,

    CONSTRAINT "price_quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "party_county_kind_idx" ON "party"("county", "kind");

-- CreateIndex
CREATE INDEX "party_createdAt_idx" ON "party"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "person_msisdn_key" ON "person"("msisdn");

-- CreateIndex
CREATE UNIQUE INDEX "person_nationalIdHash_key" ON "person"("nationalIdHash");

-- CreateIndex
CREATE INDEX "person_msisdn_idx" ON "person"("msisdn");

-- CreateIndex
CREATE INDEX "organisation_kind_idx" ON "organisation"("kind");

-- CreateIndex
CREATE INDEX "membership_orgId_role_idx" ON "membership"("orgId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "membership_personId_orgId_key" ON "membership"("personId", "orgId");

-- CreateIndex
CREATE INDEX "enterprise_segment_idx" ON "enterprise"("segment");

-- CreateIndex
CREATE INDEX "enterprise_sector_idx" ON "enterprise"("sector");

-- CreateIndex
CREATE INDEX "otp_challenge_msisdn_purpose_createdAt_idx" ON "otp_challenge"("msisdn", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "otp_challenge_expiresAt_idx" ON "otp_challenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokenHash_key" ON "email_verification"("tokenHash");

-- CreateIndex
CREATE INDEX "email_verification_email_idx" ON "email_verification"("email");

-- CreateIndex
CREATE INDEX "attestation_subjectId_claimType_idx" ON "attestation"("subjectId", "claimType");

-- CreateIndex
CREATE INDEX "attestation_expiresAt_idx" ON "attestation"("expiresAt");

-- CreateIndex
CREATE INDEX "attestation_claimType_revokedAt_idx" ON "attestation"("claimType", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "issuer_name_key" ON "issuer"("name");

-- CreateIndex
CREATE INDEX "consent_grant_subjectId_revokedAt_idx" ON "consent_grant"("subjectId", "revokedAt");

-- CreateIndex
CREATE INDEX "consent_grant_granteeId_expiresAt_idx" ON "consent_grant"("granteeId", "expiresAt");

-- CreateIndex
CREATE INDEX "consent_access_grantId_accessedAt_idx" ON "consent_access"("grantId", "accessedAt");

-- CreateIndex
CREATE INDEX "account_kind_idx" ON "account"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "account_partyId_kind_currency_key" ON "account"("partyId", "kind", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_reference_key" ON "journal_entry"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_idempotencyKey_key" ON "journal_entry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "journal_entry_occurredAt_idx" ON "journal_entry"("occurredAt");

-- CreateIndex
CREATE INDEX "posting_accountId_entryId_idx" ON "posting"("accountId", "entryId");

-- CreateIndex
CREATE UNIQUE INDEX "registration_partyId_key" ON "registration"("partyId");

-- CreateIndex
CREATE INDEX "registration_status_startedAt_idx" ON "registration"("status", "startedAt");

-- CreateIndex
CREATE INDEX "registration_county_idx" ON "registration"("county");

-- CreateIndex
CREATE INDEX "registration_msisdn_idx" ON "registration"("msisdn");

-- CreateIndex
CREATE UNIQUE INDEX "registration_payment_registrationId_key" ON "registration_payment"("registrationId");

-- CreateIndex
CREATE INDEX "registration_payment_status_idx" ON "registration_payment"("status");

-- CreateIndex
CREATE INDEX "payment_approval_paymentId_idx" ON "payment_approval"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_approval_paymentId_approverId_key" ON "payment_approval"("paymentId", "approverId");

-- CreateIndex
CREATE UNIQUE INDEX "document_storageKey_key" ON "document"("storageKey");

-- CreateIndex
CREATE INDEX "document_partyId_kind_idx" ON "document"("partyId", "kind");

-- CreateIndex
CREATE INDEX "document_registrationId_idx" ON "document"("registrationId");

-- CreateIndex
CREATE INDEX "document_status_uploadedAt_idx" ON "document"("status", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "session_record_tokenHash_key" ON "session_record"("tokenHash");

-- CreateIndex
CREATE INDEX "session_record_partyId_revokedAt_idx" ON "session_record"("partyId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_email_key" ON "staff_user"("email");

-- CreateIndex
CREATE INDEX "staff_user_active_rolePreset_idx" ON "staff_user"("active", "rolePreset");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_hash_key" ON "audit_event"("hash");

-- CreateIndex
CREATE INDEX "audit_event_occurredAt_idx" ON "audit_event"("occurredAt");

-- CreateIndex
CREATE INDEX "audit_event_action_occurredAt_idx" ON "audit_event"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_event_actorId_idx" ON "audit_event"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "county_name_key" ON "county"("name");

-- CreateIndex
CREATE UNIQUE INDEX "market_name_countyCode_key" ON "market"("name", "countyCode");

-- CreateIndex
CREATE INDEX "permit_countyCode_idx" ON "permit"("countyCode");

-- CreateIndex
CREATE UNIQUE INDEX "commodity_name_key" ON "commodity"("name");

-- CreateIndex
CREATE INDEX "price_quote_quotedFor_idx" ON "price_quote"("quotedFor");

-- CreateIndex
CREATE UNIQUE INDEX "price_quote_commodityId_marketId_quotedFor_key" ON "price_quote"("commodityId", "marketId", "quotedFor");

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisation" ADD CONSTRAINT "organisation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise" ADD CONSTRAINT "enterprise_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credential" ADD CONSTRAINT "user_credential_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attestation" ADD CONSTRAINT "attestation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attestation" ADD CONSTRAINT "attestation_issuerOrgId_fkey" FOREIGN KEY ("issuerOrgId") REFERENCES "issuer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_grant" ADD CONSTRAINT "consent_grant_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_grant" ADD CONSTRAINT "consent_grant_granteeId_fkey" FOREIGN KEY ("granteeId") REFERENCES "issuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_access" ADD CONSTRAINT "consent_access_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "consent_grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting" ADD CONSTRAINT "posting_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting" ADD CONSTRAINT "posting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration" ADD CONSTRAINT "registration_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_payment" ADD CONSTRAINT "registration_payment_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval" ADD CONSTRAINT "payment_approval_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "registration_payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval" ADD CONSTRAINT "payment_approval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market" ADD CONSTRAINT "market_countyCode_fkey" FOREIGN KEY ("countyCode") REFERENCES "county"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit" ADD CONSTRAINT "permit_countyCode_fkey" FOREIGN KEY ("countyCode") REFERENCES "county"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_quote" ADD CONSTRAINT "price_quote_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
