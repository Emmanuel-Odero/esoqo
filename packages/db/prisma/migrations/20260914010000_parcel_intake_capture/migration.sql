-- What a counter actually records when a parcel is handed over.
--
-- Booking until now captured who, where, and a weight bracket the
-- sender picked themselves. A clerk with the box physically in front of
-- them knows far more than that, and three of the things they know are
-- the ones that cost money when they go unrecorded.

-- ── Dimensions, and the revenue they represent ───────────────────────
-- Every carrier in the world charges max(actual, volumetric) weight,
-- where volumetric is (L × W × H) / divisor. Esoko had no dimensions at
-- all, so a mattress and a car battery of equal mass were charged
-- alike. That is a continuous, invisible leak on exactly the freight
-- most likely to travel a long way: bulky, light, and cheap to say yes
-- to.
--
-- Invisible because nothing recorded what *should* have been charged —
-- there is no report that can show you this loss after the fact, only
-- a column that starts collecting it. Hence recording dimensions even
-- where they do not yet move a price.
ALTER TABLE "parcel"
    ADD COLUMN "lengthCm" DECIMAL(6,1),
    ADD COLUMN "widthCm"  DECIMAL(6,1),
    ADD COLUMN "heightCm" DECIMAL(6,1);

-- Same three on a pre-printed label, because a handler measuring a box
-- at a bus stage is doing the same job as a clerk at a counter, just
-- earlier and with less of the picture. One vocabulary across both.
ALTER TABLE "parcel_label_stock"
    ADD COLUMN "lengthCm" DECIMAL(6,1),
    ADD COLUMN "widthCm"  DECIMAL(6,1),
    ADD COLUMN "heightCm" DECIMAL(6,1);

-- ── The contents declaration ─────────────────────────────────────────
-- A positive affirmation, timestamped and attributed, that the sender
-- was asked about prohibited contents and said no.
--
-- Deliberately a timestamp plus a staff id rather than a boolean: the
-- question "was this box declared?" is nearly useless six weeks later
-- compared with "who asked, and when". A boolean records that a
-- checkbox was ticked; this records that a person asked a question.
-- If something goes wrong on a bus, that difference is the whole
-- artefact.
ALTER TABLE "parcel"
    ADD COLUMN "contentsDeclaredAt" TIMESTAMP(3),
    ADD COLUMN "contentsDeclaredByStaffId" UUID;

-- ── Condition on arrival at the counter ──────────────────────────────
-- The photo taken when the parcel is taken in, as opposed to
-- "podPhotoUrl" which is taken when it is handed over. Together they
-- bracket our custody: a damage dispute is settled by comparing the
-- two, and without the first one every dispute is the customer's word
-- against the courier's.
ALTER TABLE "parcel"
    ADD COLUMN "intakePhotoUrl" TEXT,
    ADD COLUMN "intakePhotoAt"  TIMESTAMP(3);
