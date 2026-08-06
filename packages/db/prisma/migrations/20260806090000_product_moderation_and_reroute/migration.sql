-- Product catalog category, staff moderation (suspend, separate from a
-- merchant's own hide toggle, plus a running comment thread), and
-- staff-mediated order reroute flagging.

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "category" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" UUID;

-- AlterTable
ALTER TABLE "store_order" ADD COLUMN     "needsReroute" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rerouteFlaggedAt" TIMESTAMP(3),
ADD COLUMN     "rerouteFlaggedById" UUID,
ADD COLUMN     "rerouteReason" TEXT;

-- CreateTable
CREATE TABLE "product_staff_note" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_staff_note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_staff_note_productId_createdAt_idx" ON "product_staff_note"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "product_category_idx" ON "product"("category");

-- CreateIndex
CREATE INDEX "store_order_needsReroute_idx" ON "store_order"("needsReroute");

-- AddForeignKey
ALTER TABLE "product_staff_note" ADD CONSTRAINT "product_staff_note_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
