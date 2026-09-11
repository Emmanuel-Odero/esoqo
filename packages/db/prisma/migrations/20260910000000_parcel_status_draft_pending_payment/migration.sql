-- Split into its own migration: Postgres forbids using a new enum
-- value in the same transaction that adds it ("unsafe use of new
-- value... must be committed before they can be used"), so this value
-- has to land and commit before 20260910000001 can reference it as a
-- column default.

-- AlterEnum
ALTER TYPE "ParcelStatus" ADD VALUE 'DRAFT_PENDING_PAYMENT';
