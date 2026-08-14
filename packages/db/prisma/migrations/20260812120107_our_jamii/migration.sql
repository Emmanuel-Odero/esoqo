-- CreateEnum
CREATE TYPE "JamiiPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "JamiiTeamRole" AS ENUM ('ADMIN', 'EDITOR', 'CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DonationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'CAMPAIGN_RECEIVED';

-- AlterEnum
ALTER TYPE "ClaimType" ADD VALUE 'ORG_PAGE_VERIFIED';

-- CreateTable
CREATE TABLE "jamii_page" (
    "organisationId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "JamiiPageStatus" NOT NULL DEFAULT 'DRAFT',
    "tagline" TEXT,
    "missionShort" TEXT,
    "aboutUs" TEXT,
    "logoStorageKey" TEXT,
    "logoUrl" TEXT,
    "coverStorageKey" TEXT,
    "coverUrl" TEXT,
    "brandAccent" TEXT,
    "meetingSchedule" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "website" TEXT,
    "facebook" TEXT,
    "instagram" TEXT,
    "twitter" TEXT,
    "whatsapp" TEXT,
    "faq" JSONB NOT NULL DEFAULT '[]',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jamii_page_pkey" PRIMARY KEY ("organisationId")
);

-- CreateTable
CREATE TABLE "jamii_photo" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jamii_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jamii_post" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" TEXT NOT NULL,
    "imageStorageKey" TEXT,
    "imageUrl" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "authorPartyId" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jamii_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jamii_program" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "icon" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "linkedPostId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jamii_program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jamii_team_member" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "personId" UUID,
    "inviteName" TEXT NOT NULL,
    "inviteEmail" TEXT NOT NULL,
    "role" "JamiiTeamRole" NOT NULL DEFAULT 'EDITOR',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "jamii_team_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT,
    "goalKes" DECIMAL(12,2) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "coverStorageKey" TEXT,
    "coverUrl" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "accountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_update" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "donorPartyId" UUID,
    "donorName" TEXT NOT NULL DEFAULT 'Anonymous',
    "donorMsisdn" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "status" "DonationStatus" NOT NULL DEFAULT 'PENDING',
    "mpesaCheckoutRequestId" TEXT,
    "mpesaReceiptCode" TEXT,
    "receiptCode" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "donation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jamii_page_slug_key" ON "jamii_page"("slug");

-- CreateIndex
CREATE INDEX "jamii_page_status_idx" ON "jamii_page"("status");

-- CreateIndex
CREATE INDEX "jamii_photo_pageId_idx" ON "jamii_photo"("pageId");

-- CreateIndex
CREATE INDEX "jamii_post_pageId_status_idx" ON "jamii_post"("pageId", "status");

-- CreateIndex
CREATE INDEX "jamii_program_pageId_idx" ON "jamii_program"("pageId");

-- CreateIndex
CREATE INDEX "jamii_team_member_personId_idx" ON "jamii_team_member"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "jamii_team_member_pageId_inviteEmail_key" ON "jamii_team_member"("pageId", "inviteEmail");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_accountId_key" ON "campaign"("accountId");

-- CreateIndex
CREATE INDEX "campaign_status_idx" ON "campaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_pageId_slug_key" ON "campaign"("pageId", "slug");

-- CreateIndex
CREATE INDEX "campaign_update_campaignId_postedAt_idx" ON "campaign_update"("campaignId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "donation_mpesaCheckoutRequestId_key" ON "donation"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "donation_receiptCode_key" ON "donation"("receiptCode");

-- CreateIndex
CREATE UNIQUE INDEX "donation_journalEntryId_key" ON "donation"("journalEntryId");

-- CreateIndex
CREATE INDEX "donation_campaignId_status_idx" ON "donation"("campaignId", "status");

-- AddForeignKey
ALTER TABLE "jamii_page" ADD CONSTRAINT "jamii_page_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisation"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jamii_photo" ADD CONSTRAINT "jamii_photo_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jamii_post" ADD CONSTRAINT "jamii_post_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jamii_program" ADD CONSTRAINT "jamii_program_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jamii_team_member" ADD CONSTRAINT "jamii_team_member_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jamii_team_member" ADD CONSTRAINT "jamii_team_member_personId_fkey" FOREIGN KEY ("personId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_update" ADD CONSTRAINT "campaign_update_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation" ADD CONSTRAINT "donation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation" ADD CONSTRAINT "donation_donorPartyId_fkey" FOREIGN KEY ("donorPartyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation" ADD CONSTRAINT "donation_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
