-- A shipment (a vehicle run carrying a manifest of parcels) had no
-- owner. That was workable while the only caller was Esoqo's own ops
-- console, and it is why the courier portal's own shipment actions
-- pointed at /v1/parcel-orgs/me/shipments/... — a route that was never
-- registered, because there was no way to scope a shipment to one
-- company's parcels.
--
-- Nullable on purpose: existing rows are Esoqo-operated runs and stay
-- that way (NULL = "Esoqo ops", the same convention parcel."parcelOrgId"
-- already uses for an Esoqo-operated parcel). The org-scoped reads add
-- the predicate themselves, so an unowned shipment is invisible to
-- every company rather than visible to all of them.
ALTER TABLE "parcel_shipment" ADD COLUMN "parcelOrgId" UUID;

ALTER TABLE "parcel_shipment"
  ADD CONSTRAINT "parcel_shipment_parcelOrgId_fkey"
  FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id") ON DELETE SET NULL;

-- The counter's hot path: "which of my runs are still loading, for this
-- destination". Partial on OPEN because that is the only status the
-- loading picker ever asks for, and closed runs accumulate forever.
CREATE INDEX "parcel_shipment_org_open_idx"
  ON "parcel_shipment" ("parcelOrgId", "createdAt" DESC)
  WHERE status = 'OPEN';
