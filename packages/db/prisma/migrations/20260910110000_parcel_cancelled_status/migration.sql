-- Own migration for the same reason every other ParcelStatus/AccountKind
-- addition in this migration set is: a new enum value must be committed
-- before it can be used as a column default or in an UPDATE.

-- AlterEnum
ALTER TYPE "ParcelStatus" ADD VALUE 'CANCELLED';
