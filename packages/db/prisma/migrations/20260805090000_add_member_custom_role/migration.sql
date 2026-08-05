-- Lets a group record a member's role as free text ("Youth rep",
-- "Auditor") instead of being limited to the four fixed offices.
-- AlterEnum
ALTER TYPE "MemberRole" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "membership" ADD COLUMN "customRole" TEXT;
