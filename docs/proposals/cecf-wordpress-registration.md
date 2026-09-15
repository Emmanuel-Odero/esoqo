# CECF WordPress registration → esoqo

**Type** · Implementation record (design doc; spans `services/cecf-wordpress`, `services/core`,
`packages/db`, `packages/domain`, `packages/payments`, `apps/admin`, `apps/app`)
**Prepared** · 17 August 2026
**Status** · Implemented (esoqo side) — WordPress-side build follows

## 1 · What changed

CECF's public registration (individual / group / business) moves fully onto the CECF
WordPress site (`services/cecf-wordpress`), which was previously an unbuilt stub — its
`registrationForm` section type had seeded copy but no Blade partial ever rendered it,
and its `cecf_enquiry` post type had no submitter. `apps/app/join` stays esoqo's own
registration flow only (de-CECF-branded — see phase 4 below); it is no longer CECF's
front door.

**Both funnels write into the same esoqo data model.** WordPress's PHP backend never
talks to Daraja or Pesapal directly, and never touches the database directly — it talks
to a new authenticated REST facade in `services/core` (`/api/cecf/*`) that is a thin
proxy over the *same* `@esoqo/db` functions `apps/app/join`'s Server Actions already
call. No business logic is duplicated, no gateway secret ever reaches WordPress.

## 2 · Schema (`packages/db/prisma/schema.prisma`)

- `Party.sourceSystem: SourceSystem` (`ESOKO | CECF`, default `ESOKO`) — set once, at
  Party-creation time, from `Registration.path === 'CECF_WEB'`. This is what admin's
  "CECF Registrations" indicator reads — `Registration` is a funnel record that doesn't
  outlive completion, `Party` does.
- `JoinPath.CECF_WEB` replaces the never-used `JoinPath.INSTITUTION`.
- `PaymentMethod.CARD` (Pesapal), `RegistrationPayment.pesapalOrderTrackingId` (mirrors
  `checkoutRequestId`'s idempotency-key role for M-Pesa).

## 3 · Payments (`packages/payments/src/pesapal.ts`)

Structured identically to `mpesa.ts`: `pesapalProvider()` gated by
`PESAPAL_PROVIDER=console|sandbox|production` with the same
never-production-from-development guard. Two-step confirmation, unlike M-Pesa's STK
callback — a Pesapal IPN carries only `OrderTrackingId`, never the result, so
`parsePesapalIpn` (sync, just extracts identifiers) is always followed by
`confirmPesapalOrder` (async, calls `GetTransactionStatus`) before anything is trusted.

## 4 · Ingestion (`packages/db/src/dal/cecf-ingest.ts`)

Deliberately thin — `startRegistration` / `updateRegistration` / `completeRegistration`
are called directly by the `services/core` routes below, unchanged. This module holds
only what's genuinely new to CECF ingestion:

- `addCecfMemberRoster(orgPartyId, members)` — adds a group's roster (beyond the
  founder, who `completeRegistration` already added) via the existing `addNewMember`,
  under a `actorType: 'STAFF'` service context. That's what matters: `groups.ts`'s
  `requireGroupOfficer` bypasses its own-officer check for `STAFF` actors, so this can
  act on a brand-new group without first being one of its officers — the same trust
  level any other staff-facing admin tool already carries. Best-effort per row: one bad
  phone number is logged and skipped, not fatal to the whole roster.
- `trySetCecfJoinFee(founderPartyId, orgPartyId, 500)` — for `feeCoverage: 'self'`,
  configures `GroupTreasuryPolicy.joinFeeKes` so future `addNewMember`/`inviteMember`
  calls default new members to `PENDING` until they pay their own KES 500. Unlike the
  roster helper, `setTreasuryPolicy` has **no staff bypass** — treasury policy is
  deliberately member-governed. This only succeeds when the registering founder chose
  an officer role (`registrantRole`); otherwise it's a no-op (audited), and a CECF
  officer sets the fee later from the group's own `/me/group/[orgId]/treasury` screen.
  Members who paid together instead (`feeCoverage: 'group'`) need none of this — one
  `RegistrationPayment` for `memberCount × 500` covers the whole team.
