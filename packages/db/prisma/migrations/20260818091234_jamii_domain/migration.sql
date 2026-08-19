-- CreateEnum
CREATE TYPE "JamiiDomainStatus" AS ENUM ('PENDING_DNS', 'VERIFYING', 'ACTIVE', 'FAILED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "jamii_domain" (
    "id" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "JamiiDomainStatus" NOT NULL DEFAULT 'PENDING_DNS',
    "verificationToken" TEXT NOT NULL,
    "cfHostnameId" TEXT,
    "cfStatus" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "requestedByPartyId" UUID NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jamii_domain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jamii_domain_pageId_key" ON "jamii_domain"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "jamii_domain_hostname_key" ON "jamii_domain"("hostname");

-- CreateIndex
CREATE INDEX "jamii_domain_status_idx" ON "jamii_domain"("status");

-- AddForeignKey
ALTER TABLE "jamii_domain" ADD CONSTRAINT "jamii_domain_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "jamii_page"("organisationId") ON DELETE CASCADE ON UPDATE CASCADE;
