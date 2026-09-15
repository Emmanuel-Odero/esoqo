-- Cash on delivery, and the settlement chain behind it.
--
-- This is the flow the parcel vertical could not serve at all: a
-- social-commerce seller ships goods, the buyer pays the courier at the
-- door, and Esoko settles the goods money back to the seller. It is
-- also the only flow in this product where Esoko physically holds
-- somebody else's money, which is why the ledger legs below are
-- double-entry rather than a pair of status columns.
--
-- The money's journey, and who holds it at each step:
--   PENDING   — the buyer's
--   COLLECTED — the rider's pocket   (PARCEL_COD_HELD, one per rider)
--   REMITTED  — Esoko's              (SETTLEMENT)
--   SETTLED   — the seller's         (PARCEL_COD_PAYABLE cleared)

-- ── Account kinds ────────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE is transactional on PG12+; these are only
-- written by application code in later transactions, never by this
-- file, so the "can't use it in the same transaction" restriction
-- doesn't bite here.
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'PARCEL_COD_HELD';
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'PARCEL_COD_PAYABLE';

-- ── The hand-over batch ──────────────────────────────────────────────
-- amountKes and expectedKes are deliberately two columns. The whole
-- point of a reconciliation record is that what was counted and what
-- was owed can disagree; deriving one from the other would make a short
-- hand-over unrepresentable.
CREATE TABLE "parcel_cod_remittance" (
    "id" UUID NOT NULL,
    "riderPartyId" UUID NOT NULL,
    "receivedByStaffId" UUID,
    "receivedByOrgStaffId" UUID,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "expectedKes" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_cod_remittance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "parcel_cod_remittance_riderPartyId_createdAt_idx"
    ON "parcel_cod_remittance"("riderPartyId", "createdAt");

-- ── The global policy ────────────────────────────────────────────────
CREATE TABLE "parcel_cod_policy" (
    "id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "maxAmountKes" DECIMAL(12,2) NOT NULL DEFAULT 20000,
    "handlingFeePct" DECIMAL(5,2) NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "parcel_cod_policy_pkey" PRIMARY KEY ("id")
);

-- Seeded switched OFF. COD is the highest-risk thing in this vertical;
-- it should be a deliberate decision by a named admin, never something
-- that quietly became available because a migration ran.
INSERT INTO "parcel_cod_policy" ("id", "enabled", "maxAmountKes", "handlingFeePct", "updatedAt")
VALUES (gen_random_uuid(), false, 20000, 2, now());

-- ── Parcel columns ───────────────────────────────────────────────────
ALTER TABLE "parcel"
    ADD COLUMN "codAmountKes" DECIMAL(12,2),
    ADD COLUMN "codCollectDeliveryFee" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "codStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    ADD COLUMN "codCollectedKes" DECIMAL(12,2),
    ADD COLUMN "codCollectedAt" TIMESTAMP(3),
    ADD COLUMN "codCollectedByPartyId" UUID,
    ADD COLUMN "codRemittanceId" UUID,
    ADD COLUMN "codSettledAt" TIMESTAMP(3),
    ADD COLUMN "codHandlingFeeKes" DECIMAL(10,2);

ALTER TABLE "parcel"
    ADD CONSTRAINT "parcel_codRemittanceId_fkey"
    FOREIGN KEY ("codRemittanceId") REFERENCES "parcel_cod_remittance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "What is this rider still holding?" and "what do we owe this seller?"
-- are the two queries the whole settlement chain runs on, and both are
-- narrow slices of a table that is mostly not COD at all — hence
-- partial indexes rather than plain ones.
CREATE INDEX "parcel_cod_held_by_rider_idx"
    ON "parcel"("codCollectedByPartyId")
    WHERE "codStatus" = 'COLLECTED';

CREATE INDEX "parcel_cod_owed_to_sender_idx"
    ON "parcel"("senderPartyId")
    WHERE "codStatus" IN ('COLLECTED', 'REMITTED');
