-- ParcelZone: admin-curated hubs with coordinates, the pricing/
-- dispatch signal Parcel.originLabel/destinationLabel free text never
-- was. Parcel gets optional FK columns to it plus SLA/exception
-- tracking. ParcelPricingRule gets slaHours.

-- CreateTable
CREATE TABLE "parcel_zone" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_zone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parcel_zone_name_key" ON "parcel_zone"("name");

-- AlterTable
ALTER TABLE "parcel"
    ADD COLUMN "originZoneId" UUID,
    ADD COLUMN "destinationZoneId" UUID,
    ADD COLUMN "slaDeadlineAt" TIMESTAMP(3),
    ADD COLUMN "exceptionNote" TEXT,
    ADD COLUMN "exceptionFlaggedAt" TIMESTAMP(3),
    ADD COLUMN "exceptionFlaggedByStaffId" UUID;

-- AlterTable
ALTER TABLE "parcel_pricing_rule"
    ADD COLUMN "slaHours" INTEGER;
