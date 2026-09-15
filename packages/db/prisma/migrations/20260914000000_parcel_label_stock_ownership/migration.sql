-- Blank labels get an owner, a batch, and a way to be withdrawn.
--
-- Until now a pre-printed label belonged to nobody. Any authenticated
-- actor could bind any unused PKG- code to a booking, which means a
-- partner courier could spend stock printed for another and the cost
-- and revenue of that shipment would settle against the wrong company.
-- The label was also the one artefact in the system that travels
-- physically, on adhesive, through many hands — and had no way to be
-- cancelled once a pad walked out of a branch.
--
-- The control this adds is the one the freight industry has always
-- used: a pre-numbered pad is issued to an account, and misuse is
-- caught at induction — the first time the code is presented against a
-- real shipment. See BookParcel's existingCode path, which is where
-- this is actually enforced; the columns here only record the facts it
-- checks.

-- ── Ownership ────────────────────────────────────────────────────────
-- NULL means Esoko-operated, the same convention parcel."parcelOrgId"
-- established in 20260912140000_parcel_org_tenancy, and for the same
-- reason: no existing row is backfilled into an invented default
-- tenant. Every label minted so far genuinely belongs to the shared
-- Esoko pool, and saying so with NULL is honest where naming a
-- company that does not exist would not be.
ALTER TABLE "parcel_label_stock"
    ADD COLUMN "parcelOrgId" UUID,
    ADD COLUMN "issuedToOrgStaffId" UUID,
    ADD COLUMN "issuedAt" TIMESTAMP(3);

ALTER TABLE "parcel_label_stock" ADD CONSTRAINT "parcel_label_stock_parcelOrgId_fkey"
    FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Batches ──────────────────────────────────────────────────────────
-- A pad, not a label, is the unit that goes missing — so a whole
-- minted run needs to be recallable in one statement, the way an
-- airline recalls an AWB serial range.
--
-- Deliberately nullable rather than backfilled. Labels minted before
-- this migration really did come off some batch, but we no longer know
-- which, and stamping them all with one synthetic UUID would assert
-- they were printed together — a fact we'd be inventing. NULL reads as
-- "minted before batches were tracked", which is exactly true. Same
-- judgement the tenancy migration made about not inventing a company.
ALTER TABLE "parcel_label_stock"
    ADD COLUMN "batchId" UUID;

-- ── Withdrawal ───────────────────────────────────────────────────────
-- A voided label is not deleted. The physical sticker still exists on
-- something, somewhere, and someone will eventually scan it — so the
-- row has to survive in order to answer "this label was withdrawn"
-- rather than 404 and leave a real box unexplained.
ALTER TABLE "parcel_label_stock"
    ADD COLUMN "voidedAt" TIMESTAMP(3),
    ADD COLUMN "voidedReason" TEXT,
    ADD COLUMN "voidedByStaffId" UUID;

-- "Which of my company's labels are still usable" and "void this whole
-- batch" are the two hot reads, and both filter on still-live stock.
-- Partial indexes rather than full ones for the same reason the
-- existing unused-stock index is partial: spent and voided labels are
-- dead weight in a lookup that only ever asks about live ones.
CREATE INDEX "parcel_label_stock_org_live_idx"
    ON "parcel_label_stock"("parcelOrgId", "createdAt")
    WHERE "usedAt" IS NULL AND "voidedAt" IS NULL;

CREATE INDEX "parcel_label_stock_batch_idx"
    ON "parcel_label_stock"("batchId")
    WHERE "batchId" IS NOT NULL;
