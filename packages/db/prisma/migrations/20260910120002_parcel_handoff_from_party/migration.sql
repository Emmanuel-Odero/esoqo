-- parcel_handoff was write-only: rows recorded who took custody but
-- never who it came from, so the chain could only ever be inferred
-- from row order. fromPartyId is null on the very first pickup
-- (meaning "from the sender"), set otherwise to whoever held it before
-- (see dbx.ScanHandoff).

-- AlterTable
ALTER TABLE "parcel_handoff"
    ADD COLUMN "fromPartyId" UUID;
