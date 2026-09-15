-- A courier's own location history — mirrors VehiclePing's exact
-- shape (see model ParcelCourierPing's own comment).

-- CreateTable
CREATE TABLE "parcel_courier_ping" (
    "id" UUID NOT NULL,
    "courierPartyId" UUID NOT NULL,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_courier_ping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parcel_courier_ping_courierPartyId_at_idx" ON "parcel_courier_ping"("courierPartyId", "at");

-- AddForeignKey
ALTER TABLE "parcel_courier_ping" ADD CONSTRAINT "parcel_courier_ping_courierPartyId_fkey"
    FOREIGN KEY ("courierPartyId") REFERENCES "parcel_courier"("partyId") ON DELETE CASCADE ON UPDATE CASCADE;
