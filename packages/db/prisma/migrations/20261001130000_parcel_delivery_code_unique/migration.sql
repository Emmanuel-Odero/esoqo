-- Make delivery codes unique, and re-issue the duplicates that block it.
--
-- dbx.generateUniqueDeliveryCode already re-rolls against the database, so
-- new collisions are avoided. Nothing stopped the *existing* rows from
-- colliding, and the showcase seed produces them systematically: the same
-- template is seeded twice under two code prefixes (PKG-DEMO-* and
-- PKG-ESHIP-*) while the delivery code is copied verbatim from the
-- template. Every parcel past 101 therefore has a twin sharing its
-- delivery code. On a dev database that is cosmetic. In production it
-- means the six-digit code at the door does not identify one parcel, which
-- is the entire premise of DELIVERY_CODE as a handover credential.
--
-- The duplicate set is data-dependent, so this migration fixes what it
-- finds rather than assuming a shape. It runs in three steps:
--
--   1. Report. The SELECT below prints every colliding code and the rows
--      involved. It is the audit trail for a migration that is rewriting
--      credentials, and it runs before anything is touched.
--   2. Re-issue. For each collision, every row after the survivor is given
--      a fresh code. Rows are re-issued in place; no parcel is dropped,
--      and no parcel's status, money or history is touched.
--
--      Who survives is the part that matters, because a delivery code is a
--      credential rather than a label. On a parcel that is already closed,
--      it is a credential a receiver has physically used, and re-issuing it
--      rewrites the thing that was read at the door: the receiver's proof,
--      the courier's paperwork and any dispute about either stop matching
--      what actually happened. A code on a parcel still moving through the
--      network has no such history, so nothing is lost by rewriting it.
--
--      So the survivor is the closed parcel if there is one, and only
--      otherwise the earliest by code — deterministic rather than whatever
--      the heap hands back. "Closed" is DELIVERED and RETURNED_TO_SENDER:
--      the two states where a receiver (or the sender, collecting a
--      return) has already presented the code. FAILED_DELIVERY is
--      deliberately not in that set — it is not terminal, the parcel is
--      still out there, and a further attempt against a code nobody has
--      successfully used is exactly the case where a fresh code is
--      harmless and cheapest.
--   3. Enforce. The UNIQUE index is the part that actually guarantees it.
--
-- Why a plain CREATE UNIQUE INDEX and not CONCURRENTLY: `prisma migrate
-- deploy` runs each migration file inside a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block
-- (SQLSTATE 25001). Asking for it here fails the deploy outright rather
-- than degrading quietly. The cost is an ACCESS EXCLUSIVE lock for the
-- duration of the build, which on this table — indexed on a six-digit
-- column, and small enough that the build is a single sequential scan —
-- is brief. If the table is ever large enough for that lock to matter,
-- the constraint should be added as a separate `CREATE UNIQUE INDEX
-- CONCURRENTLY` run outside Prisma and then recorded with
-- `prisma migrate resolve`, rather than slowing down every deploy to
-- accommodate a hypothetical.
--
-- Because the whole file is one transaction, the re-issue and the index
-- are atomic with each other: there is no window in which the data has
-- been rewritten but the constraint is not yet enforced.
--
-- Re-issue loop note: the candidate is drawn from the same six-digit
-- space dbx.generateUniqueDeliveryCode uses, and re-checked against the
-- table inside the same statement, so this cannot itself introduce a
-- collision. The bounded retry count is a backstop: a million-value
-- space cannot realistically exhaust 200 draws, and if it ever did the
-- RAISE makes the migration fail loudly rather than leave a duplicate
-- behind for the constraint to trip on.

-- 1. Report what is about to change.
SELECT "deliveryCode",
       count(*)                       AS rows_sharing_this_code,
       string_agg(code, ', ' ORDER BY code) AS parcels
FROM parcel
WHERE "deliveryCode" IS NOT NULL
GROUP BY "deliveryCode"
HAVING count(*) > 1
ORDER BY "deliveryCode";

-- 2. Re-issue every row after the first in each colliding group.
DO $$
DECLARE
  r          RECORD;
  candidate  TEXT;
  attempts   INT;
  settled    BOOLEAN;
BEGIN
  FOR r IN
    SELECT p.id
    FROM parcel p
    JOIN (
      -- Survivor order, in one expression so it cannot drift from the
      -- comment above: closed parcels first (their code is spent
      -- evidence), then by parcel code so a re-run on the same data
      -- picks the same survivor.
      SELECT "deliveryCode",
             array_agg(
               id ORDER BY
                 CASE WHEN status IN ('DELIVERED', 'RETURNED_TO_SENDER') THEN 0 ELSE 1 END,
                 code
             ) AS ids
      FROM parcel
      WHERE "deliveryCode" IS NOT NULL
      GROUP BY "deliveryCode"
      HAVING count(*) > 1
    ) d ON d."deliveryCode" = p."deliveryCode"
    WHERE p.id = ANY (d.ids[2:])
  LOOP
    attempts := 0;
    settled  := FALSE;

    WHILE attempts < 200 AND NOT settled LOOP
      candidate := lpad(floor(random() * 1000000)::text, 6, '0');

      -- NOT EXISTS rather than a bare SELECT, so the check and the write
      -- cannot be separated by a concurrent insert of the same candidate.
      -- The unique index below is the real guarantee; this just avoids
      -- depending on it during the rewrite.
      IF NOT EXISTS (SELECT 1 FROM parcel WHERE "deliveryCode" = candidate) THEN
        UPDATE parcel SET "deliveryCode" = candidate WHERE id = r.id;
        settled := TRUE;
      END IF;

      attempts := attempts + 1;
    END LOOP;

    IF NOT settled THEN
      RAISE EXCEPTION
        'could not find an unused delivery code for parcel id % after % attempts',
        r.id, attempts;
    END IF;
  END LOOP;
END $$;

-- 3. Enforce it. Not CONCURRENTLY — see the note above.
CREATE UNIQUE INDEX IF NOT EXISTS "parcel_deliveryCode_key"
  ON "parcel" ("deliveryCode");
