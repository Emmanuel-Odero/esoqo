-- CreateEnum
CREATE TYPE "PosSaleStatus" AS ENUM ('COMPLETED', 'REFUNDED', 'VOID');

-- AlterEnum
ALTER TYPE "PosPaymentMethod" ADD VALUE 'MPESA_STK';

-- AlterTable
ALTER TABLE "pos_sale" ADD COLUMN     "cashierId" UUID,
ADD COLUMN     "changeKes" DECIMAL(12,2),
ADD COLUMN     "customerId" UUID,
ADD COLUMN     "discountKes" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "shiftId" UUID,
ADD COLUMN     "status" "PosSaleStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "tenderedKes" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "pos_sale_item" ADD COLUMN     "costKes" DECIMAL(12,2),
ADD COLUMN     "discountKes" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "variantId" UUID;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "costKes" DECIMAL(12,2),
ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "registration_payment" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "etimsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "loyaltyPerKes" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "store_order" ADD COLUMN     "collectionNotes" TEXT,
ADD COLUMN     "customerId" UUID,
ADD COLUMN     "deliveryFeeKes" DECIMAL(12,2),
ADD COLUMN     "deliveryOptionId" UUID;

-- AlterTable
ALTER TABLE "store_order_item" ADD COLUMN     "costKes" DECIMAL(12,2),
ADD COLUMN     "variantId" UUID;

-- CreateTable
CREATE TABLE "product_variant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "priceKes" DECIMAL(12,2) NOT NULL,
    "stockQty" INTEGER,
    "costKes" DECIMAL(12,2),
    "sku" TEXT,

    CONSTRAINT "product_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfilment_option" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "feeKes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "fulfilment_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_purchase" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "supplierId" UUID,
    "quantity" INTEGER NOT NULL,
    "unitCostKes" DECIMAL(12,2) NOT NULL,
    "totalCostKes" DECIMAL(12,2) NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_customer" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "msisdn" TEXT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_ledger_entry" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "saleId" UUID,
    "orderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_entry" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "saleId" UUID,
    "orderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashier" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CASHIER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingFloatKes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expectedCashKes" DECIMAL(12,2),
    "countedCashKes" DECIMAL(12,2),
    "varianceKes" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_refund" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "cashierId" UUID,
    "reason" TEXT NOT NULL,
    "refundMethod" "PosPaymentMethod" NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "saleId" UUID,
    "orderId" UUID,
    "totalKes" DECIMAL(12,2) NOT NULL,
    "etimsSerial" TEXT,
    "channel" TEXT NOT NULL,
    "sentTo" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_variant_productId_idx" ON "product_variant"("productId");

-- CreateIndex
CREATE INDEX "fulfilment_option_storeId_active_idx" ON "fulfilment_option"("storeId", "active");

-- CreateIndex
CREATE INDEX "supplier_storeId_name_idx" ON "supplier"("storeId", "name");

-- CreateIndex
CREATE INDEX "stock_purchase_storeId_purchasedAt_idx" ON "stock_purchase"("storeId", "purchasedAt");

-- CreateIndex
CREATE INDEX "stock_purchase_productId_idx" ON "stock_purchase"("productId");

-- CreateIndex
CREATE INDEX "stock_purchase_supplierId_idx" ON "stock_purchase"("supplierId");

-- CreateIndex
CREATE INDEX "store_customer_storeId_name_idx" ON "store_customer"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "store_customer_storeId_msisdn_key" ON "store_customer"("storeId", "msisdn");

-- CreateIndex
CREATE INDEX "customer_ledger_entry_customerId_createdAt_idx" ON "customer_ledger_entry"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_entry_customerId_createdAt_idx" ON "loyalty_entry"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "cashier_storeId_idx" ON "cashier"("storeId");

-- CreateIndex
CREATE INDEX "shift_storeId_openedAt_idx" ON "shift"("storeId", "openedAt");

-- CreateIndex
CREATE INDEX "shift_status_idx" ON "shift"("status");

-- CreateIndex
CREATE INDEX "pos_refund_saleId_idx" ON "pos_refund"("saleId");

-- CreateIndex
CREATE INDEX "pos_refund_storeId_createdAt_idx" ON "pos_refund"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_receiptNo_key" ON "receipt"("receiptNo");

-- CreateIndex
CREATE INDEX "receipt_storeId_issuedAt_idx" ON "receipt"("storeId", "issuedAt");

-- CreateIndex
CREATE INDEX "receipt_saleId_idx" ON "receipt"("saleId");

-- CreateIndex
CREATE INDEX "pos_sale_storeId_status_idx" ON "pos_sale"("storeId", "status");

-- CreateIndex
CREATE INDEX "pos_sale_shiftId_idx" ON "pos_sale"("shiftId");

-- AddForeignKey
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfilment_option" ADD CONSTRAINT "fulfilment_option_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order" ADD CONSTRAINT "store_order_deliveryOptionId_fkey" FOREIGN KEY ("deliveryOptionId") REFERENCES "fulfilment_option"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order" ADD CONSTRAINT "store_order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "store_customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_item" ADD CONSTRAINT "store_order_item_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "cashier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "store_customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_item" ADD CONSTRAINT "pos_sale_item_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchase" ADD CONSTRAINT "stock_purchase_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchase" ADD CONSTRAINT "stock_purchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchase" ADD CONSTRAINT "stock_purchase_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchase" ADD CONSTRAINT "stock_purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_customer" ADD CONSTRAINT "store_customer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "store_customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger_entry" ADD CONSTRAINT "customer_ledger_entry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entry" ADD CONSTRAINT "loyalty_entry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "store_customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entry" ADD CONSTRAINT "loyalty_entry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entry" ADD CONSTRAINT "loyalty_entry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier" ADD CONSTRAINT "cashier_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "cashier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_refund" ADD CONSTRAINT "pos_refund_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_refund" ADD CONSTRAINT "pos_refund_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_refund" ADD CONSTRAINT "pos_refund_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "cashier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
