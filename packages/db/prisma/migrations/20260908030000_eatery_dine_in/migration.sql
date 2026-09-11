-- Eatery dine-in: persisting the table a scanned QR already claimed to
-- carry, kitchen-facing status, waiter (table) assignment, and tips.
-- Go (services/core-go) is the sole writer; Prisma holds DDL only.

-- CreateEnum
CREATE TYPE "DineInStatus" AS ENUM ('ORDERED', 'PREPARING', 'SERVED', 'PAYING', 'CLOSED');

-- AlterTable
ALTER TABLE "store_order" ADD COLUMN "tableLabel" TEXT;
ALTER TABLE "store_order" ADD COLUMN "dineInStatus" "DineInStatus";
ALTER TABLE "store_order" ADD COLUMN "tipKes" DECIMAL(12,2);
ALTER TABLE "store_order" ADD COLUMN "tippedCashierId" UUID;

-- CreateIndex
CREATE INDEX "store_order_storeId_tableLabel_dineInStatus_idx" ON "store_order"("storeId", "tableLabel", "dineInStatus");

-- AddForeignKey
ALTER TABLE "store_order" ADD CONSTRAINT "store_order_tippedCashierId_fkey"
    FOREIGN KEY ("tippedCashierId") REFERENCES "cashier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "table_assignment" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "tableLabel" TEXT NOT NULL,
    "cashierId" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "table_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "table_assignment_storeId_tableLabel_endedAt_idx" ON "table_assignment"("storeId", "tableLabel", "endedAt");

-- AddForeignKey
ALTER TABLE "table_assignment" ADD CONSTRAINT "table_assignment_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_assignment" ADD CONSTRAINT "table_assignment_cashierId_fkey"
    FOREIGN KEY ("cashierId") REFERENCES "cashier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
