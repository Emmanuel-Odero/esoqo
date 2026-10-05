-- Named funding kitties inside a group ("Grace funeral", "Midai
-- wedding") — each with its own target, contributors, and signatories,
-- distinct from the group's everyday treasury signers. Real cash still
-- lives in the group's one GROUP_SAVINGS account; a project is an
-- earmark on that pool, not a second bank account.

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProjectContributionStatus" AS ENUM ('DECLARED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ProjectWithdrawalStatus" AS ENUM ('PENDING_SIGNATURES', 'EXECUTED', 'REJECTED');

-- CreateTable
CREATE TABLE "group_project" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT,
    "targetKes" DECIMAL(12,2),
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "group_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_project_signer" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "group_project_signer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_project_contribution" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "contributorId" UUID NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "status" "ProjectContributionStatus" NOT NULL DEFAULT 'DECLARED',
    "reference" TEXT,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" UUID,
    "journalEntryId" UUID,

    CONSTRAINT "group_project_contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_project_withdrawal" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "purpose" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "requiredApprovals" INTEGER NOT NULL,
    "status" "ProjectWithdrawalStatus" NOT NULL DEFAULT 'PENDING_SIGNATURES',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "journalEntryId" UUID,

    CONSTRAINT "group_project_withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_project_withdrawal_vote" (
    "id" UUID NOT NULL,
    "withdrawalId" UUID NOT NULL,
    "voterId" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_project_withdrawal_vote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_project_orgId_status_idx" ON "group_project"("orgId", "status");
CREATE UNIQUE INDEX "group_project_signer_projectId_personId_key" ON "group_project_signer"("projectId", "personId");
CREATE INDEX "group_project_contribution_projectId_status_idx" ON "group_project_contribution"("projectId", "status");
CREATE UNIQUE INDEX "group_project_contribution_journalEntryId_key" ON "group_project_contribution"("journalEntryId");
CREATE INDEX "group_project_withdrawal_projectId_status_idx" ON "group_project_withdrawal"("projectId", "status");
CREATE UNIQUE INDEX "group_project_withdrawal_journalEntryId_key" ON "group_project_withdrawal"("journalEntryId");
CREATE UNIQUE INDEX "group_project_withdrawal_vote_withdrawalId_voterId_key" ON "group_project_withdrawal_vote"("withdrawalId", "voterId");

-- AddForeignKey
ALTER TABLE "group_project" ADD CONSTRAINT "group_project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_project" ADD CONSTRAINT "group_project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "group_project_signer" ADD CONSTRAINT "group_project_signer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "group_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_project_signer" ADD CONSTRAINT "group_project_signer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "group_project_contribution" ADD CONSTRAINT "group_project_contribution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "group_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_project_contribution" ADD CONSTRAINT "group_project_contribution_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_project_contribution" ADD CONSTRAINT "group_project_contribution_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "group_project_contribution" ADD CONSTRAINT "group_project_contribution_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "group_project_withdrawal" ADD CONSTRAINT "group_project_withdrawal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "group_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_project_withdrawal" ADD CONSTRAINT "group_project_withdrawal_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_project_withdrawal" ADD CONSTRAINT "group_project_withdrawal_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "group_project_withdrawal_vote" ADD CONSTRAINT "group_project_withdrawal_vote_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "group_project_withdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_project_withdrawal_vote" ADD CONSTRAINT "group_project_withdrawal_vote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
