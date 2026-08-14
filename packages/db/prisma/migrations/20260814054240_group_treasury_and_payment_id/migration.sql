-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('SELF_APP', 'SELF_USSD', 'AGENT_MARKED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING_SIGNATURES', 'APPROVED', 'EXECUTED', 'REJECTED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "ConsentPurpose" ADD VALUE 'LOAN_UNDERWRITING';

-- CreateTable
CREATE TABLE "meeting" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "agenda" TEXT,
    "quorumPct" INTEGER NOT NULL DEFAULT 50,
    "calledById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_record" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "present" BOOLEAN NOT NULL,
    "method" "AttendanceMethod" NOT NULL,
    "markedById" UUID,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_treasury_policy" (
    "orgId" UUID NOT NULL,
    "requiredSigners" INTEGER NOT NULL DEFAULT 2,
    "withdrawalLeadMinutes" INTEGER NOT NULL DEFAULT 70,
    "activeHoursStart" INTEGER NOT NULL DEFAULT 7,
    "activeHoursEnd" INTEGER NOT NULL DEFAULT 20,
    "requireQuorateMeeting" BOOLEAN NOT NULL DEFAULT false,
    "contributionAmountKes" DECIMAL(12,2),
    "contributionCycle" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "group_treasury_policy_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "group_signer" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" UUID NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "group_signer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_contribution" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "contributorId" UUID NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod",
    "reference" TEXT,
    "declaredNote" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DECLARED',
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" UUID,
    "checkoutRequestId" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_request" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "meetingId" UUID,
    "requestedById" UUID NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "purpose" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "payeeMsisdn" TEXT,
    "requiredSigners" INTEGER NOT NULL,
    "broadcastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "standbyOpensAt" TIMESTAMP(3) NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING_SIGNATURES',
    "decidedAt" TIMESTAMP(3),
    "journalEntryId" UUID,

    CONSTRAINT "withdrawal_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_signature" (
    "id" UUID NOT NULL,
    "withdrawalId" UUID NOT NULL,
    "signerId" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "pinVerifiedAt" TIMESTAMP(3) NOT NULL,
    "signature" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,

    CONSTRAINT "withdrawal_signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esoko_payment_id" (
    "partyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),

    CONSTRAINT "esoko_payment_id_pkey" PRIMARY KEY ("partyId")
);

-- CreateTable
CREATE TABLE "group_credit_insight_snapshot" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "contributionScore" INTEGER NOT NULL,
    "attendanceScore" INTEGER NOT NULL,
    "signatureScore" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disclosedViaConsentAccessId" UUID,

    CONSTRAINT "group_credit_insight_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_orgId_scheduledAt_idx" ON "meeting"("orgId", "scheduledAt");

-- CreateIndex
CREATE INDEX "attendance_record_personId_idx" ON "attendance_record"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_record_meetingId_personId_key" ON "attendance_record"("meetingId", "personId");

-- CreateIndex
CREATE INDEX "group_signer_orgId_removedAt_idx" ON "group_signer"("orgId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "group_signer_orgId_personId_key" ON "group_signer"("orgId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "group_contribution_checkoutRequestId_key" ON "group_contribution"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "group_contribution_journalEntryId_key" ON "group_contribution"("journalEntryId");

-- CreateIndex
CREATE INDEX "group_contribution_orgId_status_idx" ON "group_contribution"("orgId", "status");

-- CreateIndex
CREATE INDEX "group_contribution_contributorId_idx" ON "group_contribution"("contributorId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_request_journalEntryId_key" ON "withdrawal_request"("journalEntryId");

-- CreateIndex
CREATE INDEX "withdrawal_request_orgId_status_idx" ON "withdrawal_request"("orgId", "status");

-- CreateIndex
CREATE INDEX "withdrawal_request_standbyOpensAt_idx" ON "withdrawal_request"("standbyOpensAt");

-- CreateIndex
CREATE INDEX "withdrawal_signature_withdrawalId_idx" ON "withdrawal_signature"("withdrawalId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_signature_withdrawalId_signerId_key" ON "withdrawal_signature"("withdrawalId", "signerId");

-- CreateIndex
CREATE UNIQUE INDEX "esoko_payment_id_code_key" ON "esoko_payment_id"("code");

-- CreateIndex
CREATE INDEX "esoko_payment_id_code_idx" ON "esoko_payment_id"("code");

-- CreateIndex
CREATE INDEX "group_credit_insight_snapshot_partyId_computedAt_idx" ON "group_credit_insight_snapshot"("partyId", "computedAt");

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_calledById_fkey" FOREIGN KEY ("calledById") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_personId_fkey" FOREIGN KEY ("personId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_treasury_policy" ADD CONSTRAINT "group_treasury_policy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_signer" ADD CONSTRAINT "group_signer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_signer" ADD CONSTRAINT "group_signer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_contribution" ADD CONSTRAINT "group_contribution_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_contribution" ADD CONSTRAINT "group_contribution_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_contribution" ADD CONSTRAINT "group_contribution_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_contribution" ADD CONSTRAINT "group_contribution_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_contribution" ADD CONSTRAINT "group_contribution_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_request" ADD CONSTRAINT "withdrawal_request_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_signature" ADD CONSTRAINT "withdrawal_signature_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "withdrawal_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_signature" ADD CONSTRAINT "withdrawal_signature_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esoko_payment_id" ADD CONSTRAINT "esoko_payment_id_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_credit_insight_snapshot" ADD CONSTRAINT "group_credit_insight_snapshot_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
