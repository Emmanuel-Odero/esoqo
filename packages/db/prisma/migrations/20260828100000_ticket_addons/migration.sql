-- Paid ticket add-ons ("WiFi KES 100", "Snacks KES 200", "Lunch KES
-- 500") — organiser-defined per listing, buyer opts each ticket into
-- them at checkout, price snapshotted per ticket the same way
-- Ticket.priceKes already snapshots the base fare.

-- CreateTable: Addon
CREATE TABLE "addon" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceKes" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addon_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "addon_listingId_idx" ON "addon"("listingId");

ALTER TABLE "addon" ADD CONSTRAINT "addon_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: TicketAddon
CREATE TABLE "ticket_addon" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "addonId" UUID,
    "name" TEXT NOT NULL,
    "priceKes" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_addon_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_addon_ticketId_idx" ON "ticket_addon"("ticketId");

ALTER TABLE "ticket_addon" ADD CONSTRAINT "ticket_addon_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_addon" ADD CONSTRAINT "ticket_addon_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "addon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
