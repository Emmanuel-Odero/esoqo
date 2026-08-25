-- AlterTable
ALTER TABLE "store_customer"
  ADD COLUMN "partyId" UUID,
  ADD COLUMN "creditLimitKes" DECIMAL(12,2),
  ADD COLUMN "creditTermsDays" INTEGER;

-- CreateIndex
CREATE INDEX "store_customer_partyId_idx" ON "store_customer"("partyId");

-- AddForeignKey
ALTER TABLE "store_customer"
  ADD CONSTRAINT "store_customer_partyId_fkey"
  FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;
