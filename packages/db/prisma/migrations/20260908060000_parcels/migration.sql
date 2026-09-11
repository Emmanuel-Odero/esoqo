-- Parcels: a physical object's custody chain — who booked it, who's
-- holding it, and an append-only log of every hand-off. Go
-- (services/core-go) is the sole writer; Prisma holds DDL only.

-- CreateEnum
CREATE TYPE "ParcelStatus" AS ENUM ('BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED');

-- CreateTable
CREATE TABLE "parcel" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "deliveryCode" TEXT NOT NULL,
    "senderPartyId" UUID,
    "senderName" TEXT NOT NULL,
    "senderMsisdn" TEXT NOT NULL,
    "receiverName" TEXT NOT NULL,
    "receiverMsisdn" TEXT NOT NULL,
    "originLabel" TEXT NOT NULL,
    "destinationLabel" TEXT NOT NULL,
    "notes" TEXT,
    "currentHolderPartyId" UUID,
    "status" "ParcelStatus" NOT NULL DEFAULT 'BOOKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "parcel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parcel_code_key" ON "parcel"("code");

-- CreateIndex
CREATE INDEX "parcel_currentHolderPartyId_status_idx" ON "parcel"("currentHolderPartyId", "status");

-- CreateIndex
CREATE INDEX "parcel_senderPartyId_createdAt_idx" ON "parcel"("senderPartyId", "createdAt");

-- CreateTable
CREATE TABLE "parcel_handoff" (
    "id" UUID NOT NULL,
    "parcelId" UUID NOT NULL,
    "toPartyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parcel_handoff_parcelId_createdAt_idx" ON "parcel_handoff"("parcelId", "createdAt");

-- AddForeignKey
ALTER TABLE "parcel_handoff" ADD CONSTRAINT "parcel_handoff_parcelId_fkey"
    FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
