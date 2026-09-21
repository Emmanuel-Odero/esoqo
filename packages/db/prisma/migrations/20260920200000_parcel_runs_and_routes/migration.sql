-- One run, and routes as a first-class thing. See ADR-0006.
--
-- A courier company's vehicle movement was two tables with no foreign
-- key between them: parcel_shipment owned the cargo (parcel_shipment_item,
-- with load/offload times) and knew places only as free text;
-- parcel_dispatch owned the journey (station FKs, crew, receiving team,
-- GPS trail) and had no parcels at all. One lorry, two rows, and which
-- one you got depended on which screen you opened.
--
-- This merges into parcel_shipment — it already serves both Esoqo-operated
-- runs (parcelOrgId NULL) and a company's own, and it already owns the
-- join table where the valuable data lives. The journey columns are
-- additive; the cargo table is not touched.

-- ── 1. Routes ────────────────────────────────────────────────────────
--
-- An ordered list of stations a company serves. Runs may cite one or
-- stand alone: an ad-hoc vehicle at the door has to be openable without
-- a manager defining a route first, or the counter stops during exactly
-- the rush the ad-hoc run exists to absorb.

CREATE TABLE "parcel_route" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "parcelOrgId" UUID NOT NULL,
  "name"        TEXT NOT NULL,
  -- Short form for manifests and labels ("NBO-KSM"). Not unique across
  -- the platform — two companies may both run a Nairobi-Kisumu and both
  -- call it that — but unique within one company's own book.
  "code"        TEXT,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "parcel_route_parcelOrgId_fkey"
    FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id") ON DELETE CASCADE
);

CREATE INDEX "parcel_route_org_idx" ON "parcel_route" ("parcelOrgId", "active");
CREATE UNIQUE INDEX "parcel_route_org_code_key"
  ON "parcel_route" ("parcelOrgId", lower("code")) WHERE "code" IS NOT NULL;

-- One stop on a route. sequence is dense and 0-based within a route;
-- a leg is simply a consecutive pair, which is why there is no leg
-- table — see ADR-0006.
CREATE TABLE "parcel_route_stop" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "routeId"   UUID NOT NULL,
  "sequence"  INTEGER NOT NULL,
  "stationId" UUID NOT NULL,

  CONSTRAINT "parcel_route_stop_routeId_fkey"
    FOREIGN KEY ("routeId") REFERENCES "parcel_route"("id") ON DELETE CASCADE,
  -- RESTRICT, not SET NULL: a stop with no station is not a stop, and
  -- silently blanking one would renumber a route under a dispatcher who
  -- was mid-journey against it. Deleting a station used by a route is
  -- refused, and the manager removes the stop first.
  CONSTRAINT "parcel_route_stop_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "parcel_agent"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "parcel_route_stop_route_seq_key"
  ON "parcel_route_stop" ("routeId", "sequence");
CREATE INDEX "parcel_route_stop_station_idx" ON "parcel_route_stop" ("stationId");

-- ── 2. The run gains its journey half ────────────────────────────────
--
-- Every column here came off parcel_dispatch. Nullable throughout:
-- existing shipment rows are real runs that simply never carried this
-- information, and a NOT NULL default would invent a plate or a station
-- for a run that never had one.

ALTER TABLE "parcel_shipment"
  ADD COLUMN "routeId"              UUID,
  ADD COLUMN "originStationId"      UUID,
  ADD COLUMN "destinationStationId" UUID,
  ADD COLUMN "vehicleType"          TEXT,
  ADD COLUMN "notes"                TEXT,
  ADD COLUMN "currentLat"           DOUBLE PRECISION,
  ADD COLUMN "currentLng"           DOUBLE PRECISION,
  ADD COLUMN "currentAt"            TIMESTAMP(3),
  ADD COLUMN "receivedBy"           TEXT;

ALTER TABLE "parcel_shipment"
  ADD CONSTRAINT "parcel_shipment_routeId_fkey"
    FOREIGN KEY ("routeId") REFERENCES "parcel_route"("id") ON DELETE SET NULL,
  -- SET NULL, unlike route stops: a run that happened keeps its
  -- originLabel/destinationLabel text regardless, so losing the station
  -- link degrades the record rather than destroying it.
  ADD CONSTRAINT "parcel_shipment_originStationId_fkey"
    FOREIGN KEY ("originStationId") REFERENCES "parcel_agent"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "parcel_shipment_destinationStationId_fkey"
    FOREIGN KEY ("destinationStationId") REFERENCES "parcel_agent"("id") ON DELETE SET NULL;

CREATE INDEX "parcel_shipment_route_idx" ON "parcel_shipment" ("routeId", "createdAt" DESC);

-- ── 3. OPEN becomes LOADING ──────────────────────────────────────────
--
-- What it always meant, said out loud, and now distinguishable from a
-- migrated dispatch that was already on the road.

UPDATE "parcel_shipment" SET "status" = 'LOADING' WHERE "status" = 'OPEN';

