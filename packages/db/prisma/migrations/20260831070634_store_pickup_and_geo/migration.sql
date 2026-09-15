-- AlterEnum
ALTER TYPE "StoreOrderStatus" ADD VALUE 'READY_FOR_PICKUP';

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "neighborhood" TEXT;

-- AlterTable
ALTER TABLE "store_order" ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "pickupCode" TEXT,
ADD COLUMN     "readyAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "store_latitude_longitude_idx" ON "store"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "store_order_pickupCode_key" ON "store_order"("pickupCode");

