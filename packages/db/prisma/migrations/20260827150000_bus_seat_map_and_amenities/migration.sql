-- Ticket class perk tags + a reusable bus/coach seat-map template per
-- listing, so an organiser can lay out "2+2, 11 rows" once and paint
-- some seats into a higher-priced comfort class, instead of every
-- schedule getting plain sequential seat numbers.

-- AlterTable: TicketClass amenity tags
ALTER TABLE "ticket_class" ADD COLUMN "amenities" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ticket_class" ADD COLUMN "amenityNote" TEXT;

-- CreateTable: SeatMap
CREATE TABLE "seat_map" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "rows" INTEGER NOT NULL,
    "pattern" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seat_map_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seat_map_listingId_key" ON "seat_map"("listingId");

ALTER TABLE "seat_map" ADD CONSTRAINT "seat_map_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: SeatMapSeat
CREATE TABLE "seat_map_seat" (
    "id" UUID NOT NULL,
    "seatMapId" UUID NOT NULL,
    "ticketClassId" UUID NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "seat_map_seat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seat_map_seat_seatMapId_label_key" ON "seat_map_seat"("seatMapId", "label");
CREATE INDEX "seat_map_seat_ticketClassId_idx" ON "seat_map_seat"("ticketClassId");

ALTER TABLE "seat_map_seat" ADD CONSTRAINT "seat_map_seat_seatMapId_fkey" FOREIGN KEY ("seatMapId") REFERENCES "seat_map"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seat_map_seat" ADD CONSTRAINT "seat_map_seat_ticketClassId_fkey" FOREIGN KEY ("ticketClassId") REFERENCES "ticket_class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
