-- Receiver-side "I got it" confirmation — OTP-gated (no Esoko account
-- required), only reachable once a courier has marked the parcel
-- DELIVERED. See dbx.ConfirmParcelReceipt.

-- AlterTable
ALTER TABLE "parcel"
    ADD COLUMN "receiptConfirmedAt" TIMESTAMP(3),
    ADD COLUMN "receiptConditionRating" INTEGER,
    ADD COLUMN "receiptFeedback" TEXT;
