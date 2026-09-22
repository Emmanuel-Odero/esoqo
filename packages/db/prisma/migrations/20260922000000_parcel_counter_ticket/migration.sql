-- Walk-in counter ticketing: a service ticket number minted the moment
-- a customer asks for service (kiosk / counter QR web form / the app),
-- before any parcel details exist, so a clerk's live queue has
-- something to show and claim. Kept off `parcel` on purpose — BookParcel
-- requires full sender/receiver/type data, a ticket only ever needs a
-- phone number.
--
-- The queue's live-push (SSE) side is backed by Postgres LISTEN/NOTIFY,
-- not a new table — a NOTIFY fires from the same transaction that
-- inserts/claims a row here (see dbx.CreateCounterTicket /
-- ClaimCounterTicket in Go).

CREATE TYPE "ParcelCounterTicketChannel" AS ENUM ('KIOSK', 'WEB_QR', 'APP');

CREATE TYPE "ParcelCounterTicketStatus" AS ENUM ('WAITING', 'CLAIMED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "parcel_counter_ticket" (
  "id"    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orgId" UUID NOT NULL,

  "serviceTicketNumber" TEXT NOT NULL,
  "msisdn"              TEXT NOT NULL,
  "channel"             "ParcelCounterTicketChannel" NOT NULL,
  "status"              "ParcelCounterTicketStatus" NOT NULL DEFAULT 'WAITING',

  -- Whatever the customer filled into the send-parcel form while
  -- waiting (see apps/web's SendParcelForm autosave). Free-form, never
  -- validated or read here — the clerk's intake screen prefills from
  -- it at claim time and the real validation happens at BookParcel.
  "draftDetails" JSONB,

  "claimedByStaffId" UUID,
  "claimedAt"         TIMESTAMP(3),

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "parcel_counter_ticket_serviceTicketNumber_key" UNIQUE ("serviceTicketNumber"),
  CONSTRAINT "parcel_counter_ticket_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "parcel_org"("id") ON DELETE CASCADE,
  CONSTRAINT "parcel_counter_ticket_claimedByStaffId_fkey"
    FOREIGN KEY ("claimedByStaffId") REFERENCES "parcel_org_staff"("id") ON DELETE SET NULL
);

-- The live queue is always "WAITING tickets for org X, oldest first" —
-- this index is that query.
CREATE INDEX "parcel_counter_ticket_org_status_created_idx"
  ON "parcel_counter_ticket" ("orgId", "status", "createdAt");
