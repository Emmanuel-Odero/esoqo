-- "Lipia pole pole" — installment ticket plans. An organiser opts in
-- (installmentsEnabled); a buyer books a future general-admission trip
-- now with a deposit and clears the balance in M-Pesa top-ups before
-- departure. Tickets are issued only once the balance is fully paid.

-- AlterTable: TicketOrg — organiser opt-in + minimum deposit
ALTER TABLE "ticket_org" ADD COLUMN "installmentsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ticket_org" ADD COLUMN "minDepositPercent" INTEGER NOT NULL DEFAULT 20;

-- AlterEnum: BookingStatus — plan open, balance still owed
ALTER TYPE "BookingStatus" ADD VALUE 'PARTIALLY_PAID' BEFORE 'PAID';

-- AlterTable: Booking — installment plan state
ALTER TABLE "booking" ADD COLUMN "isInstallment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "booking" ADD COLUMN "amountPaidKes" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "booking" ADD COLUMN "balanceDueBy" TIMESTAMP(3);
ALTER TABLE "booking" ADD COLUMN "plannedLines" JSONB;

-- CreateTable: BookingPayment — one row per M-Pesa push on a plan
CREATE TABLE "booking_payment" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mpesaCheckoutRequestId" TEXT,
    "mpesaReceiptCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "booking_payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "booking_payment_mpesaCheckoutRequestId_key" ON "booking_payment"("mpesaCheckoutRequestId");
CREATE INDEX "booking_payment_bookingId_status_idx" ON "booking_payment"("bookingId", "status");

ALTER TABLE "booking_payment" ADD CONSTRAINT "booking_payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
