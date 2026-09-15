-- A pool of pre-minted PKG-… codes that exist *before* any booking —
-- printed and stuck onto an envelope/box ahead of time, then "filled
-- in" (bound to a real sender/receiver/route) the moment a shipment
-- actually needs one, instead of every physical label being printed
-- fresh at booking time. Deliberately its own table, not a nullable
-- half of `parcel` — a blank label has none of parcel's required
-- fields (sender, receiver, route, type) and never goes through parcel's
-- own status lifecycle; it's either unused or spent, nothing else.
CREATE TABLE "parcel_label_stock" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByStaffId" UUID,
    "usedAt" TIMESTAMP(3),
    "usedByParcelId" UUID,

    CONSTRAINT "parcel_label_stock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parcel_label_stock_code_key" ON "parcel_label_stock"("code");

-- Printing a fresh batch means "give me the unused ones" — this is
-- the hot path, so it gets its own partial index rather than relying
-- on a full-table scan filtered by usedAt IS NULL.
CREATE INDEX "parcel_label_stock_unused_idx" ON "parcel_label_stock"("createdAt") WHERE "usedAt" IS NULL;

ALTER TABLE "parcel_label_stock" ADD CONSTRAINT "parcel_label_stock_usedByParcelId_fkey"
    FOREIGN KEY ("usedByParcelId") REFERENCES "parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
