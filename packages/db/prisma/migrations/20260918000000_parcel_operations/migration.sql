-- Operational facts captured at acceptance and during line-haul movement.
-- These are append-only custody facts, not presentation-only fields.

ALTER TYPE "ParcelStatus" ADD VALUE IF NOT EXISTS 'REJECTED_AT_DROPOFF';

ALTER TABLE "parcel"
    ADD COLUMN "itemCategory" TEXT,
    ADD COLUMN "itemDescription" TEXT,
    ADD COLUMN "perishable" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "perishableHandling" TEXT,
    ADD COLUMN "expiryAt" TIMESTAMP(3),
    ADD COLUMN "intakeCondition" TEXT,
    ADD COLUMN "intakeAcceptedByStaffId" UUID,
    ADD COLUMN "intakeRejectedAt" TIMESTAMP(3),
    ADD COLUMN "intakeRejectionReason" TEXT,
    ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastReminderAt" TIMESTAMP(3);

CREATE TABLE "parcel_shipment" (
    "id" UUID NOT NULL,
    "originLabel" TEXT NOT NULL,
    "destinationLabel" TEXT NOT NULL,
    "routeLabel" TEXT,
    "vehiclePlate" TEXT,
    "driverPartyId" UUID,
    "conductorPartyId" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByStaffId" UUID,
    CONSTRAINT "parcel_shipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "parcel_shipment_item" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "parcelId" UUID NOT NULL,
    "loadedAt" TIMESTAMP(3),
    "loadedByPartyId" UUID,
    "loadedByStaffId" UUID,
    "offloadedAt" TIMESTAMP(3),
    "offloadedByPartyId" UUID,
    "offloadedByStaffId" UUID,
    "exceptionCode" TEXT,
    "exceptionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "parcel_shipment_item_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "parcel_shipment_item_shipment_fkey" FOREIGN KEY ("shipmentId") REFERENCES "parcel_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "parcel_shipment_item_parcel_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "parcel_shipment_item_shipmentId_parcelId_key" ON "parcel_shipment_item"("shipmentId", "parcelId");
CREATE INDEX "parcel_shipment_status_idx" ON "parcel_shipment"("status");
CREATE INDEX "parcel_shipment_item_shipmentId_loadedAt_idx" ON "parcel_shipment_item"("shipmentId", "loadedAt");
CREATE INDEX "parcel_shipment_item_shipmentId_offloadedAt_idx" ON "parcel_shipment_item"("shipmentId", "offloadedAt");
CREATE INDEX "parcel_shipment_item_parcelId_idx" ON "parcel_shipment_item"("parcelId");