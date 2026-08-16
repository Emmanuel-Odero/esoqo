-- AlterTable
ALTER TABLE "jamii_interest" ADD COLUMN     "personId" UUID;

-- CreateIndex
CREATE INDEX "jamii_interest_personId_idx" ON "jamii_interest"("personId");

-- AddForeignKey
ALTER TABLE "jamii_interest" ADD CONSTRAINT "jamii_interest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
