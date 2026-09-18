-- A courier company's own dispatch runs: one vehicle, its crew, an
-- origin and destination station, and the receiving team waiting at the
-- far end to check parcels in on arrival.
--
-- A dispatch is a tenant-level run, not a parcel-level state: parcels
-- keep their own lifecycle, and the run carries whoever and whatever
-- the company loads onto it. Status is ACTIVE until the receiving team
-- checks it in (ARRIVED, with receivedBy naming who signed) or a
-- manager calls it off (CANCELLED). currentLat/currentLng is the last
-- reported position; the ping table behind it keeps the trail the live
-- map draws.
--
-- Crew roles are plain strings (DRIVER, TOUT, LOADER, OTHER + customRole
-- for a free-text title), the same convention ParcelOrgStaff.role
-- follows: a fixed enum would need a migration every time a company
-- invents a job title. Receivers are roster links where possible
-- (staffId) with a name snapshot, so the run still reads sensibly if
-- the roster row is later renamed.
CREATE TABLE "parcel_dispatch" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "parcelOrgId" UUID NOT NULL REFERENCES "parcel_org"("id") ON DELETE CASCADE,
  "vehiclePlate" TEXT NOT NULL,
  "vehicleType" TEXT NOT NULL DEFAULT 'VAN',
  "originStationId" UUID REFERENCES "parcel_agent"("id") ON DELETE SET NULL,
  "destinationStationId" UUID REFERENCES "parcel_agent"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "currentLat" DOUBLE PRECISION,
  "currentLng" DOUBLE PRECISION,
  "currentAt" TIMESTAMPTZ,
  "createdByStaffId" UUID REFERENCES "parcel_org_staff"("id") ON DELETE SET NULL,
  "arrivedAt" TIMESTAMPTZ,
  "receivedBy" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "parcel_dispatch_org_status_idx" ON "parcel_dispatch"("parcelOrgId", "status");

CREATE TABLE "parcel_dispatch_crew" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "dispatchId" UUID NOT NULL REFERENCES "parcel_dispatch"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "msisdn" TEXT,
  "role" TEXT NOT NULL DEFAULT 'DRIVER',
  "customRole" TEXT,
  "staffId" UUID REFERENCES "parcel_org_staff"("id") ON DELETE SET NULL
);
CREATE INDEX "parcel_dispatch_crew_dispatch_idx" ON "parcel_dispatch_crew"("dispatchId");

CREATE TABLE "parcel_dispatch_receiver" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "dispatchId" UUID NOT NULL REFERENCES "parcel_dispatch"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "staffId" UUID REFERENCES "parcel_org_staff"("id") ON DELETE SET NULL
);
CREATE INDEX "parcel_dispatch_receiver_dispatch_idx" ON "parcel_dispatch_receiver"("dispatchId");

CREATE TABLE "parcel_dispatch_ping" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "dispatchId" UUID NOT NULL REFERENCES "parcel_dispatch"("id") ON DELETE CASCADE,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "parcel_dispatch_ping_dispatch_at_idx" ON "parcel_dispatch_ping"("dispatchId", "at" DESC);
