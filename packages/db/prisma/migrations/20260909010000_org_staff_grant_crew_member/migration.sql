-- AGENT retirement, step 1 (docs/proposals/esoko-unified-crew-identity.md):
-- a CREW org_staff_grant needs the same crewMemberId link
-- ticket_org_staff already has, so trip.close:own and "my active trip"
-- resolve identically whether the session behind them is an AGENT PIN
-- login or a SUBJECT with a live, OTP-activated CREW context. Go
-- (services/core-go) is the sole writer; Prisma holds DDL only.

-- AlterTable
ALTER TABLE "org_staff_grant" ADD COLUMN "crewMemberId" UUID;

ALTER TABLE "org_staff_grant" ADD CONSTRAINT "org_staff_grant_crewMemberId_fkey"
    FOREIGN KEY ("crewMemberId") REFERENCES "crew_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "org_staff_grant_crewMemberId_idx" ON "org_staff_grant"("crewMemberId");
