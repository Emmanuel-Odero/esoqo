# Esoqo

A consented credential-and-cashflow registry for Kenya's informal economy —
and, growing out of the same Party/Enterprise records, a small merchant
marketplace with its own storefronts, checkout and PoS terminal.

Traders, chamas and small businesses hold their registrations, permits and
trading record in one place, reachable from a KES 1,000 handset — and decide,
each time, who is allowed to see any of it. A registered trader can also open
a store on the same account, with no separate signup.

---

## Run it

```bash
cp .env.example .env
pnpm install
pnpm stack:up            # postgres · pgbouncer · redis · mailhog · mock-sms
pnpm db:generate
pnpm db:migrate
pnpm db:seed             # reference data, plus clearly-labelled "Demo" content — see below
pnpm dev
```

| Surface | URL |
|---|---|
| Public site | http://localhost:3000 |
| Subject app (join flow) | http://localhost:3001/join |
| Operations | http://localhost:3002 |
| Store — merchant, storefront, PoS | http://localhost:3003 |
| Mail catcher | http://localhost:8025 |
| SMS catcher (`SMS_PROVIDER=mock`) | http://localhost:8026 |
| Database UI | `docker compose --profile tools up -d adminer` → :8080 |

`pnpm db:seed` now shells out to `services/core-go`'s Go seeder
(`services/core-go/internal/seed` — see `docs/adr/0005-mobile-api-in-go.md`;
`packages/db/prisma/seed.ts`/`seed-demo.ts` were retired once it covered
the same ground). It creates the one staff login the admin app needs on
first run, reference data (counties/issuers/markets/commodities/pricing
rules — no fake registrations or real parties), and — folded in from
what used to be a separate `seed:demo` step — a handful of
clearly-"Demo"-prefixed ticket orgs, listings and stores so the mobile
app and web walkthroughs have real content to click through:

| App | Login | Credential |
|---|---|---|
| Operations (`:3002`) | `ops@esoqo.co.ke` | PIN `482915` — or whatever `SEED_ADMIN_PIN` was set to at seed time |
| Mobile app — buyer | `+254700200200` | PIN `200200` |
| Mobile app — merchant | `+254700300300` | PIN `300300` |
| Ticketing staff (Demo Scanner/Manager/Admin) | org PIN sign-in | `111111` / `222222` / `333333` |

`packages/db/prisma/seed-abledfirst.ts` and `seed-media.ts` are
untouched — Our Jamii CMS content (page-builder text, media-placeholder
patterns), not commerce/ticketing/groups, so they're outside
`services/core-go`'s domain. Run them the same way as before
(`pnpm --filter @esoqo/db seed:abledfirst` / `seed:media`).

Change this PIN (`SEED_ADMIN_PIN` env var before seeding, or
`SEED_ADMIN_HASH` for a precomputed Argon2id hash) before any deployment —
see the checklist at the bottom of this file.

`SMS_PROVIDER=console` (the default) prints OTPs to the terminal — read the
code there rather than the browser; it is never returned in the response,
in any run mode.

`SMS_PROVIDER=mock` sends SMS to a local catcher instead (`mosip/mock-smtp-sms`,
started with the rest of the stack) — the SMS equivalent of the mail catcher.
Read the actual message text, including the OTP code, at
http://localhost:8026 rather than the terminal. Still never dials a real
gateway; development ignores any other `SMS_PROVIDER` value.
`MPESA_PROVIDER=console` does the same for the store's STK push checkout:
it logs the prompt and auto-confirms locally instead of calling Safaricom.

---

## Deployed

Live on Render — `esoqo-web`, `esoqo-app`, `esoqo-admin` and `esoqo-core`
each deploy from the **`render`** branch against one shared `esoqo-db`
Postgres instance. `render.yaml` is the infra-as-code definition.
**`apps/store` has no Render service yet** — the merchant storefront and
PoS terminal run locally (`:3003`) but aren't reachable in production
until one is added.

`render` does not track `main` automatically — merging to `main` does not
deploy anything by itself. Fast-forward `render` to `main` and push it to
trigger a real deploy:

