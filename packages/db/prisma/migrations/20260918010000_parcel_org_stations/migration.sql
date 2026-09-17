-- Courier-company-owned pickup stations and station-scoped staff.
ALTER TABLE "parcel_agent"
    ADD COLUMN "parcelOrgId" UUID;

ALTER TABLE "parcel_agent"
    ADD CONSTRAINT "parcel_agent_parcelOrgId_fkey"
    FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "parcel_org_staff"
    ADD COLUMN "stationId" UUID;

ALTER TABLE "parcel_org_staff"
    ADD CONSTRAINT "parcel_org_staff_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "parcel_agent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "parcel_agent_parcelOrgId_idx" ON "parcel_agent"("parcelOrgId");
CREATE INDEX "parcel_org_staff_stationId_idx" ON "parcel_org_staff"("stationId");