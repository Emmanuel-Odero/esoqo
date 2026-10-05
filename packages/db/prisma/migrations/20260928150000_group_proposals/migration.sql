-- A decision put to the group's signatories rather than taken by one
-- officer — "vote on proposed decisions eg add/remove a member".

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('ADD_MEMBER', 'REMOVE_MEMBER');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('OPEN', 'PASSED', 'REJECTED');

-- CreateTable
CREATE TABLE "group_proposal" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "targetPersonId" UUID,
    "targetMsisdn" TEXT,
    "targetName" TEXT,
    "proposedById" UUID NOT NULL,
    "requiredApprovals" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "group_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_proposal_vote" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "voterId" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_proposal_vote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_proposal_orgId_status_idx" ON "group_proposal"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "group_proposal_vote_proposalId_voterId_key" ON "group_proposal_vote"("proposalId", "voterId");

-- AddForeignKey
ALTER TABLE "group_proposal" ADD CONSTRAINT "group_proposal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_proposal" ADD CONSTRAINT "group_proposal_targetPersonId_fkey" FOREIGN KEY ("targetPersonId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_proposal" ADD CONSTRAINT "group_proposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_proposal_vote" ADD CONSTRAINT "group_proposal_vote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "group_proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_proposal_vote" ADD CONSTRAINT "group_proposal_vote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
