-- One person can book more than one seat in a single checkout (one
-- M-Pesa prompt, one total). bus_booking stays one row per seat (so a
-- cancellation or boarding check is still per-seat), but several rows
-- from the same checkout now share the same "code" and the same
-- "mpesaCheckoutRequestId" — the booking page and the M-Pesa webhook
-- both key off the group that way instead of off a single row. Both
-- columns therefore need a plain index in place of their old unique
-- ones.

DROP INDEX "bus_booking_code_key";
CREATE INDEX "bus_booking_code_idx" ON "bus_booking"("code");

DROP INDEX "bus_booking_mpesaCheckoutRequestId_key";
CREATE INDEX "bus_booking_mpesa_checkout_idx" ON "bus_booking"("mpesaCheckoutRequestId");
