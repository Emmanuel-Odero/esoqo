-- Bring-your-own parcel id (companies importing parcels they already
-- track elsewhere) + a named manager for each station.
--
-- externalRef is the tenant's own number from their previous system,
-- deliberately separate from Parcel.code (Esoqo's tracking credential):
-- a tenant-supplied value must never collide with, or be usable as,
-- another tenant's tracking code. externalSource records which system
-- it came from. Both nullable — every existing parcel has neither.
--
-- parcel_agent.managerStaffId names the parcel_org_staff member who runs
-- a station, so a station has an accountable owner inside the company's
-- own roster without a second identity.
ALTER TABLE "parcel"
  ADD COLUMN "externalRef"    TEXT,
  ADD COLUMN "externalSource" TEXT;

CREATE INDEX "parcel_parcelOrgId_externalRef_idx" ON "parcel"("parcelOrgId", "externalRef");

ALTER TABLE "parcel_agent"
  ADD COLUMN "managerStaffId" UUID;
