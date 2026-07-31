-- AlterTable
ALTER TABLE "registration"
  ADD COLUMN "groupPartyId" UUID,
  ADD COLUMN "feeCoverage" TEXT;

-- AddForeignKey
ALTER TABLE "registration"
  ADD CONSTRAINT "registration_groupPartyId_fkey"
  FOREIGN KEY ("groupPartyId") REFERENCES "party"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
