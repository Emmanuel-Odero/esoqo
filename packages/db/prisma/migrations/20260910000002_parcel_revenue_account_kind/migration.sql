-- Own migration for the same reason 20260910000000 is split out: a new
-- enum value must be committed before ledger.EnsureAccount can use it.

-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE 'PARCEL_REVENUE';
