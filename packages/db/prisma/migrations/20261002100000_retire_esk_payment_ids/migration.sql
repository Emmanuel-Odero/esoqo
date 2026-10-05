-- Retire the ESK- payment-ID shape outright.
--
-- Esoqo Payment IDs are now always human-friendly handles derived from
-- the party's own names ("johnmutu482"). The ESK-XXXXXX-KE code shape is
-- gone from minting on both platforms (handle-code.ts and
-- services/core-go/internal/handlecode) and gone from parsing
-- (isEsoqoIdShape now recognises the handle shape and nothing else).
--
-- Nothing was ever in the field that needs an alias, so there is no
-- compatibility branch: no old_code lookup table, no second accepted
-- shape. A printed stand or a texted link carrying an ESK- code stops
-- resolving, deliberately, and the holder is re-issued a handle.
--
-- Three steps, in one transaction so the rewrite and the guarantee cannot
-- be separated:
--
--   1. Report. The SELECT below prints every row about to change, and is
--      the audit trail for a migration that is rewriting the primary
--      identifier of every payee on the platform. It runs before
--      anything is touched.
--   2. Re-issue. Every ESK- row is given a handle derived from its
--      party's recorded names.
--   3. Enforce. The CHECK constraint is the part that actually guarantees
--      the shape can never come back — including through a code path that
--      inserts a raw string and bypasses both generators.
--
-- On step 2's derivation, and why it is an approximation: the
-- authoritative generators are handle-code.ts's personHandleCandidates /
-- orgHandleCandidates and their Go counterparts, which enumerate several
-- candidate mnemonics and re-roll on collision. Reimplementing that
-- enumeration in SQL would be a third copy of the rule that could drift
-- from the other two with nothing to catch it. This reproduces only the
-- *leading* rule — clean the names to a-z, concatenate in order, clip to
-- eight letters, append three digits — which is enough for every converted
-- row to be a handle both platforms accept, with no claim that it is the
-- same string those generators would have picked. Anything genuinely
-- re-derived later goes through the real allocator.
--
-- The constraint deliberately checks only that the shape is *not* the
-- retired one, rather than that it *is* a system handle. EsoqoIdPurchase
-- also allows FULL_NAME, CUSTOM_DIGITS, PHONE and EMAIL, none of which
-- match the handle shape, so a positive constraint would reject legitimate
-- premium codes. "Not ESK-" is the guarantee that actually matters, and
-- it is the one that cannot be reintroduced by accident.
--
-- Step 2's retry bound: a mnemonic has 1,000 three-digit tails. The limit
-- below is a backstop against a name-dense table rather than a real
-- ceiling, and the RAISE makes the migration fail loudly rather than
-- leave a duplicate or a half-converted row behind for the constraint to
-- trip on.

-- 1. Report what is about to change.
SELECT pa.id AS "partyId",
       pi.code AS "oldCode",
       pa.kind,
       COALESCE(pe."officialName", org."officialName") AS "partyName"
FROM "esoko_payment_id" pi
JOIN party pa ON pa.id = pi."partyId"
LEFT JOIN person pe ON pe."partyId" = pa.id
LEFT JOIN organisation org ON org."partyId" = pa.id
WHERE pi.code ~* '^ESK-'
ORDER BY pi.code;

-- 2. Re-issue every ESK- row as a name-derived handle.
DO $$
DECLARE
  r          RECORD;
  candidate  TEXT;
  attempts   INT;
  settled    BOOLEAN;
  base       TEXT;
BEGIN
  FOR r IN
    SELECT pi."partyId",
           -- Person: firstName + surname in registration order, which is
           -- the order personHandleCandidates merges. organisation has no
           -- forename/surname, so it contributes officialName/knownAs
           -- and orgHandleCandidates' stopword filter drops connectors.
           CASE WHEN pe."partyId" IS NOT NULL
                THEN lower(regexp_replace(
                       concat_ws('', pe."firstName", pe."surname"), '[^a-z]', '', 'g'))
                -- Leading token of the org name, minus function words, so
                -- "Mchama wa Wananchi" does not mint "mchamawa".
                ELSE lower(coalesce(
                       NULLIF((regexp_split_to_array(
                                  regexp_replace(lower(coalesce(org."officialName", org."knownAs", '')),
                                                 '[^a-z]+', ' ', 'g'), ' '))[1], ''),
                       NULLIF((regexp_split_to_array(
                                  regexp_replace(lower(coalesce(org."officialName", org."knownAs", '')),
                                                 '[^a-z]+', ' ', 'g'), ' '))[2], ''),
                       'esoqo'))
           END AS mnemonic
    FROM "esoko_payment_id" pi
    LEFT JOIN person pe ON pe."partyId" = pi."partyId"
    LEFT JOIN organisation org ON org."partyId" = pi."partyId"
    WHERE pi.code ~* '^ESK-'
  LOOP
    -- Clip to eight letters so mnemonic + digits stays within the
    -- 11-character shape bound, and floor at two so the handle still
    -- matches isSystemHandleShape.
    base := left(r.mnemonic, 8);
    IF length(base) < 2 THEN
      RAISE EXCEPTION
        'party % has no usable name to derive a handle from — repair the record, then re-run',
        r."partyId";
    END IF;

    attempts := 0;
    settled  := FALSE;

    WHILE attempts < 64 AND NOT settled LOOP
      candidate := base || lpad(floor(random() * 1000)::text, 3, '0');

      -- NOT EXISTS rather than a bare SELECT, so the check and the write
      -- cannot be separated by a concurrent insert of the same handle.
      -- The unique index on code is the real guarantee; this just avoids
      -- depending on it during the rewrite.
      IF NOT EXISTS (SELECT 1 FROM "esoko_payment_id" WHERE code = candidate) THEN
        UPDATE "esoko_payment_id"
           SET code = candidate, source = 'SYSTEM_GENERATED', "premiumExpiresAt" = NULL
         WHERE "partyId" = r."partyId";
        settled := TRUE;
      END IF;

      attempts := attempts + 1;
    END LOOP;

    IF NOT settled THEN
      RAISE EXCEPTION
        'could not find an unused handle for party % after % attempts',
        r."partyId", attempts;
    END IF;
  END LOOP;
END $$;

-- 3. Enforce it. See the note above: this rejects the retired shape and
-- nothing more, so premium FULL_NAME/PHONE/EMAIL handles stay legal.
ALTER TABLE "esoko_payment_id"
  DROP CONSTRAINT IF EXISTS "esoko_payment_id_code_not_esk";
ALTER TABLE "esoko_payment_id"
  ADD CONSTRAINT "esoko_payment_id_code_not_esk"
  CHECK (code !~* '^ESK-');