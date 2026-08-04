# Esoko

A consented credential-and-cashflow registry for Kenya's informal economy.

Traders, chamas and small businesses hold their registrations, permits and
trading record in one place, reachable from a KES 1,000 handset — and decide,
each time, who is allowed to see any of it.

---

## Run it

```bash
cp .env.example .env
pnpm install
pnpm stack:up            # postgres · pgbouncer · redis · mailhog
pnpm db:generate
pnpm db:migrate
pnpm db:seed             # reference data only — no fake users
pnpm dev
```

| Surface | URL |
|---|---|
| Public site | http://localhost:3000 |
| Subject app (join flow) | http://localhost:3001/join |
| Operations | http://localhost:3002 |
| Store — merchant, storefront, PoS | http://localhost:3003 |
| Mail catcher | http://localhost:8025 |
| Database UI | `docker compose --profile tools up -d adminer` → :8080 |

`SMS_PROVIDER=console` prints OTPs to the terminal. It also returns the code
to the browser so you can test without a live SMS account — that path is
gated on the env var and must never be enabled in a deployed environment.
`MPESA_PROVIDER=console` does the same for the store's STK push checkout:
it logs the prompt and auto-confirms locally instead of calling Safaricom.

---

## Status — what is real and what is not

Honesty here matters more than a tidy checklist. Nothing below is padded.

### Working
- **Docker stack** — Postgres 16, PgBouncer (transaction mode), Redis, MailHog
- **Full domain schema** — Party, Attestation, ConsentGrant, JournalEntry/Posting, AuditEvent and the rest, migrated and seeded
- **Data Access Layer** with `requireCapability()` deny-by-default, enforced by a lint rule that fails CI
- **Hash-chained audit log**, with a verifier that names the first broken link
- **Argon2id** PIN hashing, Redis sessions with instant revocation
- **OTP** with per-number and per-IP limits, exponential cooldown, prefix allow-listing and a hard daily spend cap
- **Public site** — all seven pages as React Server Components: landing, prices, counties, institutions, verify, help, trust
- **Six-step join flow** — real Server Actions, real database writes, USSD-now-or-later, inline OTP verification
- **Operations dashboard** — funnel, county and segment breakdowns, opt-in rates, live audit log with chain status
- **Accessibility primitives** — route announcement, focus management, live regions, money spelled for screen readers
- **Certificate verification** at `/verify` — public, no account, reads real attestations
- **Segment finder** on the landing page — 92 segments, 595 aliases, and it can never say no
- **63-icon system.** No emoji anywhere
- **Mini-store (foundation phase)** — a Store belongs to an Enterprise a
  Party already holds, not a separate signup. Merchant wizard, dashboard,
  themed public storefront, M-Pesa STK checkout, and an offline-capable PoS
  terminal (IndexedDB outbox) are real, wired to the DAL. Money posts
  through the existing `Account`/`JournalEntry`/`Posting` tables, not a new
  ledger. `pricing_rule` rows (admin-editable, `apps/admin` → Stores &
  pricing) drive every price shown — nothing is hardcoded.
  `MPESA_PROVIDER=console` (default) auto-confirms locally, same rule as
  `SMS_PROVIDER=console`; `sandbox` makes real Daraja sandbox calls.
  Wildcard-subdomain DNS is not cut over — only the free
  `esoko.global/@slug` path is reachable until that's pointed at a deployment.

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
lint rule in `@esoko/config` forbids importing Prisma outside `packages/db`,
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
  admin/      Operations + CECF programme management
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
