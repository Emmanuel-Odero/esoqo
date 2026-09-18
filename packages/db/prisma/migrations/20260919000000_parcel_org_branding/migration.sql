-- Company branding for co-branded parcel labels.
-- logoUrl prints centered in the label header band (never over QR/barcode
-- pixels); NULL = Esoqo branding alone. brandAccent is an optional hex.
ALTER TABLE parcel_org
  ADD COLUMN IF NOT EXISTS "logoStorageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "logoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "brandAccent" TEXT;
