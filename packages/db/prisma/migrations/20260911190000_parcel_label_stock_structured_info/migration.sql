-- Replaces the single free-form itemInfo note (last migration) with
-- proper structured fields — a handler filling this in for a real
-- item benefits from separate, purpose-built inputs (a destination
-- picker, a gender select, a weight-range select) far more than one
-- text box, and a structured record is what lets a future screen
-- actually list/filter/search attached items instead of grepping
-- free text. itemInfo was only ever populated by ad-hoc testing this
-- pilot cycle (see AttachParcelLabelInfo's own comment history) — safe
-- to drop rather than migrate.
ALTER TABLE "parcel_label_stock"
    DROP COLUMN "itemInfo",
    ADD COLUMN "itemDescription" TEXT,
    ADD COLUMN "destination" TEXT,
    ADD COLUMN "ownerName" TEXT,
    ADD COLUMN "ownerContact" TEXT,
    ADD COLUMN "ownerGender" TEXT,
    ADD COLUMN "itemType" TEXT,
    ADD COLUMN "weightRangeKg" TEXT;
