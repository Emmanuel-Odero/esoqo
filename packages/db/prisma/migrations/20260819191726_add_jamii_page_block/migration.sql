-- CreateEnum
CREATE TYPE "JamiiBlockType" AS ENUM ('STATS_TICKER', 'EXPLORE_GRID', 'ACTIVE_CAMPAIGN', 'DONATE_BAND', 'RICH_TEXT', 'TESTIMONIAL', 'PHOTO_STRIP');

-- CreateTable
CREATE TABLE "jamii_page_block" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "type" "JamiiBlockType" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jamii_page_block_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jamii_page_block_pageId_idx" ON "jamii_page_block"("pageId");

-- AddForeignKey
ALTER TABLE "jamii_page_block" ADD CONSTRAINT "jamii_page_block_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
