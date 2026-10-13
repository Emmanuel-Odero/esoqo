-- Per-company cash switch. When false, a company takes no cash at all:
-- the counter cash settlement, the counter-cash remittance and the
-- counter bus seat sale are all closed off and only M-Pesa is offered.
-- Default true so existing companies keep taking cash exactly as before.

-- AlterTable
ALTER TABLE "parcel_org" ADD COLUMN "acceptsCash" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "parcel_org_acceptsCash_idx" ON "parcel_org"("acceptsCash");
