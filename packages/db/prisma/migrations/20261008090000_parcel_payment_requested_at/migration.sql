-- When the M-Pesa prompt behind parcel.paymentCheckoutRequestId actually
-- went out. Without it a push the payer ignored (and that the provider
-- never reported as failed) left the parcel "payment in progress" for
-- ever: no clerk could re-prompt, and nothing could tell a live prompt
-- from a long-dead one. M-Pesa prompts expire in about a minute, so a
-- push older than a few minutes can be cancelled safely.

-- AlterTable
ALTER TABLE "parcel" ADD COLUMN "paymentRequestedAt" TIMESTAMP(3);

-- Partial index: only the reconcile sweep reads it, and only for rows
-- with a push out.
CREATE INDEX "parcel_paymentRequestedAt_idx"
  ON "parcel" ("paymentRequestedAt")
  WHERE "paymentRequestedAt" IS NOT NULL;
