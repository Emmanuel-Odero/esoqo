-- Cancellation is an admin action (see dbx.CancelParcel) — records who
-- cancelled it, when, and why, same "append the fact, keep the row"
-- shape everything else in this table already follows.

-- AlterTable
ALTER TABLE "parcel"
    ADD COLUMN "cancelledAt" TIMESTAMP(3),
    ADD COLUMN "cancellationReason" TEXT,
    ADD COLUMN "cancelledByStaffId" UUID;
