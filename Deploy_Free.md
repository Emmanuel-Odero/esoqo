# Deploying Esoko on free tiers

A separate track from `Deploy_Render.md` (the paid one), not a cheaper
version of it. Free-tier hosting has real constraints that change the
shape of the deployment, not just its price — read the **Limitations**
section before you point anyone at this for anything but a pilot,
demo, or review deployment.

---

## What's in scope, what isn't

**In scope** — the six Node services that make up the Esoko product:
`esoko-core` (Fastify), `esoko-web`, `esoko-app`, `esoko-admin`,
`esoko-store`, `esoko-jamii` (all Next.js).

**Out of scope** — CECF WordPress (`services/cecf-wordpress` +
`cecf-mariadb`). Self-hosted MySQL with a persistent disk has no free
option on Render, Fly, or any comparable platform — a free "database"
that isn't actually free is just a service that silently loses your
data. It stays on its existing paid Render setup; this doc doesn't
touch it. Revisit that separately if it needs its own free/cheap host.

---

## The three pieces, three providers

| Piece | Provider | Why |
|---|---|---|
| 6 web services | **Render**, `plan: free` | Same deploy flow as today (`render-free.yaml`), zero new tooling. |
| Postgres | **Neon** | Render's own Postgres is free for 30 days, then it's deleted. Neon's free tier (0.5 GB storage, generous compute hours) doesn't expire. |
| Redis | **Upstash** | Same story — Render Redis isn't permanently free. Upstash's free tier (256 MB, 500k commands/mo) is, and speaks the same `rediss://` TLS protocol `ioredis` already auto-detects — **zero code changes**. |

### 1. Neon — Postgres

1. Create a project at [neon.tech](https://neon.tech) (free tier, no card required).
2. Neon gives you two connection strings for the same database:
   - **Pooled** (hostname ends `-pooler`) → `DATABASE_URL`. This is
     what every request-serving service uses; Neon's pooler is
     PgBouncer-compatible, so the existing `?pgbouncer=true` query
     param the app already appends still applies.
   - **Direct** (no `-pooler`) → `DIRECT_DATABASE_URL`. Migrations
     only — `prisma migrate deploy` needs a direct connection.
3. `SHADOW_DATABASE_URL`: only used by `prisma migrate dev` (never
   runs in production — `migrate deploy` doesn't need it). Either
   create a second free Neon branch for it, or point it at the same
   value as `DIRECT_DATABASE_URL`; it's inert on Render either way.
4. Neon **autosuspends** an idle compute after 5 minutes. Combined
   with Render's own free-service spin-down, the very first request
   after a quiet period pays two cold starts, not one — see
   Limitations below.

### 2. Upstash — Redis

1. Create a free database at [upstash.com](https://upstash.com) —
   pick a region close to Render's (Frankfurt/Oregon, matching
   whatever region you deploy the web services to; cross-region adds
   real latency to every session read).
2. Copy the **TLS** connection string — starts `rediss://`, not
   `redis://`. `packages/auth/src/redis.ts` constructs `ioredis` from
   `REDIS_URL` directly and `ioredis` picks TLS from the URL scheme
   automatically. Nothing to change in code.
3. Free tier caps: 256 MB, 500k commands/month, 10k daily commands on
   the lowest free band (check current limits on their pricing page —
   they change). Sessions, OTP state, and rate-limit counters all live
   here; a genuinely busy pilot can hit the monthly cap. There's no
   silent failure mode to worry about beyond that — Upstash rejects
   over-cap requests with a clear error, it doesn't corrupt data.

### 3. Render — the six web services

```sh
render blueprint apply --repo <your-fork-url> -f render-free.yaml
```

Or in the Dashboard: **New → Blueprint**, point it at this repo, and
select `render-free.yaml` when prompted (Render defaults to
`render.yaml`; the paid blueprint stays untouched at that filename).

After the first apply, set the `sync: false` secrets on **every** one
of the six services in the Dashboard (Environment tab) — Blueprint
apply creates the placeholders but never fills in a secret for you:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `DIRECT_DATABASE_URL` | Neon direct connection string |
| `SHADOW_DATABASE_URL` | Neon direct connection string (or a second branch) |
| `REDIS_URL` | Upstash `rediss://` connection string |
| `SESSION_SECRET`, `OTP_PEPPER`, `AUDIT_CHAIN_SEED` | `openssl rand -hex 32`, one value shared across all six services |

Then run migrations once, from your own machine, against Neon's direct URL:

```sh
DATABASE_URL="<neon-direct-url>" \
DIRECT_DATABASE_URL="<neon-direct-url>" \
pnpm --filter @esoko/db exec prisma migrate deploy
```

---

## Limitations — read this before calling it "production"

**Render's free web services spin down after ~15 minutes idle.**
The next request pays a 10-60s cold start (pnpm/Next.js boot from
scratch — there's no warm process to resume). With six independent
services, a user's first click can wake `esoko-app`, then their next
navigation wakes `esoko-core`, and so on — every service sleeps on its
own clock. This is fine for a demo someone clicks through once; it is
not fine for a USSD gateway's 2-second aggregator SLA, which is the
entire premise `docs/adr/0001-two-plane-architecture.md` was written
to protect. **This blueprint does not honor that ADR.** It's the
explicit, accepted trade-off of a free deployment, not an oversight —
if you're evaluating this for anything with a real SLA, it needs the
paid `render.yaml` (or Fly.io's always-on free VM allowance, which
comes closer but wasn't chosen here — see the design conversation for
why).

**Neon's compute autosuspends too.** A cold DB query on top of a cold
web service can mean two waits stacked on the very first request after
idle time, not one.

**No horizontal scaling on free plans.** One instance per service,
no redundancy — a crashed instance means downtime until Render
restarts it, not an automatic failover.

**Outbound integrations still need real credentials regardless of
plan.** SMS (`SMS_PROVIDER`), M-Pesa, and R2 storage aren't free
anywhere — `SMS_PROVIDER=console` (the default here) logs OTPs to the
service's own log stream instead of sending them, which is fine for a
click-through demo and useless for anyone testing sign-in with a real
phone.

**pnpm workspace builds are slow on free CPU.** Render's free build
minutes are shared across all six services; expect first-deploy builds
in the several-minutes range, not seconds.
