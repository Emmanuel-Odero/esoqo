-- Wrong delivery-code guesses, counted on the parcel itself.
--
-- This counter used to be a Redis key (authsvc.RecordFailure), read in
-- handleDeliverParcel before dbx.DeliverParcel compared the code. Both
-- halves of that shape fail open: authsvc.FailedAttempts returns 0 when
-- the client is nil, and returns 0 on any Redis error. A six-digit code
-- (dbx.DeliveryCodeDigits) is a million combinations, and the party
-- doing the guessing is the courier currently holding the box — so a
-- Redis blip, a missing REDIS_URL in an environment, or an eviction
-- turned the throttle off rather than degrading it. The counter moves
-- next to the comparison it guards, in the database that has to be
-- reachable for the delivery to happen at all.

-- AlterTable
ALTER TABLE "parcel"
  ADD COLUMN "deliveryCodeFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryCodeLockedUntil" TIMESTAMP(3);
