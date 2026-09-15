-- Money-path indexes and integrity constraints.
--
-- 1. parcel."paymentCheckoutRequestId" was the only one of the nine
--    checkout-id columns without a unique index, so the STK webhook
--    sequentially scanned the whole parcel table on every callback.
-- 2. person.email is a sign-in identifier (findPersonByWhere queries
--    `pr.email = $1`) but only msisdn was indexed.
-- 3. bill_contribution."journalEntryId" had neither a uniqueness
--    constraint nor a foreign key, unlike every other money model.
-- 4. The customer credit book and loyalty ledger cascade-deleted with
--    their customer row, destroying financial history.

-- 1 ─ parcel checkout id. Guard first: a duplicate would make the
-- CREATE UNIQUE INDEX fail mid-migration, and it is better to say why.
DO $$
DECLARE dupes INT;
BEGIN
  SELECT COUNT(*) INTO dupes FROM (
    SELECT "paymentCheckoutRequestId"
    FROM "parcel"
    WHERE "paymentCheckoutRequestId" IS NOT NULL
    GROUP BY "paymentCheckoutRequestId"
    HAVING COUNT(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'Cannot add unique index: % duplicated paymentCheckoutRequestId value(s) in parcel. Resolve these before migrating.', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX "parcel_paymentCheckoutRequestId_key"
  ON "parcel" ("paymentCheckoutRequestId");

-- 2 ─ email sign-in lookup. Plain index, not unique: duplicates may
-- legitimately exist today and cleaning them up is a separate decision.
CREATE INDEX "person_email_idx" ON "person" ("email");

-- 3 ─ bill_contribution → journal_entry. Same guard as above.
DO $$
DECLARE dupes INT;
BEGIN
  SELECT COUNT(*) INTO dupes FROM (
    SELECT "journalEntryId"
    FROM "bill_contribution"
    WHERE "journalEntryId" IS NOT NULL
    GROUP BY "journalEntryId"
    HAVING COUNT(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'Cannot add unique index: % journalEntryId value(s) are shared by more than one bill_contribution — that is double-booked money and needs resolving by hand.', dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX "bill_contribution_journalEntryId_key"
  ON "bill_contribution" ("journalEntryId");

-- Orphaned references must go before the FK can be trusted. NULL means
-- "not yet settled", which is a valid state; a dangling id is not.
UPDATE "bill_contribution"
   SET "journalEntryId" = NULL
 WHERE "journalEntryId" IS NOT NULL
   AND "journalEntryId" NOT IN (SELECT id FROM "journal_entry");

ALTER TABLE "bill_contribution"
  ADD CONSTRAINT "bill_contribution_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "journal_entry"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4 ─ stop the credit book and loyalty ledger cascading away.
ALTER TABLE "customer_ledger_entry"
  DROP CONSTRAINT "customer_ledger_entry_customerId_fkey";
ALTER TABLE "customer_ledger_entry"
  ADD CONSTRAINT "customer_ledger_entry_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "store_customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loyalty_entry"
  DROP CONSTRAINT "loyalty_entry_customerId_fkey";
ALTER TABLE "loyalty_entry"
  ADD CONSTRAINT "loyalty_entry_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "store_customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
