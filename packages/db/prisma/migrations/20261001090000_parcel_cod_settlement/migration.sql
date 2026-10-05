-- One batch of COD money paid out from the platform SETTLEMENT account
-- to a seller, with the operator who ran it (see SettleSellerCod in
-- services/core-go). Money-out with no actor is a fraud you cannot
-- begin to chase, so settledByStaffId is NOT NULL and the parcel ids in
-- the batch are frozen in an array.

-- CreateTable
CREATE TABLE "parcel_cod_settlement" (
    "id" UUID NOT NULL,
    "senderPartyId" UUID NOT NULL,
    "settledByStaffId" UUID NOT NULL,
    "paidKes" DECIMAL(12,2) NOT NULL,
    "feeKes" DECIMAL(12,2) NOT NULL,
    "parcelIds" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_cod_settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parcel_cod_settlement_senderPartyId_createdAt_idx"
  ON "parcel_cod_settlement" ("senderPartyId", "createdAt");