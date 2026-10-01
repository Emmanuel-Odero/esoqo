-- dbx.ReserveParcelPayment claims the right to send an M-Pesa STK push
-- BEFORE the push, so two concurrent /parcels/:code/pay requests cannot
-- both put a payment prompt on the customer's phone. Without a
-- reservation, a double-tap or a client retry on a slow connection sent
-- two prompts: the sender could complete both and be charged twice for
-- one parcel, while the first checkout's webhook was orphaned by the
-- attach and its money credited to nobody.
--
-- The reservation is written into paymentCheckoutRequestId — the same
-- slot, so every existing guard covers it unchanged — which creates a new
-- failure mode: a process dying between the reservation and the attach
-- strands a token no push will complete and no caller can release. The
-- parcel would then be unpayable, and because the stale-draft sweep also
-- skips rows with a non-null checkout id, unsweepable too.
--
-- paymentReservationAt is non-null ONLY while the column holds a local
-- token, so the sweep can tell "a push is being attempted" from "a push
-- exists and its callback may still land" and reclaim the first without
-- touching the second.

-- AlterTable
ALTER TABLE "parcel"
  ADD COLUMN "paymentReservationAt" TIMESTAMP(3);

-- Partial index: the sweep is the only reader and it only ever wants
-- expired reservations, so it never needs the millions of rows where the
-- column is null. Composite on (status, reservation time) would be worse
-- — status is the low-cardinality side.
CREATE INDEX "parcel_paymentReservationAt_idx"
  ON "parcel" ("paymentReservationAt")
  WHERE "paymentReservationAt" IS NOT NULL;
