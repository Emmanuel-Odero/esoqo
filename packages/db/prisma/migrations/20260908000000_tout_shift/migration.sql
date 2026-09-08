-- Tout shift: end-of-shift vehicle status on Trip, and linking a CREW
-- ticket_org_staff PIN login to the CrewMember it actually is, so a
-- crew session can be authorised to close only the one trip it's
-- driving/conducting. Go (services/core-go) is the sole writer;
-- Prisma holds DDL only.

-- CreateEnum
CREATE TYPE "TripEndStatus" AS ENUM ('OK', 'NEEDS_FUEL', 'NEEDS_REPAIR');

-- AlterTable
ALTER TABLE "trip" ADD COLUMN "endStatus" "TripEndStatus";
ALTER TABLE "trip" ADD COLUMN "endNote" TEXT;

-- AlterTable
ALTER TABLE "ticket_org_staff" ADD COLUMN "crewMemberId" UUID;

-- AddForeignKey
ALTER TABLE "ticket_org_staff" ADD CONSTRAINT "ticket_org_staff_crewMemberId_fkey"
    FOREIGN KEY ("crewMemberId") REFERENCES "crew_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ticket_org_staff_crewMemberId_idx" ON "ticket_org_staff"("crewMemberId");
