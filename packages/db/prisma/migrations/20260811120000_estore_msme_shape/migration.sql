-- AlterTable
ALTER TABLE "store" ADD COLUMN     "codEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "availableOnOrder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product_variant" ADD COLUMN     "availableOnOrder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "store_order" ADD COLUMN     "deliveryAddress" TEXT;