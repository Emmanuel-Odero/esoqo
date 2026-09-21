-- Passenger luggage: one tag, one bag, one trip.
--
-- Deliberately its own table rather than a flag on "parcel", even
-- though the two share pads (parcel_label_stock), code minting
-- (fleetqr) and the universal scanner. A parcel's receiver is a third
-- party at the far end; a bag's is the person who handed it over. A
-- parcel's custody is a chain across couriers and legs; a bag's is a
-- bracket on one vehicle. A parcel has a price, an SLA and a delivery
-- code; a bag rides with the ticket and is claimed with a paper stub.
-- Routing bags through "parcel" would mean a filter on every parcel
-- query and an exception to every parcel invariant, forever, to save
-- this one file.
--
-- Status and claim method are native ENUMs, following ParcelStatus and
-- TripEndStatus rather than parcel_dispatch."status"'s TEXT. Both
-- conventions exist in this schema; an enum is right here because both
-- sets are genuinely closed — a bag is in one of four places, and it
-- was handed back in one of four ways — and because UNCLAIMED and
-- OVERRIDE are states a report has to be able to trust the spelling of.

CREATE TYPE "LuggageStatus" AS ENUM ('TAGGED', 'ABOARD', 'CLAIMED', 'UNCLAIMED');
CREATE TYPE "LuggageClaimMethod" AS ENUM ('STUB_SCAN', 'CODE_TYPED', 'TICKET_MATCH', 'OVERRIDE');

CREATE TABLE "luggage_tag" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- LUG- + 6 random chars + a checksum char. Checksummed because this
  -- code is read aloud off a paper stub and typed by hand far more
  -- often than a parcel code is.
  "code" TEXT NOT NULL,

  -- Required, unlike parcel."tripId". A bag with no trip is not
  -- something this system can help with.
  "tripId" UUID NOT NULL REFERENCES "trip"("id") ON DELETE CASCADE,
  "orgId" UUID NOT NULL REFERENCES "ticket_org"("id") ON DELETE CASCADE,

  -- Optional: plenty of passengers board and pay cash. A luggage system
  -- that refuses them is one the crew stops using by lunchtime.
  "ticketId" UUID REFERENCES "ticket"("id") ON DELETE SET NULL,

  "passengerName" TEXT NOT NULL,
  "passengerMsisdn" TEXT,

  -- "2 of 3". What makes a missing bag visible at the moment of
  -- claiming rather than three hours later on a phone call.
  "pieceNo" INTEGER NOT NULL DEFAULT 1,
  "pieceCount" INTEGER NOT NULL DEFAULT 1,
  -- Set on every piece of a multi-piece group, including the first, so
  -- "the others in this group" is one indexed lookup.
  "groupId" UUID,

  "dropStageId" UUID REFERENCES "fare_stage"("id") ON DELETE SET NULL,
  -- Copied at tagging, not read live off the stage: the tag is already
  -- physically on the bag, and renaming a stage later must not make the
  -- printed word disagree with the record.
  "destinationLabel" TEXT NOT NULL,

  -- Only when an excess-weight fee actually applies. This is not a rate
  -- card and must not grow into one.
  "weightKg" DECIMAL(6, 2),
  "excessFeeKes" DECIMAL(10, 2),

  "photoUrl" TEXT,

  "status" "LuggageStatus" NOT NULL DEFAULT 'TAGGED',

  "boardedAt" TIMESTAMPTZ,
  "boardedByCrewId" UUID REFERENCES "crew_member"("id") ON DELETE SET NULL,

  "claimedAt" TIMESTAMPTZ,
  "claimedByCrewId" UUID REFERENCES "crew_member"("id") ON DELETE SET NULL,
  "claimMethod" "LuggageClaimMethod",
  "claimOverrideReason" TEXT,

  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A piece number outside its own count is a data-entry bug that would
  -- make "2 of 1" printable. Caught here rather than trusted to the one
  -- caller that happens to validate it today.
  CONSTRAINT "luggage_tag_piece_range_check"
    CHECK ("pieceNo" >= 1 AND "pieceCount" >= 1 AND "pieceNo" <= "pieceCount"),

  -- An override with no reason is precisely the record this column
  -- exists to make impossible to write silently. Enforced in the
  -- database, not only in dbx.ClaimLuggage, because a release with no
  -- stub and no explanation is the one event a future second caller
  -- must not be able to reintroduce by accident.
  CONSTRAINT "luggage_tag_override_needs_reason_check"
    CHECK ("claimMethod" IS DISTINCT FROM 'OVERRIDE'
           OR nullif(btrim("claimOverrideReason"), '') IS NOT NULL)
);

-- Index names follow Prisma's own convention (<table>_<cols>_idx) rather
-- than the shorter hand-written names used elsewhere in this directory.
-- Those older tables now each show up as permanent noise in
-- `prisma migrate diff`; there is no reason to add one more.
CREATE UNIQUE INDEX "luggage_tag_code_key" ON "luggage_tag"("code");
-- The boarding scan's hot path, the close-out sweep, and the claim
-- screen's "is anything else from this group still aboard" all read
-- (trip, status).
CREATE INDEX "luggage_tag_tripId_status_idx" ON "luggage_tag"("tripId", "status");
CREATE INDEX "luggage_tag_orgId_createdAt_idx" ON "luggage_tag"("orgId", "createdAt");
CREATE INDEX "luggage_tag_groupId_idx" ON "luggage_tag"("groupId");
CREATE INDEX "luggage_tag_ticketId_idx" ON "luggage_tag"("ticketId");
