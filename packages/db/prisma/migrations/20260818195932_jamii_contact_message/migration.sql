-- CreateEnum
CREATE TYPE "JamiiContactMessageStatus" AS ENUM ('NEW', 'READ', 'ARCHIVED');

-- CreateTable
CREATE TABLE "jamii_contact_message" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "status" "JamiiContactMessageStatus" NOT NULL DEFAULT 'NEW',
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jamii_contact_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jamii_contact_message_pageId_status_createdAt_idx" ON "jamii_contact_message"("pageId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "jamii_contact_message" ADD CONSTRAINT "jamii_contact_message_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
