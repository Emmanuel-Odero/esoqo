-- Unified crew identity (docs/proposals/esoko-unified-crew-identity.md):
-- org-scoped staff capabilities as grants on a real Party/SUBJECT account
-- instead of a separate AGENT PIN login. A grant makes a party *eligible*
-- to act as staff for an org; it does not by itself authorise anything —
-- see org_context_activation for the live, OTP-gated switch that actually
-- does. Go (services/core-go) is the sole writer; Prisma holds DDL only.

-- CreateTable
CREATE TABLE "org_staff_grant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orgId" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "grantedBy" UUID NOT NULL,
    "suspendedBy" UUID,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_staff_grant_pkey" PRIMARY KEY ("id")
);

-- One active-or-not grant per (org, party) — re-granting after a
-- suspension reinstates the same row rather than inserting a duplicate.
CREATE UNIQUE INDEX "org_staff_grant_orgId_partyId_key" ON "org_staff_grant"("orgId", "partyId");
CREATE INDEX "org_staff_grant_partyId_idx" ON "org_staff_grant"("partyId");

ALTER TABLE "org_staff_grant" ADD CONSTRAINT "org_staff_grant_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_staff_grant" ADD CONSTRAINT "org_staff_grant_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_staff_grant" ADD CONSTRAINT "org_staff_grant_grantedBy_fkey"
    FOREIGN KEY ("grantedBy") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "org_staff_grant" ADD CONSTRAINT "org_staff_grant_suspendedBy_fkey"
    FOREIGN KEY ("suspendedBy") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
