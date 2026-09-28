-- A group's activity feed — the free "in-app to everyone" half of
-- notifications that are otherwise SMS to a narrower audience (signers,
-- officers). Read-only: nothing ever updates a row once written.

-- CreateEnum
CREATE TYPE "GroupActivityKind" AS ENUM (
    'MEMBER_JOINED', 'MEMBER_REMOVED', 'CONTRIBUTION_CONFIRMED',
    'WITHDRAWAL_REQUESTED', 'WITHDRAWAL_SIGNED', 'WITHDRAWAL_EXECUTED',
    'WITHDRAWAL_REJECTED', 'WITHDRAWAL_EXPIRED'
);

-- CreateTable
CREATE TABLE "group_activity_event" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "kind" "GroupActivityKind" NOT NULL,
    "actorId" UUID,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_activity_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_activity_event_orgId_createdAt_idx" ON "group_activity_event"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "group_activity_event" ADD CONSTRAINT "group_activity_event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_activity_event" ADD CONSTRAINT "group_activity_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
