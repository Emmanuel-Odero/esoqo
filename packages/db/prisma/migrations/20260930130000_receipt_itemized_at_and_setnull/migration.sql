-- DropForeignKey
ALTER TABLE "receipt" DROP CONSTRAINT "receipt_storeId_fkey";

-- AlterTable
ALTER TABLE "receipt" ADD COLUMN     "itemizedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

