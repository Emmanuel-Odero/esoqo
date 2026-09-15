-- A pre-printed label can now carry a free-form note about what it's
-- stuck on — "TV stand for Kevin, HQ -> Westlands" — attached in the
-- field the moment a handler actually puts the label on a physical
-- item, well before (if ever) that item goes through the full
-- sender/receiver/pricing/payment booking flow. Distinct from
-- usedAt/usedByParcelId (a *real*, paid Parcel booking bound to this
-- code): a label can carry info without ever becoming a booked
-- parcel, and GetParcelStatus's guest-safe scan/track projection now
-- falls back to this when no real parcel exists yet for the code.
ALTER TABLE "parcel_label_stock"
    ADD COLUMN "itemInfo" TEXT,
    ADD COLUMN "infoAttachedAt" TIMESTAMP(3),
    ADD COLUMN "infoAttachedByStaffId" UUID;
