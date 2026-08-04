-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StoreRoutingMode" AS ENUM ('PATH', 'SUBDOMAIN');

-- CreateEnum
CREATE TYPE "StoreOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StoreOrderPaymentMethod" AS ENUM ('MPESA_STK', 'CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "PosSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'MPESA_TILL');

-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'STORE_REVENUE';

-- CreateTable
CREATE TABLE "store" (
    "id" UUID NOT NULL,
    "enterpriseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "StoreStatus" NOT NULL DEFAULT 'DRAFT',
    "themeKey" TEXT NOT NULL DEFAULT 'market',
    "routingMode" "StoreRoutingMode" NOT NULL DEFAULT 'PATH',
    "customDomain" TEXT,
    "posEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceKes" DECIMAL(12,2) NOT NULL,
    "stockQty" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_order" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "buyerPartyId" UUID,
    "buyerName" TEXT NOT NULL,
    "buyerMsisdn" TEXT NOT NULL,
    "status" "StoreOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentMethod" "StoreOrderPaymentMethod" NOT NULL DEFAULT 'MPESA_STK',
    "totalKes" DECIMAL(12,2) NOT NULL,
    "mpesaCheckoutRequestId" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "store_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_order_item" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceKes" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "store_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sale" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "clientSaleId" TEXT NOT NULL,
    "paymentMethod" "PosPaymentMethod" NOT NULL,
    "totalKes" DECIMAL(12,2) NOT NULL,
    "syncStatus" "PosSyncStatus" NOT NULL DEFAULT 'SYNCED',
    "soldAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journalEntryId" UUID,

    CONSTRAINT "pos_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sale_item" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceKes" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "pos_sale_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rule" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2),
    "amountPct" DECIMAL(5,2),
    "billingPeriod" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "pricing_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_slug_key" ON "store"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "store_customDomain_key" ON "store"("customDomain");

-- CreateIndex
CREATE INDEX "store_enterpriseId_idx" ON "store"("enterpriseId");

-- CreateIndex
CREATE INDEX "store_status_idx" ON "store"("status");

-- CreateIndex
CREATE INDEX "product_storeId_status_idx" ON "product"("storeId", "status");

-- CreateIndex
CREATE INDEX "product_image_productId_idx" ON "product_image"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "store_order_mpesaCheckoutRequestId_key" ON "store_order"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "store_order_journalEntryId_key" ON "store_order"("journalEntryId");

-- CreateIndex
CREATE INDEX "store_order_storeId_status_idx" ON "store_order"("storeId", "status");

-- CreateIndex
CREATE INDEX "store_order_item_orderId_idx" ON "store_order_item"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sale_clientSaleId_key" ON "pos_sale"("clientSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sale_journalEntryId_key" ON "pos_sale"("journalEntryId");

-- CreateIndex
CREATE INDEX "pos_sale_storeId_soldAt_idx" ON "pos_sale"("storeId", "soldAt");

-- CreateIndex
CREATE INDEX "pos_sale_item_saleId_idx" ON "pos_sale_item"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rule_key_key" ON "pricing_rule"("key");

-- AddForeignKey
ALTER TABLE "store" ADD CONSTRAINT "store_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order" ADD CONSTRAINT "store_order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order" ADD CONSTRAINT "store_order_buyerPartyId_fkey" FOREIGN KEY ("buyerPartyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order" ADD CONSTRAINT "store_order_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_item" ADD CONSTRAINT "store_order_item_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "store_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_order_item" ADD CONSTRAINT "store_order_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale" ADD CONSTRAINT "pos_sale_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_item" ADD CONSTRAINT "pos_sale_item_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "pos_sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sale_item" ADD CONSTRAINT "pos_sale_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rule" ADD CONSTRAINT "pricing_rule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "staff_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

