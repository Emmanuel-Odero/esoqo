-- Buses stop inventing their own "originName/destinationName" route
-- vocabulary and ride the SAME ParcelRoute/ParcelRouteStop station
-- network a courier company's own runs already use — a bus from
-- Nairobi to Homabay via Kisii is one ParcelRoute with three stops,
-- not a second, flat two-place "route" that can't see the company's
-- own stations.
--
-- A route stop no longer has to be a real station: a bus may pass
-- through a town with no ParcelAgent shop yet, so stationId becomes
-- optional and placeName carries a plain name instead. Exactly one of
-- the two is required by parcel_route_stop_has_place.

-- AlterTable: parcel_route gains an optional distanceKm (bus fare
-- context; never used for parcel pricing).
ALTER TABLE "parcel_route" ADD COLUMN "distanceKm" INTEGER;

-- AlterTable: parcel_route_stop's station becomes optional, and gains
-- placeName as its free-text alternative.
ALTER TABLE "parcel_route_stop" ALTER COLUMN "stationId" DROP NOT NULL;
ALTER TABLE "parcel_route_stop" ADD COLUMN "placeName" TEXT;

ALTER TABLE "parcel_route_stop" DROP CONSTRAINT "parcel_route_stop_stationId_fkey";
ALTER TABLE "parcel_route_stop"
  ADD CONSTRAINT "parcel_route_stop_stationId_fkey"
  FOREIGN KEY ("stationId") REFERENCES "parcel_agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "parcel_route_stop"
  ADD CONSTRAINT "parcel_route_stop_has_place"
  CHECK ("stationId" IS NOT NULL OR "placeName" IS NOT NULL);

-- Data migration: every existing bus_route becomes a ParcelRoute with
-- two stops (origin, destination), both carried as placeName since a
-- free-text "originName"/"destinationName" has no station to point
-- at. The id is preserved so bus_schedule/bus_trip's existing
-- "routeId" values keep pointing at the right row once the FK below
-- is repointed at parcel_route.
INSERT INTO "parcel_route" ("id", "parcelOrgId", "name", "code", "active", "distanceKm", "createdAt")
SELECT "id", "parcelOrgId",
       "originName" || ' → ' || "destinationName",
       NULL, "active", "distanceKm", "createdAt"
FROM "bus_route";

INSERT INTO "parcel_route_stop" ("routeId", "sequence", "placeName")
SELECT "id", 0, "originName" FROM "bus_route";
INSERT INTO "parcel_route_stop" ("routeId", "sequence", "placeName")
SELECT "id", 1, "destinationName" FROM "bus_route";

-- Repoint bus_schedule/bus_trip at parcel_route instead of bus_route.
-- Values are untouched — only the FK target changes — since every
-- bus_route id now also exists as a parcel_route id.
ALTER TABLE "bus_schedule" DROP CONSTRAINT "bus_schedule_routeId_fkey";
ALTER TABLE "bus_schedule"
  ADD CONSTRAINT "bus_schedule_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "parcel_route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bus_trip" DROP CONSTRAINT "bus_trip_routeId_fkey";
ALTER TABLE "bus_trip"
  ADD CONSTRAINT "bus_trip_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "parcel_route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "bus_route";
