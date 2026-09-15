-- Moves ticketing and fleet balances out of SUSPENSE and into the
-- TICKET_REVENUE / FARE_REVENUE accounts added by the previous
-- migration.
--
-- WHY A RECLASSIFICATION ENTRY AND NOT AN UPDATE
--
-- JournalEntry/Posting are declared immutable in schema.prisma
-- ("Immutable. Balanced. Never updated, never deleted."). Repointing
-- historical postings with UPDATE posting SET "accountId" = ... would be
-- faster and would leave no trace — which is exactly why it is the wrong
-- tool. Restating history silently is the one thing a ledger must never
-- do. So this does what an accountant does: posts a new balanced entry
-- per party that debits SUSPENSE to zero and credits the correct
-- account, leaving the original entries untouched and the move itself
-- auditable.
--
-- SPLITTING A SHARED SUSPENSE ACCOUNT
--
-- A SUSPENSE account is keyed on (partyId, kind, currency), so one SACCO
-- that both sells scheduled tickets and runs stage fares has a single
-- account holding both. The split is driven by journal_entry.reference,
-- which core-go writes as 'booking:<id>' for ticketing
-- (dbx.ConfirmBookingPaymentByCheckoutID) and 'fare:<id>' for fleet
-- (dbx.postFareLedgerEntry). Those prefixes are what makes the two
-- streams separable after the fact.
--
-- Balances that reached SUSPENSE from any other source are deliberately
-- left where they are: unclassified is what a suspense account is for.
--
-- Idempotent: re-running inserts nothing, guarded by the unique
-- reference/idempotencyKey on journal_entry plus the NOT EXISTS in
-- step 3.

-- Per-party, per-stream balances currently sitting in SUSPENSE.
-- Balance is negative here: these are credits (Esoko owes the operator),
-- and the schema's convention is positive = debit, negative = credit.
CREATE TEMP TABLE reclass_work AS
SELECT
  a.id        AS suspense_account_id,
  a."partyId" AS party_id,
  a.currency  AS currency,
  (CASE WHEN je.reference LIKE 'booking:%' THEN 'TICKET_REVENUE'
        ELSE 'FARE_REVENUE' END)::"AccountKind" AS target_kind,
  SUM(p.amount) AS balance
FROM account a
JOIN posting p        ON p."accountId" = a.id
JOIN journal_entry je ON je.id = p."entryId"
WHERE a.kind = 'SUSPENSE'
  AND a."partyId" IS NOT NULL
  AND (je.reference LIKE 'booking:%' OR je.reference LIKE 'fare:%')
GROUP BY
  a.id, a."partyId", a.currency,
  (CASE WHEN je.reference LIKE 'booking:%' THEN 'TICKET_REVENUE'
        ELSE 'FARE_REVENUE' END)
HAVING SUM(p.amount) <> 0;

-- 1. The destination accounts. ON CONFLICT covers a party that already
--    has one, so this migration does not care whether it runs before or
--    after the core-go change that starts writing to them.
INSERT INTO account (id, "partyId", kind, currency, "openedAt")
SELECT gen_random_uuid(), party_id, target_kind, currency, now()
FROM reclass_work
ON CONFLICT ("partyId", kind, currency) DO NOTHING;

-- 2. One reclassification entry per (party, stream).
INSERT INTO journal_entry (id, reference, description, "occurredAt", "recordedAt", "idempotencyKey")
SELECT
  gen_random_uuid(),
  'suspense-reclass:' || target_kind || ':' || party_id,
  'Reclassify SUSPENSE balance to ' || target_kind,
  now(), now(),
  'migration:20260913000100:' || target_kind || ':' || party_id
FROM reclass_work
ON CONFLICT (reference) DO NOTHING;

-- 3. Both legs. Debit SUSPENSE by the negation of its balance (taking it
--    to zero for this stream), credit the destination by the same
--    amount. Sums to zero by construction.
INSERT INTO posting (id, "entryId", "accountId", amount, currency)
SELECT gen_random_uuid(), je.id, leg.account_id, leg.amount, leg.currency
FROM reclass_work r
JOIN journal_entry je
  ON je.reference = 'suspense-reclass:' || r.target_kind || ':' || r.party_id
CROSS JOIN LATERAL (
  VALUES
    (r.suspense_account_id, -r.balance, r.currency),
    ((SELECT id FROM account
        WHERE "partyId" = r.party_id
          AND kind     = r.target_kind
          AND currency = r.currency), r.balance, r.currency)
) AS leg(account_id, amount, currency)
WHERE NOT EXISTS (
  SELECT 1 FROM posting p2 WHERE p2."entryId" = je.id
);

DROP TABLE reclass_work;

-- 4. Fail the migration rather than commit an unbalanced ledger. Every
--    entry written here must sum to exactly zero; a half-applied
--    reclassification is worse than none.
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT COUNT(*) INTO bad
  FROM (
    SELECT p."entryId"
    FROM posting p
    JOIN journal_entry je ON je.id = p."entryId"
    WHERE je.reference LIKE 'suspense-reclass:%'
    GROUP BY p."entryId"
    HAVING SUM(p.amount) <> 0
  ) unbalanced;

  IF bad > 0 THEN
    RAISE EXCEPTION 'reclassification produced % unbalanced journal entries', bad;
  END IF;
END $$;
