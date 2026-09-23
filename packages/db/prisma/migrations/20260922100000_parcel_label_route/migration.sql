-- A label's operating corridor ("Nairobi -> Mombasa"), printed on the
-- route band. routeId references a company's own defined ParcelRoute
-- when one was picked; routeLabel is the snapshot actually printed
-- (that route's name, or a typed "From -> To" when no defined route
-- fit) so the label keeps showing what it printed with even if the
-- route is later renamed or deleted.
ALTER TABLE "parcel_label_stock" ADD COLUMN "routeId" UUID;
ALTER TABLE "parcel_label_stock" ADD COLUMN "routeLabel" TEXT;

ALTER TABLE "parcel_label_stock"
  ADD CONSTRAINT "parcel_label_stock_routeId_fkey"
  FOREIGN KEY ("routeId") REFERENCES "parcel_route"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
