-- Lets a clerk discard a counter ticket — a sender who never showed,
-- or walked away mid-service. See dbx.CancelCounterTicket. CANCELLED
-- already existed in ParcelCounterTicketStatus and apps/web's own
-- status copy was already written for it; nothing ever reached it
-- until now.

ALTER TABLE "parcel_counter_ticket"
    ADD COLUMN "cancelledByStaffId" UUID,
    ADD COLUMN "cancelledAt" TIMESTAMP(3),
    ADD COLUMN "cancelReason" TEXT;

ALTER TABLE "parcel_counter_ticket"
    ADD CONSTRAINT "parcel_counter_ticket_cancelledByStaffId_fkey"
    FOREIGN KEY ("cancelledByStaffId") REFERENCES "parcel_org_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
