-- CreateEnum
CREATE TYPE "JamiiSitePageKind" AS ENUM ('SYSTEM_HOME', 'SYSTEM_ABOUT', 'SYSTEM_PROGRAMS', 'SYSTEM_CAMPAIGNS', 'SYSTEM_POSTS', 'SYSTEM_GALLERY', 'SYSTEM_LEADERSHIP', 'SYSTEM_FAQ', 'SYSTEM_CONTACT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "JamiiNavTargetKind" AS ENUM ('SITE_PAGE', 'EXTERNAL_URL');

-- AlterTable
ALTER TABLE "jamii_page_block" ADD COLUMN     "sitePageId" UUID;

-- CreateTable
CREATE TABLE "jamii_site_page" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "kind" "JamiiSitePageKind" NOT NULL DEFAULT 'CUSTOM',
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "ogImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jamii_site_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jamii_nav_item" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "targetKind" "JamiiNavTargetKind" NOT NULL DEFAULT 'SITE_PAGE',
    "targetSitePageId" UUID,
    "externalUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "openInNewTab" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jamii_nav_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jamii_site_page_pageId_kind_idx" ON "jamii_site_page"("pageId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "jamii_site_page_pageId_slug_key" ON "jamii_site_page"("pageId", "slug");

-- CreateIndex
CREATE INDEX "jamii_nav_item_pageId_position_idx" ON "jamii_nav_item"("pageId", "position");

-- CreateIndex
CREATE INDEX "jamii_page_block_sitePageId_idx" ON "jamii_page_block"("sitePageId");

-- AddForeignKey
ALTER TABLE "jamii_site_page" ADD CONSTRAINT "jamii_site_page_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jamii_nav_item" ADD CONSTRAINT "jamii_nav_item_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jamii_nav_item" ADD CONSTRAINT "jamii_nav_item_targetSitePageId_fkey" FOREIGN KEY ("targetSitePageId") REFERENCES "jamii_site_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jamii_page_block" ADD CONSTRAINT "jamii_page_block_sitePageId_fkey" FOREIGN KEY ("sitePageId") REFERENCES "jamii_site_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
