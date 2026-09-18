-- The custody chain recorded who held a parcel and when, but not what
-- that leg was (received at counter vs picked up vs in transit). The
-- public tracking timeline can now label each leg without resolving a
-- holder's name, which is exactly the PII the guest-safe projection
-- must not carry.
--
-- toPartyId also becomes nullable: an Esoqo counter receipt has no
-- linked Party (StaffUser carries no partyId), but it is still a real
-- custody event and belongs in the chain with a NULL holder rather than
-- being dropped.
--
-- status is nullable: rows written before this migration have no status
-- to recover, and the readers fall back to a generic "custody transfer".

-- AlterTable
ALTER TABLE "parcel_handoff" ADD COLUMN "status" "ParcelStatus";

-- AlterTable
ALTER TABLE "parcel_handoff" ALTER COLUMN "toPartyId" DROP NOT NULL;
