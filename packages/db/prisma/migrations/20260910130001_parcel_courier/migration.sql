-- The formal courier role — see model ParcelCourier's own comment on
-- why "any Party" wasn't enough anymore.

-- CreateEnum
CREATE TYPE "ParcelCourierStatus" AS ENUM ('PENDING_VETTING', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateTable
CREATE TABLE "parcel_courier" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "vehicleType" "ParcelTransportMode" NOT NULL,
    "status" "ParcelCourierStatus" NOT NULL DEFAULT 'PENDING_VETTING',
    "vettingNote" TEXT,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID,

    CONSTRAINT "parcel_courier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parcel_courier_partyId_key" ON "parcel_courier"("partyId");

-- CreateIndex
CREATE INDEX "parcel_courier_status_idx" ON "parcel_courier"("status");
