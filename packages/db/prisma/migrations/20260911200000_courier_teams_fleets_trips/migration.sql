-- Courier teams: a manager plus a roster of members (see
-- CourierTeamMember.role), each team owning one or more fleets (a
-- physical vehicle, identified by its own fleetNumber — see
-- CourierFleet), each fleet running trips (a batch of parcels handed
-- to that vehicle, from dispatch until it's marked back and the
-- packages have arrived — see CourierTrip). Distinct from the
-- existing individual-courier role (parcel_courier, ParcelCourier) —
-- a team/fleet/trip is a dispatch-planning layer on top of that, not
-- a replacement for it; a fleet's trip doesn't require its members to
-- individually be vetted ParcelCourier rows.
CREATE TABLE "courier_team" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByStaffId" UUID,

    CONSTRAINT "courier_team_pkey" PRIMARY KEY ("id")
);

-- One row per person on a team, manager included (role = 'MANAGER') —
-- no separate managerPartyId on courier_team, so "who's the manager"
-- always comes from this same roster instead of two sources of truth.
CREATE TABLE "courier_team_member" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_team_member_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_team_member_team_party_key" ON "courier_team_member"("teamId", "partyId");

ALTER TABLE "courier_team_member" ADD CONSTRAINT "courier_team_member_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "courier_team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A team's vehicle roster — a team can run several fleets at once
-- (see this migration's own header comment).
CREATE TABLE "courier_fleet" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "fleetNumber" TEXT NOT NULL,
    "vehicleType" "ParcelTransportMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_fleet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_fleet_fleetNumber_key" ON "courier_fleet"("fleetNumber");

ALTER TABLE "courier_fleet" ADD CONSTRAINT "courier_fleet_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "courier_team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One open (IN_PROGRESS) trip per fleet at a time — assigning a parcel
-- to a fleet lands on whichever trip is currently open for it (opening
-- a fresh one if none is), and marking that trip COMPLETE is what
-- fires the "packages have arrived" SMS to the team (see
-- notify.CourierTripCompleted) and frees the fleet to start a new one.
CREATE TABLE "courier_trip" (
    "id" UUID NOT NULL,
    "fleetId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedByStaffId" UUID,

    CONSTRAINT "courier_trip_pkey" PRIMARY KEY ("id")
);

-- The hot-path lookup ("does this fleet already have an open trip?")
-- gets its own partial index rather than a full scan filtered by status.
CREATE INDEX "courier_trip_fleet_open_idx" ON "courier_trip"("fleetId") WHERE "status" = 'IN_PROGRESS';

ALTER TABLE "courier_trip" ADD CONSTRAINT "courier_trip_fleetId_fkey"
    FOREIGN KEY ("fleetId") REFERENCES "courier_fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A parcel's fleet-trip assignment — nullable and independent of
-- assignedCollectorPartyId (an individual courier's own pickup
-- scheduling, unrelated dispatch-planning layer): a parcel can be on a
-- fleet's trip with or without a specific collector assigned to it.
ALTER TABLE "parcel" ADD COLUMN "courierTripId" UUID;

ALTER TABLE "parcel" ADD CONSTRAINT "parcel_courierTripId_fkey"
    FOREIGN KEY ("courierTripId") REFERENCES "courier_trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "parcel_courierTripId_idx" ON "parcel"("courierTripId");
