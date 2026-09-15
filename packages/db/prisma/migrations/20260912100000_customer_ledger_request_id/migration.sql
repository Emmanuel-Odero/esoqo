-- Double-submit protection for the credit book.
--
-- recordCustomerPayment / adjustCustomerBalance / redeemLoyalty had no
-- de-duplication: a double-clicked "record payment" created a second
-- CustomerLedgerEntry and a second postStoreSale settlement, crediting
-- the merchant twice for one payment. The idempotencyKey passed to
-- postStoreSale was the new entry's own id, so it was different on every
-- press and never collided.
--
-- requestId is one token per user intent, supplied by the caller. The
-- unique index is the enforcement: two inserts carrying the same token
-- cannot both land. Postgres treats NULLs as distinct in a unique index,
-- so existing rows and internal callers that pass nothing are
-- unaffected — which is also why this matches Prisma's @@unique exactly
-- rather than being a partial index (that would read as schema drift).

ALTER TABLE "customer_ledger_entry" ADD COLUMN "requestId" UUID;

CREATE UNIQUE INDEX "customer_ledger_entry_requestId_key"
  ON "customer_ledger_entry" ("requestId");

-- Same guard for point redemptions, which write to their own table.
ALTER TABLE "loyalty_entry" ADD COLUMN "requestId" UUID;

CREATE UNIQUE INDEX "loyalty_entry_requestId_key"
  ON "loyalty_entry" ("requestId");
