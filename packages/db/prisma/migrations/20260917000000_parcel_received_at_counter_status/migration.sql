-- A station/counter receipt is not a courier pickup. Before this value
-- the first custody scan always went BOOKED -> PICKED_UP, so a walk-in
-- drop-off — and, worse, an Esoqo staff counter confirmation, which
-- could not run at all because a staff session carries no Party to
-- attribute custody to — read on the tracker as "a courier has
-- collected it", or was stuck at AWAITING_INTAKE forever. This is the
-- stage that lets both clients show "received at counter" until a rider
-- actually takes it.
--
-- Own migration, same reason every other ParcelStatus addition has one:
-- a new enum value must be committed before it can be used in an UPDATE.
-- See 20260910000000 for the same note.

-- AlterEnum
ALTER TYPE "ParcelStatus" ADD VALUE 'RECEIVED_AT_COUNTER' BEFORE 'PICKED_UP';
