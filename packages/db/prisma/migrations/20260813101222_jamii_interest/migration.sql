-- CreateEnum
CREATE TYPE "JamiiInterestStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "jamii_interest" (
    "id" UUID NOT NULL,
    "status" "JamiiInterestStatus" NOT NULL DEFAULT 'NEW',
    "fullName" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "email" CITEXT,
    "county" TEXT,
    "organisationName" TEXT,
    "message" TEXT,
    "reviewedByStaffId" UUID,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jamii_interest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jamii_interest_status_createdAt_idx" ON "jamii_interest"("status", "createdAt");
