-- CreateEnum
CREATE TYPE "DomainMode" AS ENUM ('PRIMARY', 'CUSTOM');

-- CreateTable
CREATE TABLE "site_visit" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "domainMode" "DomainMode" NOT NULL,
    "referrerHost" TEXT,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "site_visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_spend" (
    "id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "estimatedCostKes" DECIMAL(6,2) NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_spend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_visit_slug_day_idx" ON "site_visit"("slug", "day");

-- CreateIndex
CREATE UNIQUE INDEX "site_visit_slug_path_domainMode_day_referrerHost_key" ON "site_visit"("slug", "path", "domainMode", "day", "referrerHost");

-- CreateIndex
CREATE INDEX "sms_spend_purpose_createdAt_idx" ON "sms_spend"("purpose", "createdAt");
