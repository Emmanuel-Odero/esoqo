-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('BUG', 'QUESTION', 'BILLING', 'ACCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "support_ticket" (
    "id" UUID NOT NULL,
    "reporterPartyId" UUID NOT NULL,
    "pageId" UUID,
    "category" "SupportTicketCategory" NOT NULL DEFAULT 'OTHER',
    "categoryOther" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "staffNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_ticket_status_createdAt_idx" ON "support_ticket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "support_ticket_reporterPartyId_idx" ON "support_ticket"("reporterPartyId");

-- AddForeignKey
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_reporterPartyId_fkey" FOREIGN KEY ("reporterPartyId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE SET NULL ON UPDATE CASCADE;
