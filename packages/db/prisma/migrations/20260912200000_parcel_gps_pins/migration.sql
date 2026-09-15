-- A dropped pin for each end of a parcel's journey.
--
-- Roughly four in five Kenyans have no formal street address, and
-- addressing failure is the single largest cause of delivery failure in
-- this market — the Courier Industry Association's own figures put
-- wrong or missing addresses behind the bulk of both undelivered and
-- delayed parcels.
--
-- originLabel/destinationLabel stay exactly as they are: prose a human
-- reads and navigates by ("opposite Sarit"). These columns are the
-- thing a courier's maps app can route to. They are also deliberately
-- independent of the zone columns, which snap to an admin-curated hub
-- for *pricing* — a pin is where the parcel is really going, to seven
-- decimal places.
--
-- Everything degrades honestly: pin, then zone, then free text.

ALTER TABLE "parcel"
    ADD COLUMN "originLat" DECIMAL(10,7),
    ADD COLUMN "originLng" DECIMAL(10,7),
    ADD COLUMN "destinationLat" DECIMAL(10,7),
    ADD COLUMN "destinationLng" DECIMAL(10,7);
