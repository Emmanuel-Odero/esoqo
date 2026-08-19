-- CreateEnum
CREATE TYPE "SourceSystem" AS ENUM ('ESOKO', 'CECF');

-- AlterEnum
BEGIN;
CREATE TYPE "JoinPath_new" AS ENUM ('SELF_WEB', 'SELF_USSD', 'AGENT_ASSISTED', 'COHORT', 'CECF_WEB');
ALTER TABLE "public"."registration" ALTER COLUMN "path" DROP DEFAULT;
ALTER TABLE "registration" ALTER COLUMN "path" TYPE "JoinPath_new" USING ("path"::text::"JoinPath_new");
ALTER TYPE "JoinPath" RENAME TO "JoinPath_old";
ALTER TYPE "JoinPath_new" RENAME TO "JoinPath";
DROP TYPE "public"."JoinPath_old";
ALTER TABLE "registration" ALTER COLUMN "path" SET DEFAULT 'SELF_WEB';
COMMIT;

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CARD';

-- AlterTable
ALTER TABLE "party" ADD COLUMN     "sourceSystem" "SourceSystem" NOT NULL DEFAULT 'ESOKO';

-- AlterTable
ALTER TABLE "registration_payment" ADD COLUMN     "pesapalOrderTrackingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "registration_payment_pesapalOrderTrackingId_key" ON "registration_payment"("pesapalOrderTrackingId");

