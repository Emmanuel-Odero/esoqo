-- A courier company (ParcelOrg) that also runs passenger buses. Its
-- own small vocabulary (Bus/BusRoute/BusSchedule/BusTrip/BusBooking)
-- rather than reusing the TicketOrg/Listing/Seat machinery: this is a
-- second product line on a company the ParcelOrg tenant already is,
-- not a second merchant identity.

-- AlterTable
ALTER TABLE "parcel_org" ADD COLUMN "offersTransport" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "parcel_org_offersTransport_idx" ON "parcel_org"("offersTransport");

-- CreateEnum
CREATE TYPE "BusStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "BusTripStatus" AS ENUM ('SCHEDULED', 'DEPARTED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "BusBookingStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED', 'REFUNDED');
CREATE TYPE "BusBookingChannel" AS ENUM ('WEB', 'COUNTER');
CREATE TYPE "BusBookingPaymentMethod" AS ENUM ('MPESA_STK', 'CASH');

-- CreateTable: one physical vehicle on a transport-enabled company's fleet.
CREATE TABLE "bus" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "parcelOrgId" UUID NOT NULL REFERENCES "parcel_org"("id") ON DELETE CASCADE,

  "name" TEXT NOT NULL,
  "plateNumber" TEXT NOT NULL,
  "totalSeats" INTEGER NOT NULL,
  "seatLayout" TEXT,
  "amenities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "BusStatus" NOT NULL DEFAULT 'ACTIVE',

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bus_org_plate_key" ON "bus"("parcelOrgId", "plateNumber");
CREATE INDEX "bus_org_status_idx" ON "bus"("parcelOrgId", "status");

-- CreateTable: origin -> destination, one route backs many schedules.
CREATE TABLE "bus_route" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "parcelOrgId" UUID NOT NULL REFERENCES "parcel_org"("id") ON DELETE CASCADE,

  "originName" TEXT NOT NULL,
  "destinationName" TEXT NOT NULL,
  "distanceKm" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bus_route_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bus_route_org_idx" ON "bus_route"("parcelOrgId", "active");

-- CreateTable: the recurring template a manager configures in settings
-- (this bus, this route, this time, these days, this price). Concrete
-- bookable bus_trip rows are generated from this.
CREATE TABLE "bus_schedule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "parcelOrgId" UUID NOT NULL REFERENCES "parcel_org"("id") ON DELETE CASCADE,
  "busId" UUID NOT NULL REFERENCES "bus"("id") ON DELETE CASCADE,
  "routeId" UUID NOT NULL REFERENCES "bus_route"("id") ON DELETE CASCADE,

  "departTime" TEXT NOT NULL,
  "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::INTEGER[],
  "priceKes" DECIMAL(12,2) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bus_schedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bus_schedule_org_idx" ON "bus_schedule"("parcelOrgId", "active");

-- CreateTable: one concrete, bookable departure. priceKes/seatsTotal
-- are snapshotted off the schedule/bus at generation time so a later
-- edit never rewrites a trip buyers already hold seats on.
CREATE TABLE "bus_trip" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "parcelOrgId" UUID NOT NULL REFERENCES "parcel_org"("id") ON DELETE CASCADE,
  "scheduleId" UUID REFERENCES "bus_schedule"("id"),
  "busId" UUID NOT NULL REFERENCES "bus"("id"),
  "routeId" UUID NOT NULL REFERENCES "bus_route"("id"),

  "departAt" TIMESTAMP(3) NOT NULL,
  "priceKes" DECIMAL(12,2) NOT NULL,
  "seatsTotal" INTEGER NOT NULL,
  "status" "BusTripStatus" NOT NULL DEFAULT 'SCHEDULED',

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bus_trip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bus_trip_bus_depart_key" ON "bus_trip"("busId", "departAt");
CREATE INDEX "bus_trip_org_depart_idx" ON "bus_trip"("parcelOrgId", "departAt");
CREATE INDEX "bus_trip_route_depart_idx" ON "bus_trip"("routeId", "departAt");

-- CreateTable: one booked seat on one trip. The buyer need not be a
-- registered Esoqo subject; seat double-booking is guarded in the
-- transaction that inserts this row, not a DB constraint, because a
-- cancelled booking must free its seat for resale.
CREATE TABLE "bus_booking" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tripId" UUID NOT NULL REFERENCES "bus_trip"("id") ON DELETE CASCADE,

  "seatNumber" INTEGER NOT NULL,

  "passengerName" TEXT NOT NULL,
  "passengerMsisdn" TEXT NOT NULL,
  "passengerIdNumber" TEXT,

  "code" TEXT NOT NULL,
  "status" "BusBookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "paymentMethod" "BusBookingPaymentMethod" NOT NULL DEFAULT 'MPESA_STK',
  "channel" "BusBookingChannel" NOT NULL DEFAULT 'WEB',
  "priceKes" DECIMAL(12,2) NOT NULL,

  "mpesaCheckoutRequestId" TEXT,
  "createdByStaffId" UUID,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),

  CONSTRAINT "bus_booking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bus_booking_code_key" ON "bus_booking"("code");
CREATE UNIQUE INDEX "bus_booking_mpesaCheckoutRequestId_key" ON "bus_booking"("mpesaCheckoutRequestId");
CREATE INDEX "bus_booking_trip_seat_idx" ON "bus_booking"("tripId", "seatNumber");
CREATE INDEX "bus_booking_trip_status_idx" ON "bus_booking"("tripId", "status");
