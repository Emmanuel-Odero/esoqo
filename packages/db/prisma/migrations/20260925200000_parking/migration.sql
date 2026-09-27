-- Parking: lots, sessions, and the ticket a driver carries out.
--
-- Two tables and one added column. There is deliberately no third money
-- table, no PARKING_REVENUE account, and no parking-specific STK or
-- callback path — a parking charge is an ordinary BusinessPayment to the
-- organisation that runs the lot, which already has an Esoqo Payment ID
-- and a revenue account. What makes it a parking payment is that a
-- machine quoted the figure before the payer authorised it, and the
-- session needs to be able to check that the payment which arrived is
-- the payment it asked for. That single link is the whole of the
-- integration.
--
-- Deliberate constraints, all load-bearing:
--   · parking_lot.code is unique and is what the printed QR encodes.
--     The lot is a PLACE, not a payee, so it has no Esoqo Payment ID of
--     its own; money belongs to partyId and the code is only ever a
--     doorbell.
--   · parking_session.ticketCode is unique, and is the ONLY credential
--     at checkout — the same "the id is the bearer token" convention a
--     parcel tracking code already follows. No account, no staff login.
--   · The rate, grace and daily cap are COPIED onto the session at
--     check-in. Raising a tariff must never change what a car already
--     parked under, or the quote at checkout is not a quote.
--   · A session holds no money. The amount lives on the BusinessPayment
--     that settles it, so "this session is PAID" and "the ledger has
--     the entry" cannot disagree.
--   · status PAID is reached only by confirming the payment, never set
--     directly, so it cannot be reached without the ledger.

-- CreateEnum
CREATE TYPE "ParkingSessionStatus" AS ENUM ('OPEN', 'QUOTED', 'PAID', 'VOIDED');

-- CreateTable
CREATE TABLE "parking_lot" (
    "id" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "county" TEXT,
    "address" TEXT,
    "ratePerHourKes" INTEGER NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxPerDayKes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parking_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_session" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "ticketCode" TEXT NOT NULL,
    "plateNo" TEXT,
    "msisdn" TEXT NOT NULL,
    "status" "ParkingSessionStatus" NOT NULL DEFAULT 'OPEN',
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedOutAt" TIMESTAMP(3),
    "quotedAt" TIMESTAMP(3),
    "ratePerHourKes" INTEGER NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxPerDayKes" INTEGER,
    "billedMinutes" INTEGER,
    "amountKes" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parking_session_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "business_payment" ADD COLUMN "parkingSessionId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "parking_lot_code_key" ON "parking_lot"("code");

-- CreateIndex
CREATE INDEX "parking_lot_partyId_idx" ON "parking_lot"("partyId");

-- CreateIndex
CREATE INDEX "parking_lot_active_idx" ON "parking_lot"("active");

-- CreateIndex
CREATE UNIQUE INDEX "parking_session_ticketCode_key" ON "parking_session"("ticketCode");

-- CreateIndex
CREATE INDEX "parking_session_lotId_status_idx" ON "parking_session"("lotId", "status");

-- CreateIndex
CREATE INDEX "parking_session_lotId_checkedInAt_idx" ON "parking_session"("lotId", "checkedInAt");

-- CreateIndex
CREATE INDEX "parking_session_msisdn_status_idx" ON "parking_session"("msisdn", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_payment_parkingSessionId_key" ON "business_payment"("parkingSessionId");

-- AddForeignKey
ALTER TABLE "parking_lot" ADD CONSTRAINT "parking_lot_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_session" ADD CONSTRAINT "parking_session_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "parking_lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_payment" ADD CONSTRAINT "business_payment_parkingSessionId_fkey" FOREIGN KEY ("parkingSessionId") REFERENCES "parking_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
