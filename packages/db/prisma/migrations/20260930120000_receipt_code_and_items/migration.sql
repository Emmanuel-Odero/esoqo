-- AlterTable
ALTER TABLE "receipt" ADD COLUMN     "businessPaymentId" UUID,
ADD COLUMN     "receiptCode" TEXT,
ALTER COLUMN "storeId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "receipt_item" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "quantity" INTEGER NOT NULL,
    "unitPriceKes" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "receipt_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receipt_item_receiptId_idx" ON "receipt_item"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_receiptCode_key" ON "receipt"("receiptCode");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_businessPaymentId_key" ON "receipt"("businessPaymentId");

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_businessPaymentId_fkey" FOREIGN KEY ("businessPaymentId") REFERENCES "business_payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_item" ADD CONSTRAINT "receipt_item_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_item" ADD CONSTRAINT "receipt_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_item" ADD CONSTRAINT "receipt_item_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

