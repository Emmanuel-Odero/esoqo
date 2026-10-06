-- Backfills person.firstName/middleName/surname for rows created before
-- 20260928125500_national_id_vault_and_esoqo_id_purchase added that
-- split (see that migration's own comment on how it landed without a
-- migration file at the time). Every person row since then gets the
-- three-name split at registration; everything older only ever had
-- officialName, which Person.officialName's own doc comment already
-- documents as `[firstName, middleName, surname].filter(Boolean).join(' ')`
-- — so splitting it back apart on whitespace is the exact inverse of how
-- it was built, not a new guess at the data.
--
-- This runs immediately before 20261002100000_retire_esk_payment_ids,
-- which needs every ESK- holder's party to have a usable firstName to
-- derive a handle from — without it, a pre-split person with only
-- officialName set (e.g. one created before this backfill existed) trips
-- that migration's own "no usable name to derive a handle from"
-- safeguard, which is exactly what surfaced this gap.
--
-- Idempotent and conservative: only touches rows where firstName is
-- still null, and only derives from a non-empty officialName — a person
-- with neither is left alone for 20261002100000's own RAISE to catch,
-- since there's genuinely nothing to split.
DO $$
DECLARE
  r      RECORD;
  tokens TEXT[];
  n      INT;
BEGIN
  FOR r IN
    SELECT "partyId", "officialName"
    FROM "person"
    WHERE "firstName" IS NULL
      AND "officialName" IS NOT NULL
      AND btrim("officialName") <> ''
  LOOP
    tokens := regexp_split_to_array(btrim(r."officialName"), '\s+');
    n := array_length(tokens, 1);
    IF n = 1 THEN
      UPDATE "person" SET "firstName" = tokens[1] WHERE "partyId" = r."partyId";
    ELSE
      UPDATE "person"
         SET "firstName"  = tokens[1],
             "surname"    = tokens[n],
             "middleName" = NULLIF(array_to_string(tokens[2:n-1], ' '), '')
       WHERE "partyId" = r."partyId";
    END IF;
  END LOOP;
END $$;
