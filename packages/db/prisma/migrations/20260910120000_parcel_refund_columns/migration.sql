-- Tracks whether a cancelled, M-Pesa-paid parcel's refund has actually
-- been processed — previously computed once at cancel time and only
-- ever mentioned in an SMS, then forgotten (see dbx.CancelParcel).

-- AlterTable
ALTER TABLE "parcel"
    ADD COLUMN "refundStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    ADD COLUMN "refundedAt" TIMESTAMP(3),
    ADD COLUMN "refundedByStaffId" UUID;
