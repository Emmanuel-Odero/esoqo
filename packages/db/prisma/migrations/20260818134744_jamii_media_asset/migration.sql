-- CreateEnum
CREATE TYPE "JamiiMediaCategory" AS ENUM ('HERO', 'GALLERY', 'POST');

-- CreateTable
CREATE TABLE "jamii_media_asset" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "JamiiMediaCategory" NOT NULL,
    "patternKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jamii_media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jamii_media_asset_key_key" ON "jamii_media_asset"("key");

-- CreateIndex
CREATE INDEX "jamii_media_asset_category_active_idx" ON "jamii_media_asset"("category", "active");
