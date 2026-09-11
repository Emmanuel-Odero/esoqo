-- One global admin-editable per-km rate — see model
-- ParcelDistanceRate's own comment on why this is one row, not a
-- per-zone-pair matrix.

-- CreateTable
CREATE TABLE "parcel_distance_rate" (
    "id" UUID NOT NULL,
    "perKmKes" DECIMAL(10,2) NOT NULL,
    "minChargeableKm" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "parcel_distance_rate_pkey" PRIMARY KEY ("id")
);