-- The column default names the old status too. CreateOrgShipment relies
-- on it rather than passing status explicitly, so leaving it would mint
-- every new run into a state nothing matches — invisible to the loading
-- picker, undepartable, and silently so.
ALTER TABLE "parcel_shipment" ALTER COLUMN "status" SET DEFAULT 'LOADING';

-- The partial index from 20260920100000 names the old status in its
-- predicate, so it has to be rebuilt rather than left to quietly match
-- nothing.
DROP INDEX IF EXISTS "parcel_shipment_org_open_idx";
CREATE INDEX "parcel_shipment_org_loading_idx"
  ON "parcel_shipment" ("parcelOrgId", "createdAt" DESC)
  WHERE "status" = 'LOADING';

-- ── 4. Move the dispatches in ────────────────────────────────────────
--
-- Keeping each dispatch's own id as the new shipment's id. That is what
-- makes the children cheap: parcel_dispatch_crew."dispatchId" already
-- holds a value that is now a valid parcel_shipment id, so only the
-- column it points through has to be renamed.
--
-- Status: a dispatch was created at the moment a vehicle set off and had
-- no loading phase, because it had no parcels to load. ACTIVE therefore
-- becomes DEPARTED, not LOADING — calling these rows LOADING would
-- assert a state they were never in.
--
-- The labels are filled from the station names so the merged run reads
-- correctly on every screen that still shows text, and so the snapshot
-- rule holds from the start: the label records what the station was
-- called on the day the run existed.

INSERT INTO "parcel_shipment" (
  "id", "parcelOrgId", "originLabel", "destinationLabel", "routeLabel",
  "vehiclePlate", "vehicleType", "originStationId", "destinationStationId",
  "status", "notes", "currentLat", "currentLng", "currentAt",
  "arrivedAt", "endedAt", "receivedBy", "createdByStaffId", "createdAt"
)
SELECT
  d."id", d."parcelOrgId",
  COALESCE(o."name", 'Origin'), COALESCE(x."name", 'Destination'), NULL,
  d."vehiclePlate", d."vehicleType", d."originStationId", d."destinationStationId",
  CASE d."status"
    WHEN 'ACTIVE'    THEN 'DEPARTED'
    WHEN 'ARRIVED'   THEN 'ARRIVED'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    ELSE 'DEPARTED'
  END,
  d."notes", d."currentLat", d."currentLng", d."currentAt",
  d."arrivedAt", d."arrivedAt", d."receivedBy", d."createdByStaffId", d."createdAt"
FROM "parcel_dispatch" d
LEFT JOIN "parcel_agent" o ON o."id" = d."originStationId"
LEFT JOIN "parcel_agent" x ON x."id" = d."destinationStationId";

-- ── 5. Re-point the children ─────────────────────────────────────────
--
-- Rename, re-point, re-index. The values inside the column do not
-- change — step 4 made them valid shipment ids.

ALTER TABLE "parcel_dispatch_crew" DROP CONSTRAINT "parcel_dispatch_crew_dispatchId_fkey";
ALTER TABLE "parcel_dispatch_crew" RENAME COLUMN "dispatchId" TO "runId";
ALTER TABLE "parcel_dispatch_crew" RENAME TO "parcel_run_crew";
ALTER TABLE "parcel_run_crew"
  ADD CONSTRAINT "parcel_run_crew_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "parcel_shipment"("id") ON DELETE CASCADE;
ALTER INDEX "parcel_dispatch_crew_dispatch_idx" RENAME TO "parcel_run_crew_run_idx";

ALTER TABLE "parcel_dispatch_receiver" DROP CONSTRAINT "parcel_dispatch_receiver_dispatchId_fkey";
ALTER TABLE "parcel_dispatch_receiver" RENAME COLUMN "dispatchId" TO "runId";
ALTER TABLE "parcel_dispatch_receiver" RENAME TO "parcel_run_receiver";
ALTER TABLE "parcel_run_receiver"
  ADD CONSTRAINT "parcel_run_receiver_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "parcel_shipment"("id") ON DELETE CASCADE;
ALTER INDEX "parcel_dispatch_receiver_dispatch_idx" RENAME TO "parcel_run_receiver_run_idx";

ALTER TABLE "parcel_dispatch_ping" DROP CONSTRAINT "parcel_dispatch_ping_dispatchId_fkey";
ALTER TABLE "parcel_dispatch_ping" RENAME COLUMN "dispatchId" TO "runId";
ALTER TABLE "parcel_dispatch_ping" RENAME TO "parcel_run_ping";
ALTER TABLE "parcel_run_ping"
  ADD CONSTRAINT "parcel_run_ping_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "parcel_shipment"("id") ON DELETE CASCADE;
ALTER INDEX "parcel_dispatch_ping_dispatch_at_idx" RENAME TO "parcel_run_ping_run_at_idx";

-- ── 6. The old table goes ────────────────────────────────────────────
--
-- Forward-only. Its rows are in parcel_shipment under the same ids and
-- its children now hang off them.

DROP TABLE "parcel_dispatch";
