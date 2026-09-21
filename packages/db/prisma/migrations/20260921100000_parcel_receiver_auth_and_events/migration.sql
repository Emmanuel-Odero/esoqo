-- Receiver self-authentication, a real parcel history, and the
-- sender's own declaration.
--
-- Three problems, one migration, because they all land on `parcel` and
-- the first two are the same feature seen from two ends.
--
-- 1. The delivery code was a staff-only credential. Only the current
--    holder could type it (dbx.DeliverParcel), the receiver never
--    proved anything themselves, and when a code went wrong there was
--    no recovery at all: no reissue existed anywhere in the codebase,
--    and the 5-try throttle lived only in Redis, where staff could not
--    see it and a restart silently forgave it.
--
-- 2. There was nowhere to record a non-custody fact about a parcel.
--    The public timeline was synthesized entirely from parcel_handoff
--    legs plus a booked/delivered bookend, so "authentication failed"
--    and "a new code was issued" were unrepresentable. The nearest
--    thing, parcel."exceptionNote", is one overwritable slot.
--
-- 3. A guest booking captured no declaration of any kind. The existing
--    "contentsDeclaredAt"/"contentsDeclaredByStaffId" pair deliberately
--    cannot serve here — it asserts that a named member of staff asked
--    a person face to face, which a web form can never be — so the
--    sender's own weaker assertion gets its own columns rather than
--    quietly devaluing the staff pair.

-- ── 1. Parcel history ────────────────────────────────────────────────

CREATE TYPE "ParcelEventKind" AS ENUM (
  'RECEIVER_AUTH_PASSED',
  'RECEIVER_AUTH_FAILED',
  'RECEIVER_AUTH_LOCKED',
  'RECEIVER_AUTH_RETRY_GRANTED',
  'RECEIVER_AUTH_HARD_LOCKED',
  'DELIVERY_CODE_REISSUED',
  'RECEIVER_SELF_CONFIRMED',
  'COURIER_EARNINGS_HELD',
  'COURIER_EARNINGS_RELEASED'
);

CREATE TYPE "ParcelEventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "parcel_event" (
  "id"       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "parcelId" UUID NOT NULL,
  "kind"     "ParcelEventKind" NOT NULL,
  "severity" "ParcelEventSeverity" NOT NULL DEFAULT 'INFO',

  -- NULL means staff-only. A non-null value is the exact sentence a
  -- guest sees on the public tracking page — one field rather than a
  -- visible boolean plus a string, because the two cannot then
  -- disagree and render a blank row to a stranger.
  "publicLabel" TEXT,
  -- What the public label must not carry: attempt counts, who acted,
  -- the reason.
  "staffDetail" TEXT,

  -- GUEST | STAFF | SYSTEM. "actorPartyId" is set only for STAFF; a
  -- guest has no Party, which is the premise of the flow writing most
  -- of these rows.
  "actorType"    TEXT NOT NULL,
  "actorPartyId" UUID,
  "actorIp"      TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "parcel_event_parcelId_fkey"
    FOREIGN KEY ("parcelId") REFERENCES "parcel"("id") ON DELETE CASCADE
);

CREATE INDEX "parcel_event_parcel_idx" ON "parcel_event" ("parcelId", "createdAt");

-- ── 2. Receiver authentication state ─────────────────────────────────
--
-- On the row rather than in Redis, unlike the courier-side throttle
-- this sits beside. That one guards a staff endpoint and fails open on
-- purpose: a lost counter means a clerk gets a few more tries. This one
-- is escalation state — staff have to see it, act on it, and have their
-- grant survive a restart.

ALTER TABLE "parcel"
  ADD COLUMN "receiverAuthAttempts"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "receiverAuthLockedAt"     TIMESTAMP(3),
  ADD COLUMN "receiverAuthExtraGranted" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "receiverAuthHardLockedAt" TIMESTAMP(3);

-- Partial: the queue these feed asks "which parcels are stuck", and
-- that is a handful of rows against a table that only grows.
CREATE INDEX "parcel_receiver_auth_locked_idx"
  ON "parcel" ("receiverAuthLockedAt") WHERE "receiverAuthLockedAt" IS NOT NULL;
CREATE INDEX "parcel_receiver_auth_hard_locked_idx"
  ON "parcel" ("receiverAuthHardLockedAt") WHERE "receiverAuthHardLockedAt" IS NOT NULL;

-- The code column only ever holds the current value, so without a
-- version a timeline entry reading "a new code was issued" has nothing
-- to count. NULL "deliveryCodeIssuedAt" reads correctly as "the
-- original", which is every row that exists today.
ALTER TABLE "parcel"
  ADD COLUMN "deliveryCodeVersion"  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deliveryCodeIssuedAt" TIMESTAMP(3);

-- Courier pay accrues the instant a delivery commits, everywhere else,
-- because staff were physically present to assert it happened. A
-- receiver self-confirming at an agent's counter has no such witness,
-- so the pay waits out a hold and is released deliberately. An
-- accrual is irreversible by design; this is the window in which a
-- fraudulent self-confirm can still be caught before money moves.
ALTER TABLE "parcel"
  ADD COLUMN "courierEarningsHeldUntil" TIMESTAMP(3);

CREATE INDEX "parcel_courier_earnings_held_idx"
  ON "parcel" ("courierEarningsHeldUntil") WHERE "courierEarningsHeldUntil" IS NOT NULL;

-- ── 3. The sender's own declaration ──────────────────────────────────
--
-- Timestamps and a version rather than booleans, for the reason the
-- staff pair above already gives in its own comment: in a dispute
-- "which terms, and when" is the entire question, and a bare true
-- answers none of it.
--
-- Esoqo's terms and the carrier's are captured separately because they
-- are two promises by two legal entities and a claim may turn on only
-- one. The declared VALUE is not duplicated here — it is
-- "declaredValueKes", the same number cover is priced from, and a
-- second copy would only invite the two to disagree.

ALTER TABLE "parcel"
  ADD COLUMN "senderDeclaredContents"   TEXT,
  ADD COLUMN "lawfulContentsAttestedAt" TIMESTAMP(3),
  ADD COLUMN "termsAcceptedAt"          TIMESTAMP(3),
  ADD COLUMN "termsVersion"             TEXT,
  ADD COLUMN "carrierTermsVersion"      TEXT;
