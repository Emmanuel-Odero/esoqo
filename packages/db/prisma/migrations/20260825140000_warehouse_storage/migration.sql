-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'WAREHOUSE_REVENUE';

-- AlterTable
ALTER TABLE "store" ADD COLUMN "dispatchWarehouseOrgId" UUID;
CREATE INDEX "store_dispatchWarehouseOrgId_idx" ON "store"("dispatchWarehouseOrgId");
ALTER TABLE "store" ADD CONSTRAINT "store_dispatchWarehouseOrgId_fkey"
  FOREIGN KEY ("dispatchWarehouseOrgId") REFERENCES "organisation"("partyId") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "storage_agreement" (
    "id" UUID NOT NULL,
    "warehouseOrgId" UUID NOT NULL,
    "tenantEnterpriseId" UUID NOT NULL,
    "feeKes" DECIMAL(12,2) NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "unitLabel" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "storage_agreement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "storage_agreement_tenantEnterpriseId_idx" ON "storage_agreement"("tenantEnterpriseId");
CREATE INDEX "storage_agreement_warehouseOrgId_idx" ON "storage_agreement"("warehouseOrgId");
ALTER TABLE "storage_agreement" ADD CONSTRAINT "storage_agreement_warehouseOrgId_fkey"
  FOREIGN KEY ("warehouseOrgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storage_agreement" ADD CONSTRAINT "storage_agreement_tenantEnterpriseId_fkey"
  FOREIGN KEY ("tenantEnterpriseId") REFERENCES "enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "stock_location" (
    "id" UUID NOT NULL,
    "warehouseOrgId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "productId" UUID,
    "variantId" UUID,
    "quantity" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_location_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_location_warehouseOrgId_storeId_productId_variantId_key"
  ON "stock_location"("warehouseOrgId", "storeId", "productId", "variantId");
CREATE INDEX "stock_location_storeId_idx" ON "stock_location"("storeId");
ALTER TABLE "stock_location" ADD CONSTRAINT "stock_location_warehouseOrgId_fkey"
  FOREIGN KEY ("warehouseOrgId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_location" ADD CONSTRAINT "stock_location_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_location" ADD CONSTRAINT "stock_location_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_location" ADD CONSTRAINT "stock_location_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
