/*
  Warnings:

  - You are about to drop the `org` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `org_config` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `org_staff` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `org_staff_pin` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "booking" DROP CONSTRAINT "booking_voucherId_fkey";

-- DropForeignKey
ALTER TABLE "fare_payment" DROP CONSTRAINT "fare_payment_buyerParty_fkey";

-- DropForeignKey
ALTER TABLE "luggage_tag" DROP CONSTRAINT "luggage_tag_boardedByCrewId_fkey";

-- DropForeignKey
ALTER TABLE "luggage_tag" DROP CONSTRAINT "luggage_tag_claimedByCrewId_fkey";

-- DropForeignKey
ALTER TABLE "luggage_tag" DROP CONSTRAINT "luggage_tag_dropStageId_fkey";

-- DropForeignKey
ALTER TABLE "luggage_tag" DROP CONSTRAINT "luggage_tag_orgId_fkey";

-- DropForeignKey
ALTER TABLE "luggage_tag" DROP CONSTRAINT "luggage_tag_ticketId_fkey";

-- DropForeignKey
ALTER TABLE "luggage_tag" DROP CONSTRAINT "luggage_tag_tripId_fkey";

-- DropForeignKey
ALTER TABLE "org_config" DROP CONSTRAINT "org_config_orgId_fkey";

-- DropForeignKey
ALTER TABLE "org_staff" DROP CONSTRAINT "org_staff_orgId_fkey";

-- DropForeignKey
ALTER TABLE "org_staff_pin" DROP CONSTRAINT "org_staff_pin_staffId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_counter_ticket" DROP CONSTRAINT "parcel_counter_ticket_claimedByStaffId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_counter_ticket" DROP CONSTRAINT "parcel_counter_ticket_orgId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_event" DROP CONSTRAINT "parcel_event_parcelId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_route" DROP CONSTRAINT "parcel_route_parcelOrgId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_route_stop" DROP CONSTRAINT "parcel_route_stop_routeId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_route_stop" DROP CONSTRAINT "parcel_route_stop_stationId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_run_crew" DROP CONSTRAINT "parcel_dispatch_crew_staffId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_run_crew" DROP CONSTRAINT "parcel_run_crew_runId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_run_ping" DROP CONSTRAINT "parcel_run_ping_runId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_run_receiver" DROP CONSTRAINT "parcel_dispatch_receiver_staffId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_run_receiver" DROP CONSTRAINT "parcel_run_receiver_runId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_shipment" DROP CONSTRAINT "parcel_shipment_destinationStationId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_shipment" DROP CONSTRAINT "parcel_shipment_originStationId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_shipment" DROP CONSTRAINT "parcel_shipment_parcelOrgId_fkey";

-- DropForeignKey
ALTER TABLE "parcel_shipment" DROP CONSTRAINT "parcel_shipment_routeId_fkey";

-- DropForeignKey
ALTER TABLE "store_order" DROP CONSTRAINT "store_order_voucherId_fkey";

-- DropForeignKey
ALTER TABLE "voucher_card" DROP CONSTRAINT "voucher_card_owner_fkey";

-- DropIndex
DROP INDEX "booking_voucher_idx";

-- DropIndex
DROP INDEX "parcel_destinationAgentId_status_idx";

-- DropIndex
DROP INDEX "parcel_parcelOrgId_status_createdAt_idx";

-- DropIndex
DROP INDEX "parcel_agent_parcelOrgId_idx";

-- DropIndex
DROP INDEX "parcel_courier_parcelOrgId_idx";

-- DropIndex
DROP INDEX "parcel_org_staff_stationId_idx";

-- DropIndex
DROP INDEX "store_order_voucher_idx";

-- AlterTable
ALTER TABLE "luggage_tag" ALTER COLUMN "boardedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "claimedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "parcel_counter_ticket" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "parcel_run_crew" RENAME CONSTRAINT "parcel_dispatch_crew_pkey" TO "parcel_run_crew_pkey";

-- AlterTable
ALTER TABLE "parcel_run_ping" RENAME CONSTRAINT "parcel_dispatch_ping_pkey" TO "parcel_run_ping_pkey";
ALTER TABLE "parcel_run_ping" ALTER COLUMN "at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "parcel_run_receiver" RENAME CONSTRAINT "parcel_dispatch_receiver_pkey" TO "parcel_run_receiver_pkey";

-- AlterTable
ALTER TABLE "voucher_card" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "voucher_ledger_entry" ALTER COLUMN "kesEquiv" DROP DEFAULT;

-- DropView
DROP VIEW IF EXISTS "org_staff_view" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "org" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "org_config" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "org_staff" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "org_staff_pin" CASCADE;

-- CreateIndex
CREATE INDEX "parcel_label_stock_parcelOrgId_createdAt_idx" ON "parcel_label_stock"("parcelOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "parcel_label_stock_batchId_idx" ON "parcel_label_stock"("batchId");

-- RenameForeignKey
ALTER TABLE "fare_verification" RENAME CONSTRAINT "fare_verification_fare_fkey" TO "fare_verification_fareId_fkey";

-- RenameForeignKey
ALTER TABLE "parcel_shipment_item" RENAME CONSTRAINT "parcel_shipment_item_parcel_fkey" TO "parcel_shipment_item_parcelId_fkey";

-- RenameForeignKey
ALTER TABLE "parcel_shipment_item" RENAME CONSTRAINT "parcel_shipment_item_shipment_fkey" TO "parcel_shipment_item_shipmentId_fkey";

-- RenameForeignKey
ALTER TABLE "voucher_ledger_entry" RENAME CONSTRAINT "voucher_ledger_journal_fkey" TO "voucher_ledger_entry_journalEntryId_fkey";

-- RenameForeignKey
ALTER TABLE "voucher_ledger_entry" RENAME CONSTRAINT "voucher_ledger_voucher_fkey" TO "voucher_ledger_entry_voucherId_fkey";

-- AddForeignKey
ALTER TABLE "parcel_counter_ticket" ADD CONSTRAINT "parcel_counter_ticket_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "parcel_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_counter_ticket" ADD CONSTRAINT "parcel_counter_ticket_claimedByStaffId_fkey" FOREIGN KEY ("claimedByStaffId") REFERENCES "parcel_org_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_event" ADD CONSTRAINT "parcel_event_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_shipment" ADD CONSTRAINT "parcel_shipment_parcelOrgId_fkey" FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_shipment" ADD CONSTRAINT "parcel_shipment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "parcel_route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_shipment" ADD CONSTRAINT "parcel_shipment_originStationId_fkey" FOREIGN KEY ("originStationId") REFERENCES "parcel_agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_shipment" ADD CONSTRAINT "parcel_shipment_destinationStationId_fkey" FOREIGN KEY ("destinationStationId") REFERENCES "parcel_agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_run_crew" ADD CONSTRAINT "parcel_run_crew_runId_fkey" FOREIGN KEY ("runId") REFERENCES "parcel_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_run_receiver" ADD CONSTRAINT "parcel_run_receiver_runId_fkey" FOREIGN KEY ("runId") REFERENCES "parcel_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_run_ping" ADD CONSTRAINT "parcel_run_ping_runId_fkey" FOREIGN KEY ("runId") REFERENCES "parcel_shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_route" ADD CONSTRAINT "parcel_route_parcelOrgId_fkey" FOREIGN KEY ("parcelOrgId") REFERENCES "parcel_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_route_stop" ADD CONSTRAINT "parcel_route_stop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "parcel_route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcel_route_stop" ADD CONSTRAINT "parcel_route_stop_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "parcel_agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "luggage_tag" ADD CONSTRAINT "luggage_tag_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "luggage_tag" ADD CONSTRAINT "luggage_tag_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "ticket_org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "luggage_tag" ADD CONSTRAINT "luggage_tag_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "luggage_tag" ADD CONSTRAINT "luggage_tag_dropStageId_fkey" FOREIGN KEY ("dropStageId") REFERENCES "fare_stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "luggage_tag" ADD CONSTRAINT "luggage_tag_boardedByCrewId_fkey" FOREIGN KEY ("boardedByCrewId") REFERENCES "crew_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "luggage_tag" ADD CONSTRAINT "luggage_tag_claimedByCrewId_fkey" FOREIGN KEY ("claimedByCrewId") REFERENCES "crew_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "courier_team_member_team_party_key" RENAME TO "courier_team_member_teamId_partyId_key";

-- RenameIndex
ALTER INDEX "fare_payment_buyerParty_idx" RENAME TO "fare_payment_buyerPartyId_idx";

-- RenameIndex
ALTER INDEX "fare_payment_receiptCode_idx" RENAME TO "fare_payment_mpesaReceiptCode_idx";

-- RenameIndex
ALTER INDEX "fare_verification_fare_idx" RENAME TO "fare_verification_fareId_createdAt_idx";

-- RenameIndex
ALTER INDEX "fare_verification_scope_idx" RENAME TO "fare_verification_scopeTripId_createdAt_idx";

-- RenameIndex
ALTER INDEX "parcel_counter_ticket_org_status_created_idx" RENAME TO "parcel_counter_ticket_orgId_status_createdAt_idx";

-- RenameIndex
ALTER INDEX "parcel_event_parcel_idx" RENAME TO "parcel_event_parcelId_createdAt_idx";

-- RenameIndex
ALTER INDEX "party_loyalty_party_idx" RENAME TO "party_loyalty_entry_partyId_createdAt_idx";

-- RenameIndex
ALTER INDEX "voucher_card_checkout_key" RENAME TO "voucher_card_mpesaCheckoutRequestId_key";

-- RenameIndex
ALTER INDEX "voucher_card_owner_idx" RENAME TO "voucher_card_ownerPartyId_status_idx";

-- RenameIndex
ALTER INDEX "voucher_ledger_journal_key" RENAME TO "voucher_ledger_entry_journalEntryId_key";

-- RenameIndex
ALTER INDEX "voucher_ledger_voucher_idx" RENAME TO "voucher_ledger_entry_voucherId_createdAt_idx";
