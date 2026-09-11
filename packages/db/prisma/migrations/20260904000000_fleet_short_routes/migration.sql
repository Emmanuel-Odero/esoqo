-- Transport fleet / short routes: org-scoped tables for town/matatu hops.
-- Go (services/core-go) is the sole writer; Prisma holds DDL only.

-- CreateEnum
CREATE TYPE "FleetVehicleStatus" AS ENUM ('ACTIVE', 'GROUNDED');
CREATE TYPE "CrewRole" AS ENUM ('DRIVER', 'CONDUCTOR');
CREATE TYPE "TripStatus" AS ENUM ('ACTIVE', 'CLOSED');
CREATE TYPE "FarePaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "fleet_vehicle" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "plateNo" TEXT NOT NULL,
    "capacity" INTEGER,
    "label" TEXT,
    "status" "FleetVehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fleet_vehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crew_member" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "msisdn" TEXT,
    "role" "CrewRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crew_member_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "short_route" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "short_route_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fare_stage" (
    "id" UUID NOT NULL,
    "shortRouteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "fareKes" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "fare_stage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trip" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID,
    "conductorId" UUID,
    "shortRouteId" UUID,
    "status" "TripStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicle_ping" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_ping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fare_payment" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "stageFromId" UUID,
    "stageToId" UUID,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "buyerMsisdn" TEXT,
    "status" "FarePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "mpesaCheckoutRequestId" TEXT,
    "mpesaReceiptCode" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    CONSTRAINT "fare_payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collection_declaration" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "crewId" UUID NOT NULL,
    "declaredCashKes" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collection_declaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fleet_vehicle_orgId_plateNo_key" ON "fleet_vehicle"("orgId", "plateNo");
CREATE INDEX "fleet_vehicle_orgId_status_idx" ON "fleet_vehicle"("orgId", "status");
CREATE INDEX "crew_member_orgId_role_active_idx" ON "crew_member"("orgId", "role", "active");
CREATE INDEX "short_route_orgId_active_idx" ON "short_route"("orgId", "active");
CREATE UNIQUE INDEX "fare_stage_shortRouteId_order_key" ON "fare_stage"("shortRouteId", "order");
CREATE INDEX "fare_stage_shortRouteId_idx" ON "fare_stage"("shortRouteId");
CREATE INDEX "trip_orgId_status_idx" ON "trip"("orgId", "status");
CREATE INDEX "trip_vehicleId_status_idx" ON "trip"("vehicleId", "status");
CREATE INDEX "vehicle_ping_tripId_at_idx" ON "vehicle_ping"("tripId", "at");
CREATE INDEX "fare_payment_tripId_status_idx" ON "fare_payment"("tripId", "status");
CREATE UNIQUE INDEX "fare_payment_mpesaCheckoutRequestId_key" ON "fare_payment"("mpesaCheckoutRequestId");
CREATE UNIQUE INDEX "fare_payment_journalEntryId_key" ON "fare_payment"("journalEntryId");
CREATE INDEX "collection_declaration_tripId_idx" ON "collection_declaration"("tripId");
CREATE INDEX "collection_declaration_crewId_idx" ON "collection_declaration"("crewId");

-- AddForeignKey
ALTER TABLE "fleet_vehicle" ADD CONSTRAINT "fleet_vehicle_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_member" ADD CONSTRAINT "crew_member_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "short_route" ADD CONSTRAINT "short_route_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fare_stage" ADD CONSTRAINT "fare_stage_shortRouteId_fkey" FOREIGN KEY ("shortRouteId") REFERENCES "short_route"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip" ADD CONSTRAINT "trip_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip" ADD CONSTRAINT "trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "fleet_vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip" ADD CONSTRAINT "trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "crew_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trip" ADD CONSTRAINT "trip_conductorId_fkey" FOREIGN KEY ("conductorId") REFERENCES "crew_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trip" ADD CONSTRAINT "trip_shortRouteId_fkey" FOREIGN KEY ("shortRouteId") REFERENCES "short_route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_ping" ADD CONSTRAINT "vehicle_ping_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fare_payment" ADD CONSTRAINT "fare_payment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fare_payment" ADD CONSTRAINT "fare_payment_stageFromId_fkey" FOREIGN KEY ("stageFromId") REFERENCES "fare_stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fare_payment" ADD CONSTRAINT "fare_payment_stageToId_fkey" FOREIGN KEY ("stageToId") REFERENCES "fare_stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fare_payment" ADD CONSTRAINT "fare_payment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collection_declaration" ADD CONSTRAINT "collection_declaration_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_declaration" ADD CONSTRAINT "collection_declaration_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "crew_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