- `uploadCecfDocument(registrationId, doc)` — same `sniff`/`makeStorageKey`/`safeName`/
  `sha256`/`putObject` primitives `apps/app/join/upload.ts` uses, fed a base64 buffer
  (WordPress's PHP already has the bytes) instead of a multipart `File`.
- `completeCecfRegistration(registrationId, { members })` — `completeRegistration`,
  then, only for a group whose `feeCoverage` was saved as `'self'`, the join-fee
  attempt, then the roster.

## 5 · `services/core`'s `/api/cecf/*` facade

Every route sits behind one HMAC check (`X-CECF-Signature`, same
`createHmac('sha256', SECRET)` + `timingSafeEqual` shape `packages/db/src/dal/
payments.ts` already uses for payment-approval signatures) — `CECF_SERVICE_SECRET`,
held only by WordPress's server, never its browser JS. The signature covers the
**exact raw request body bytes**, not a re-serialisation of the parsed JSON —
`cecfRoutes` installs its own `addContentTypeParser` (scoped to that plugin only,
via Fastify's per-plugin encapsulation) that captures `req.rawBody` before
parsing, specifically because PHP's `json_encode` and V8's `JSON.stringify`
don't always agree on the same logical payload (Unicode escaping, float
formatting) — signing `JSON.stringify(req.body)` after the fact would routinely
reject a byte-for-byte-legitimate request. WordPress's PHP client must sign the
same string it POSTs, verbatim — see `CecfApiClient::sign()`. A GET request
(no body) signs the empty string.

| Route | Wraps |
|---|---|
| `POST /api/cecf/registration/start` | `startRegistration` + `updateRegistration` — the whole payload from `packages/domain/src/cecf-ingest.ts`'s `cecfIngestSchema` in one call, since WordPress already has everything by the time it calls this (unlike `/join`'s own multi-step wizard) |
| `POST /api/cecf/registration/:id/documents` | `uploadCecfDocument`, looped |
| `POST /api/cecf/registration/:id/pay-later` | `deferPayment` |
| `POST /api/cecf/registration/:id/progress` | `updateRegistration({ lastStep })` — best-effort drop-off ping, see §8 |
| `POST /api/cecf/registration/:id/declare-payment` | `declarePayment` (bank transfer / cash to agent) |
| `POST /api/cecf/payments/mpesa/initiate` | `initiateStkPush` + `attachRegistrationCheckoutRequestId` |
| `POST /api/cecf/payments/pesapal/initiate` | `initiatePesapalOrder` + `attachRegistrationPesapalOrder` |
| `GET /api/cecf/payments/:id/status` | `getRegistrationDetail` (polling) |
| `POST /api/cecf/registration/:id/complete` | `completeCecfRegistration` |

Unlike the Safaricom/Pesapal webhooks (always `200`, log-and-move-on — the sender is a
payment gateway that retries blindly), these routes return real `4xx`/`5xx` — a human on
the WordPress side is actively waiting on the response and needs to see a real failure.

`POST /webhooks/pesapal/ipn` sits alongside the existing `/webhooks/mpesa/stk-callback`
in `services/core/src/index.ts`, calling `confirmPesapalOrder` before trusting anything,
then `confirmRegistrationPaymentByPesapalOrderId`.

## 6 · Sequencing note

`/api/cecf/registration/:id/members` was originally sketched as its own route running
*before* `/complete`, mirroring `/join`'s step order. That doesn't work — a group's
`Organisation` doesn't exist until `completeRegistration` runs, so there is nothing to
add a roster to yet. `completeCecfRegistration` folds the roster step into `/complete`
itself instead, fed by the member list WordPress already collected client-side.

## 7 · What WordPress still owns

Everything upstream of this facade: the three registration UIs (individual / group /
business), OTP or whatever verification WordPress chooses to run before setting
`registrant.msisdnVerified`, and redirecting the browser to Pesapal's hosted page /
showing the M-Pesa "check your phone" wait. See phases 6–7 of the implementation plan
for that build.

## 8 · Surviving a refresh — client persistence + progress tracking

Added 21 August 2026. The wizard is entirely client-driven (§6) and `/start` isn't
called until the "you" step, so refreshing the tab — or closing it and coming back —
used to lose everything typed, with no server-side trace for anything before "you"
and no way for admin to tell a registration stuck on documents from one stuck on
payment.

- **`resources/js/registration.js`** now mirrors `apps/app/join`'s own `localStorage`
  resume pattern: the whole `state` object plus every named form field is written to
  `localStorage['esoqo:cecf-reg:v1']` after every step transition and field change
  (debounced), keyed by nothing more than "this browser" — there's no account to key
  it to. On load, a saved draft shows a `.callout` prompt ("Continue where you left
  off" / "Start over") before the wizard renders; picking "Continue" repopulates the
  form and jumps straight to the saved step. Uploaded document bytes are **not**
  persisted (a rejected multi-MB base64 string per file would blow past most
  browsers' 5–10MB `localStorage` quota) — a resumed draft keeps the member roster and
  every text field, but documents must be re-attached. Cleared on `finish()`, same as
  a successful `/complete`.
- **`POST /api/cecf/registration/:id/progress`** (new, §5 table) is a fire-and-forget
  ping registration.js sends after every step transition once `registrationId`
  exists, bumping `Registration.lastStep` — the same "highest step reached" counter
  `apps/app/join` already leaves behind, just driven from the client instead of a
  Server Action per step. `updateRegistration` already refuses to move it backwards,
  so a resumed-then-abandoned draft never makes admin think someone regressed.
  admin's Registrations table (`apps/admin/.../registrations/RegistrationTable.tsx`)
  surfaces this as a step label (e.g. "Step 4 of 7 · fee coverage") next to `STARTED`
  CECF rows, using the same `SEQUENCES` step order as registration.js.
