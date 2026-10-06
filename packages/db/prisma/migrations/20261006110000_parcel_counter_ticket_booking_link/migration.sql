-- Links a counter ticket to the real parcel it eventually becomes —
-- the missing piece that left a claimed ticket's "receive" step with
-- nothing to receive: CreateCounterTicket/ClaimCounterTicket never
-- created a parcel row, so a ticket's own TCK-… number never resolved
-- to anything ScanHandoff could find. See dbx.BookParcelFromCounterTicket.

ALTER TABLE "parcel_counter_ticket"
    ADD COLUMN "parcelId" UUID,
    ADD COLUMN "bookingStartedAt" TIMESTAMP(3);

ALTER TABLE "parcel_counter_ticket"
    ADD CONSTRAINT "parcel_counter_ticket_parcelId_fkey"
    FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
