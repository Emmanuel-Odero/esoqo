-- Adds the two AccountKind values that ticketing.go and fleet.go have
-- been posting to SUSPENSE in lieu of (both flagged the gap in their own
-- comments). The balances already sitting in SUSPENSE are moved by the
-- NEXT migration, not this one.
--
-- Split across two migrations deliberately: Postgres will not let a
-- newly added enum value be *used* in the same transaction that adds it
-- ("unsafe use of new value of enum type"). Prisma wraps each migration
-- in a transaction, so the ALTER TYPE and the data move cannot share
-- one.

-- AlterEnum
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'TICKET_REVENUE';
ALTER TYPE "AccountKind" ADD VALUE IF NOT EXISTS 'FARE_REVENUE';
