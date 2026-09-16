-- The label's parties move from a single free-text "owner" to the
-- sender/receiver shape a real booking already uses (see §3.1 of
-- docs/proposals/esoqo-parcel-labels-and-console.md: "ownerName/
-- ownerContact become senderName/senderMsisdn on the stock row, which
-- grows the same nullable receiver/destination shape a parcel has").
-- One vocabulary across "attach info to a label" and "book a parcel".
--
-- ownerGender is dropped too — the parcel shape has no gender, and
-- .name/.Msisdn per party is what both the register and the scan page
-- need. The owner columns only landed this pilot cycle and hold the
-- same ad-hoc test fill the itemInfo drop before them did (see the
-- 20260911190000 migration's own comment) — safe to drop rather than
-- migrate.
ALTER TABLE "parcel_label_stock"
    DROP COLUMN "ownerName",
    DROP COLUMN "ownerContact",
    DROP COLUMN "ownerGender",
    ADD COLUMN "senderName" TEXT,
    ADD COLUMN "senderMsisdn" TEXT,
    ADD COLUMN "receiverName" TEXT,
    ADD COLUMN "receiverMsisdn" TEXT;