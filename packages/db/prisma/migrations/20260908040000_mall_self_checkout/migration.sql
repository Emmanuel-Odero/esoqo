-- Mall/supermarket self-checkout: a basket built from scanned shelf
-- barcodes, paid at the door — reuses the existing pickupCode
-- mechanism (see ConfirmStoreOrderPaymentByCheckoutID) rather than a
-- new code space, gated by this new flag instead of a PICKUP
-- FulfilmentOption. Go (services/core-go) is the sole writer; Prisma
-- holds DDL only.

-- AlterTable
ALTER TABLE "store_order" ADD COLUMN "isSelfCheckout" BOOLEAN NOT NULL DEFAULT false;