```bash
git checkout render && git merge --ff-only main && git push origin render
```

**Migrations do not run automatically either.** Render's build command only
runs `prisma generate` (regenerates the client's types) — never
`prisma migrate deploy`. A schema change that reaches `render` without a
manually-run `migrate deploy` against production first will build and deploy
fine, then throw on the very first query that touches the new column or
table — this has actually happened, more than once. After any migration
lands on `render`, before trusting the deploy:

```bash
DATABASE_URL="<production DATABASE_URL, from Render → esoqo-db → Connect>" \
  pnpm --filter @esoqo/db exec prisma migrate deploy
```

Always take a backup first for anything beyond a trivial additive migration —
`pg_dump` against the same URL, or a snapshot from the Render dashboard.

Active feature branches merge to `main` first; commerce/marketplace work
specifically lands on **`estore`** before either — see that branch for
eStores admin work not yet in `main`.

---

## Status — what is real and what is not

Honesty here matters more than a tidy checklist. Nothing below is padded.

### Working
- **Docker stack** — Postgres 16, PgBouncer (transaction mode), Redis, MailHog, mock-sms
- **Full domain schema** — Party, Attestation, ConsentGrant, JournalEntry/Posting, AuditEvent and the rest, migrated and seeded
- **Data Access Layer** with `requireCapability()` deny-by-default, enforced by a lint rule that fails CI
- **Hash-chained audit log**, with a verifier that names the first broken link
- **Argon2id** PIN hashing, Redis sessions with instant revocation
- **OTP** with per-number and per-IP limits, exponential cooldown, prefix allow-listing and a hard daily spend cap
- **Public site** — all seven pages as React Server Components: landing, prices, counties, institutions, verify, help, trust
- **Six-step join flow** — real Server Actions, real database writes, USSD-now-or-later, inline OTP verification
- **Groups** — chamas, self-help groups, SACCOs. Staff can register a group
  directly (not only via someone joining as one), add members by searching
  existing subjects or typing a new one in, assign a custom role beyond the
  fixed office-bearer set (`OTHER` + free text, e.g. "Youth rep"), and
  upload/view group documents (constitution, minutes, registration
  certificate) with in-browser preview.
- **Registrations** — every field `updateRegistration` accepts is now
  actually editable from the admin record (phone and email included, gated
  behind `party.pii`), not just a subset. Documents uploaded during the
  join flow are re-parented to the real Party the moment a registration
  completes, so they show up on that person's or group's own record, not
  only on the registration that created it.
- **Operations dashboard** — funnel, county and segment breakdowns, opt-in
  rates, live audit log with chain status. Responsive down to an iPhone
  SE — collapsible sidebar sections, an off-canvas nav drawer below
  900px, and a hamburger toggle; nothing in `apps/admin` assumes a desktop
  window anymore.
- **Accessibility primitives** — route announcement, focus management, live regions, money spelled for screen readers
- **Certificate verification** at `/verify` — public, no account, reads real attestations
- **Segment finder** on the landing page — 92 segments, 595 aliases, and it can never say no
- **63-icon system.** No emoji anywhere
- **Mini-store** — a Store belongs to an Enterprise a Party already holds,
  not a separate signup. Merchant wizard, dashboard, themed public
  storefront, M-Pesa STK checkout, and an offline-capable PoS terminal
  (IndexedDB outbox) are real, wired to the DAL. Money posts through the
  existing `Account`/`JournalEntry`/`Posting` tables, not a new ledger.
  `pricing_rule` rows (admin-editable) drive every price shown — nothing
  is hardcoded. `MPESA_PROVIDER=console` (default) auto-confirms locally,
  same rule as `SMS_PROVIDER=console`; `sandbox` makes real Daraja sandbox
  calls. Wildcard-subdomain DNS is not cut over — only the free
  `esoko.global/@slug` path is reachable until that's pointed at a deployment.
  **`apps/store` itself has no Render service** — everything above is real
  and working locally, but no real buyer can reach a storefront or a
  merchant's PoS terminal until one is provisioned. See *Deployed*.

### Built, not yet in `main` — branch `estore`
An admin-side commerce console, on top of the mini-store data above.
Real, exercised against seeded data end to end, not a mock — just not
merged past `main`'s review yet:
- **Platform overview** — gross sales with week-over-week change, platform
  commission earned (at the live `PLATFORM_FEE_PCT` rate), store
  status/sector breakdowns, a revenue trend chart, a top-stores leaderboard
- **Per-store performance dashboard** — the same revenue chart scoped to
  one store, order-status funnel, payment-method split, top products,
  buyer/repeat-buyer counts, fulfilment rate, and alerts for low stock and
  unreconciled PoS sales (`syncStatus: CONFLICT`)
- **Product moderation** — a retail category taxonomy separate from the
  92-segment trade dictionary, a staff-only suspend a merchant can't lift
  themselves, and a running comment thread visible to the seller
- **Order rerouting** — staff can flag an order the original store can't
  fulfil and hand it to another vendor carrying the same item, but only
  before payment moves; a paid order already has a `JournalEntry` crediting
  the original merchant, so reassigning it after that would corrupt ledger
  history rather than correct it — the UI says so instead of allowing it

### Scaffolded, not built
`services/ledger`, `services/channels`, `services/credential`, `services/workers`
each carry a README stating what they will do and why they are not started.
The mini-store's ledger postings above are the interim TypeScript
implementation that migrates into `services/ledger` later — see that
service's README.

### Deliberately absent
No seeded registrations. No fake prices. No demo users. A stakeholder who
mistakes seeded rows for traction makes decisions on fiction, and you are the
one who has to correct it later.

---

## The three rules

**1 · Authorisation lives in the Data Access Layer.**
Not in `proxy.ts`. Next.js middleware has had two distinct authorisation-bypass
classes in sixteen months — CVE-2025-29927 and the July 2026 advisory set. The
lint rule in `@esoqo/config` forbids importing Prisma outside `packages/db`,
and CI fails on violation. See ADR-0003.

**2 · Balances are derived, never stored.**
There is no balance column and there must never be one. Every figure comes from
summing `Posting`.

**3 · If it cannot work on USSD, it is not a core feature.**
The person most likely to be excluded by a channel decision is the person most
likely to be harmed by exclusion.

---

## Layout

```
apps/
  web/        Public site
  app/        Subject PWA — join flow, record, wallet
  admin/      Operations, CECF programme management, eStores commerce oversight
  store/      Merchant storefronts, checkout, PoS terminal
services/
  core/       Domain API, authorisation, DAL          · TypeScript
  ledger/     Double-entry, escrow, settlement        · Rust
  channels/   USSD + SMS + WhatsApp                   · Rust
  credential/ SD-JWT VC issuance and revocation       · TypeScript
  workers/    Reconciliation, OCR, notifications      · Python
packages/
  db/         Schema, migrations, DAL, audit chain
  domain/     Zod schemas · 92-segment dictionary · MSISDN handling
  auth/       Argon2id, sessions, OTP, rate limits
  payments/   M-Pesa Daraja — STK push, callback parsing
  a11y/       Route announcer, focus, live regions
  ui/         Design tokens and icon system
  config/     ESLint (architecture as lint rules), TS configs
docs/adr/     Decision records
```

Three languages, each with a stated job and a rejected alternative — ADR-0004.

---

## Before this touches a real person

Registration collects names and phone numbers, so **Data Protection Act
obligations begin at the first record, not at launch.**

- [ ] ODPC registration filed
- [ ] Privacy notice on the join form, in plain English and Kiswahili
- [ ] Named Data Protection Officer contact published
- [ ] Deletion-on-request path tested end to end (`erasePartyData` exists; the intake process does not)
- [ ] `SMS_PROVIDER` switched off `console`
- [ ] Seeded ops PIN changed
- [ ] Real secrets generated — `openssl rand -hex 32`

Ten minutes of work now, against a genuinely bad conversation later.
