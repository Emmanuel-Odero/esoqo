-- CreateEnum
CREATE TYPE "TicketVertical" AS ENUM ('EVENTS', 'TRANSPORT');

-- CreateEnum
CREATE TYPE "TicketOrgStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'BOOKED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BookingPaymentMethod" AS ENUM ('MPESA_STK', 'CASH');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('VALID', 'USED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "ticket_org" (
    "id" UUID NOT NULL,
    "enterpriseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "vertical" "TicketVertical" NOT NULL,
    "status" "TicketOrgStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "logoUrl" TEXT,
    "contactPerson" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "physicalAddress" TEXT,
    "settlementPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_org_staff" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SCANNER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_org_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "county" TEXT,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "originName" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "distanceKm" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "venueId" UUID,
    "routeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_schedule" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "departAt" TIMESTAMP(3) NOT NULL,
    "arriveAt" TIMESTAMP(3),
    "gateInfo" TEXT,
    "vehicleOrHallLabel" TEXT,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_class" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceKes" DECIMAL(12,2) NOT NULL,
    "seated" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "ticketClassId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "SeatStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "buyerPartyId" UUID,
    "buyerName" TEXT NOT NULL,
    "buyerMsisdn" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentMethod" "BookingPaymentMethod" NOT NULL DEFAULT 'MPESA_STK',
    "totalKes" DECIMAL(12,2) NOT NULL,
    "mpesaCheckoutRequestId" TEXT,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "ticketClassId" UUID NOT NULL,
    "seatId" UUID,
    "code" TEXT NOT NULL,
    "holderName" TEXT,
    "holderMsisdn" TEXT,
    "priceKes" DECIMAL(12,2) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'VALID',
    "checkedInAt" TIMESTAMP(3),
    "checkedInById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_org_slug_key" ON "ticket_org"("slug");

-- CreateIndex
CREATE INDEX "ticket_org_enterpriseId_idx" ON "ticket_org"("enterpriseId");

-- CreateIndex
CREATE INDEX "ticket_org_status_idx" ON "ticket_org"("status");

-- CreateIndex
CREATE INDEX "ticket_org_staff_orgId_idx" ON "ticket_org_staff"("orgId");

-- CreateIndex
CREATE INDEX "venue_orgId_idx" ON "venue"("orgId");

-- CreateIndex
CREATE INDEX "route_orgId_idx" ON "route"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "listing_slug_key" ON "listing"("slug");

-- CreateIndex
CREATE INDEX "listing_orgId_status_idx" ON "listing"("orgId", "status");

-- CreateIndex
CREATE INDEX "listing_schedule_listingId_departAt_idx" ON "listing_schedule"("listingId", "departAt");

-- CreateIndex
CREATE INDEX "ticket_class_listingId_idx" ON "ticket_class"("listingId");

-- CreateIndex
CREATE INDEX "seat_ticketClassId_status_idx" ON "seat"("ticketClassId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seat_scheduleId_label_key" ON "seat"("scheduleId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "booking_mpesaCheckoutRequestId_key" ON "booking"("mpesaCheckoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_journalEntryId_key" ON "booking"("journalEntryId");

-- CreateIndex
CREATE INDEX "booking_scheduleId_status_idx" ON "booking"("scheduleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_seatId_key" ON "ticket"("seatId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_code_key" ON "ticket"("code");

-- CreateIndex
CREATE INDEX "ticket_bookingId_idx" ON "ticket"("bookingId");

-- CreateIndex
CREATE INDEX "ticket_status_idx" ON "ticket"("status");

-- AddForeignKey
ALTER TABLE "ticket_org" ADD CONSTRAINT "ticket_org_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_org_staff" ADD CONSTRAINT "ticket_org_staff_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue" ADD CONSTRAINT "venue_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route" ADD CONSTRAINT "route_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing" ADD CONSTRAINT "listing_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing" ADD CONSTRAINT "listing_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing" ADD CONSTRAINT "listing_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_schedule" ADD CONSTRAINT "listing_schedule_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_class" ADD CONSTRAINT "ticket_class_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat" ADD CONSTRAINT "seat_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "listing_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat" ADD CONSTRAINT "seat_ticketClassId_fkey" FOREIGN KEY ("ticketClassId") REFERENCES "ticket_class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "listing_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_buyerPartyId_fkey" FOREIGN KEY ("buyerPartyId") REFERENCES "party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_ticketClassId_fkey" FOREIGN KEY ("ticketClassId") REFERENCES "ticket_class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "ticket_org_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
