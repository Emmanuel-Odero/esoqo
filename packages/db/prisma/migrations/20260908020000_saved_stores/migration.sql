-- "My spots" saved places — a person's own bookmark list of stores.
-- Go (services/core-go) is the sole writer; Prisma holds DDL only.

-- CreateTable
CREATE TABLE "saved_store" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_store_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_store_partyId_storeId_key" ON "saved_store"("partyId", "storeId");

-- CreateIndex
CREATE INDEX "saved_store_partyId_savedAt_idx" ON "saved_store"("partyId", "savedAt");

-- AddForeignKey
ALTER TABLE "saved_store" ADD CONSTRAINT "saved_store_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_store" ADD CONSTRAINT "saved_store_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
