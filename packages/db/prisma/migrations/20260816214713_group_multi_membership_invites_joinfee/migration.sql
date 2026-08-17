-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE');

-- AlterTable
ALTER TABLE "group_contribution" ADD COLUMN     "membershipId" UUID;

-- AlterTable
ALTER TABLE "group_treasury_policy" ADD COLUMN     "contributionsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "joinFeeKes" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "membership" ADD COLUMN     "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "membership_orgId_status_idx" ON "membership"("orgId", "status");

-- AddForeignKey
ALTER TABLE "group_contribution" ADD CONSTRAINT "group_contribution_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
