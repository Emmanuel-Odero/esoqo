-- Parcels ride the passenger fleet.
--
-- A parcel can now be loaded onto an actual matatu or intercity bus on
-- a scheduled run, handed to the conductor, and taken off at a named
-- stage. The vehicle is already reporting its position through
-- VehiclePing for the passengers sitting in it; a parcel on board
-- inherits that for free, which is what makes "track your parcel on the
-- bus you ride" possible without a single new tracking device.
--
-- Deliberately separate from the existing "courierTripId" column, which
-- points at the parcel vertical's own CourierTrip (a courier team's
-- dispatch round). These are two different vehicles doing two different
-- jobs, and collapsing them would make "where is it" ambiguous in
-- exactly the situation where it matters most.

ALTER TABLE "parcel"
    ADD COLUMN "tripId" UUID,
    ADD COLUMN "tripBoardedAt" TIMESTAMP(3),
    ADD COLUMN "tripDroppedAt" TIMESTAMP(3),
    ADD COLUMN "dropStageId" UUID;

ALTER TABLE "parcel"
    ADD CONSTRAINT "parcel_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "parcel"
    ADD CONSTRAINT "parcel_dropStageId_fkey"
    FOREIGN KEY ("dropStageId") REFERENCES "fare_stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The conductor's manifest query: "what is on my bus right now, and
-- where does each piece come off". Partial, because the overwhelming
-- majority of parcels never ride a passenger trip at all.
CREATE INDEX "parcel_on_trip_idx"
    ON "parcel"("tripId", "dropStageId")
    WHERE "tripId" IS NOT NULL AND "tripDroppedAt" IS NULL;
