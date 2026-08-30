-- Guest ticket checkout + a ticketing-scoped loyalty pool, mirroring
-- Store's loyaltyEnabled/loyaltyPerKes + StoreCustomer/LoyaltyEntry
-- pattern. Kept as new tables rather than reusing StoreCustomer/
-- LoyaltyEntry because those are Store-scoped (required storeId FK)
-- and a TicketOrg is not a Store.

-- AlterTable: TicketOrg loyalty toggle
ALTER TABLE "ticket_org" ADD COLUMN "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ticket_org" ADD COLUMN "loyaltyPerKes" INTEGER NOT NULL DEFAULT 1;

-- CreateTable: TicketCustomer
CREATE TABLE "ticket_customer" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "msisdn" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_customer_orgId_msisdn_key" ON "ticket_customer"("orgId", "msisdn");
CREATE INDEX "ticket_customer_orgId_name_idx" ON "ticket_customer"("orgId", "name");

ALTER TABLE "ticket_customer" ADD CONSTRAINT "ticket_customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: TicketLoyaltyEntry
CREATE TABLE "ticket_loyalty_entry" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "bookingId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_loyalty_entry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_loyalty_entry_customerId_createdAt_idx" ON "ticket_loyalty_entry"("customerId", "createdAt");

ALTER TABLE "ticket_loyalty_entry" ADD CONSTRAINT "ticket_loyalty_entry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ticket_customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_loyalty_entry" ADD CONSTRAINT "ticket_loyalty_entry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Booking guest email + loyalty identity link
ALTER TABLE "booking" ADD COLUMN "buyerEmail" TEXT;
ALTER TABLE "booking" ADD COLUMN "ticketCustomerId" UUID;

ALTER TABLE "booking" ADD CONSTRAINT "booking_ticketCustomerId_fkey" FOREIGN KEY ("ticketCustomerId") REFERENCES "ticket_customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
