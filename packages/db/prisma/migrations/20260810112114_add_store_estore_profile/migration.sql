-- AlterTable
ALTER TABLE "store" ADD COLUMN     "aboutUs" TEXT,
ADD COLUMN     "brandAccent" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPerson" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES',
ADD COLUMN     "deliveryOrigin" TEXT,
ADD COLUMN     "deliveryZones" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "facebook" TEXT,
ADD COLUMN     "faviconStorageKey" TEXT,
ADD COLUMN     "faviconUrl" TEXT,
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "linkedin" TEXT,
ADD COLUMN     "logoStorageKey" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "physicalAddress" TEXT,
ADD COLUMN     "primaryCategory" TEXT,
ADD COLUMN     "processingDays" INTEGER,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "settlementPhone" TEXT,
ADD COLUMN     "skuCount" INTEGER,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "taxRatePct" INTEGER,
ADD COLUMN     "tiktok" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- CreateTable
CREATE TABLE "store_photo" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_photo_storeId_idx" ON "store_photo"("storeId");

-- AddForeignKey
ALTER TABLE "store_photo" ADD CONSTRAINT "store_photo_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
