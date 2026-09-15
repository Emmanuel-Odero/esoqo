# Deploying Esoqo to Vercel

This guide covers deploying the three Next.js apps (`web`, `app`, `admin`) to Vercel.
The Fastify core service must run separately — Vercel does not support long-running Node processes.

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│   Vercel (Serverless Functions + Edge Middleware)        │
│                                                          │
│   esoko-web    (esoqo.co.ke)         public site         │
│   esoko-app    (app.esoqo.co.ke)    PWA surface          │
│   esoko-admin  (ops.esoqo.co.ke)    operations panel     │
│                                                          │
│   All three share:                                       │
│   ─ @esoqo/db   (Prisma → PostgreSQL via PgBouncer)     │
│   ─ @esoqo/auth (Upstash Redis for sessions/OTP)        │
│   ─ @esoqo/ui, @esoqo/domain, @esoqo/a11y               │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│   Core Service (Railway / Fly.io / VPS)  │
│                                          │
│   Fastify HTTP server (port 4000)        │
│   ─ /health, /ready, domain API          │
└──────────────────────────────────────────┘
```

---

## Prerequisites

- Node.js >= 20.11
- pnpm >= 9.12.0
- A PostgreSQL provider with PgBouncer support (Neon, Supabase, AWS RDS Proxy)
- A Redis provider with HTTP API (Upstash — required for Vercel Serverless)
- Vercel account + Vercel CLI (`pnpm add -g vercel`)
- GitHub repository connected to Vercel

---

## 1. Database — PostgreSQL (Neon)

Neon is the recommended Postgres provider — it ships with PgBouncer built in.

### Setup

1. Create a Neon project at [neon.tech](https://neon.tech)
2. Copy both connection strings from the Neon dashboard:

```
DATABASE_URL          = postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/esoqo?pgbouncer=true&connection_limit=10
DIRECT_DATABASE_URL   = postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/esoqo
```

The `?pgbouncer=true` query parameter tells Prisma to use PgBouncer-compatible mode
(transaction mode, no prepared statements).

### Run migrations

```sh
pnpm db:migrate
```

Or on Vercel during build (see Build section below), run:

```sh
pnpm --filter @esoqo/db exec prisma migrate deploy
```

### Seed the admin account

```sh
SEED_ADMIN_PIN="<your-admin-pin>" pnpm db:seed
```

The seed creates `ops@esoqo.co.ke` with full capabilities.

---

## 2. Redis — Upstash (Required for Vercel)

The project uses `ioredis` (TCP-based), which **does not work** on Vercel Serverless
or Edge Functions. You must switch to Upstash Redis (HTTP-based).

### 2.1 Create an Upstash Redis database

1. Go to [upstash.com](https://upstash.com), create a Redis database
2. Copy the **REST URL** and **REST Token** from the Upstash console

### 2.2 Install the Upstash Redis client

```sh
pnpm --filter @esoqo/auth add @upstash/redis
```

### 2.3 Update the Redis client — `packages/auth/src/redis.ts`

Replace the ioredis-based client with Upstash:

```ts
import 'server-only';
import { Redis } from '@upstash/redis';

const g = globalThis as unknown as { __esoqoRedis?: Redis };
export const redis =
  g.__esoqoRedis ??
  new Redis({
    url: process.env.REDIS_URL!,
    token: process.env.REDIS_TOKEN!,
  });
if (process.env.NODE_ENV !== 'production') g.__esoqoRedis = redis;
```

### 2.4 Add `REDIS_TOKEN` to turbo.json

In `turbo.json`, add `"REDIS_TOKEN"` to the `globalEnv` array.

### 2.5 Add env vars to Vercel

| Variable | Value |
|----------|-------|
| `REDIS_URL` | `https://us1-clever-marmot-12345.upstash.io` |
| `REDIS_TOKEN` | `AXZ...your-rest-token...` |

### 2.6 (Optional) Verify Redis session compatibility

The session module in `packages/auth/src/session.ts` uses `redis.setex`, `redis.get`,
`redis.del`, `redis.sadd`, `redis.smembers`, `redis.srem` — all of these are fully
supported by `@upstash/redis`.

---

## 3. Core Service — Deploy Separately

The Fastify core service (`services/core`) **cannot** run on Vercel. Deploy it on
a platform that supports long-running Node processes:

### Option A: Railway (recommended for simplicity)

1. Create a new Railway project from your GitHub repo
2. Set root directory to `services/core`
3. Build command: `pnpm install && pnpm --filter @esoqo/core-service build`
4. Start command: `pnpm --filter @esoqo/core-service start`
5. Add the same env vars (minus Next.js public vars)

### Option B: Fly.io

1. Create `services/core/Dockerfile`
2. Deploy with `fly launch`

### Option C: Render Web Service

1. Create a new Web Service
2. Point to `services/core`
3. Build command: `pnpm install && pnpm --filter @esoqo/core-service build`
4. Start command: `pnpm --filter @esoqo/core-service start`

### Core service env vars

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Pooled connection via PgBouncer |
| `DIRECT_DATABASE_URL` | Direct connection for health checks |
| `REDIS_URL` | Upstash REST URL |
| `REDIS_TOKEN` | Upstash REST token |
| `SESSION_SECRET` | Session encryption key |
| `OTP_PEPPER` | OTP HMAC pepper |
| `AUDIT_CHAIN_SEED` | Audit chain genesis seed |
| `LOG_LEVEL` | `info` (production) or `debug` |
| `NODE_ENV` | `production` |

Once deployed, set `CORE_API_URL` in the Vercel apps to point to this service.

---

## 4. Vercel Project Setup

Each Next.js app deploys as a separate Vercel project. Create three projects:

| Project | Domain | Source directory |
|---------|--------|-----------------|
| `esoko-web` | `esoqo.co.ke` | `apps/web` |
| `esoko-app` | `app.esoqo.co.ke` | `apps/app` |
| `esoko-admin` | `ops.esoqo.co.ke` | `apps/admin` |

### 4.1 Create `vercel.json` per app

Each app needs its own `vercel.json`:

**`apps/web/vercel.json`** (same pattern for `apps/app` and `apps/admin`):

```json
{
  "framework": "nextjs",
  "buildCommand": "cd ../.. && pnpm build --filter=@esoqo/web",
  "installCommand": "cd ../.. && pnpm install",
  "outputDirectory": ".next",
  "regions": ["iad1"]
}
```

> `regions: ["iad1"]` pins all apps to the same AWS region for lowest latency between
> them and your database. Adjust to match your Postgres provider's region.

### 4.2 Root-level Vercel config (alternative monorepo setup)

If you prefer a single Vercel project with monorepo settings, add to **root** `vercel.json`:

```json
{
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install",
  "framework": "nextjs"
}
```

Then configure each app as a separate Vercel project pointing to its subdirectory
via the Vercel dashboard (Settings → Git → Root Directory).

### 4.3 Prisma generate during build

Add a `postinstall` script to `packages/db/package.json` so Prisma Client is
generated automatically after `pnpm install`:

```json
"scripts": {
  "postinstall": "prisma generate"
}
```

If `postinstall` is undesirable, add `prisma generate` to the build pipeline in
`turbo.json`:

```json
{
  "tasks": {
    "@esoqo/db#build": {
      "outputs": ["node_modules/.prisma/**"],
      "cache": false
    }
  }
}
```

Then add a build script to `packages/db/package.json`:

```json
"scripts": {
  "build": "prisma generate"
}
```

### 4.4 Root `vercel.json` (create in project root)

```json
{
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install",
  "framework": "nextjs"
}
```

### 4.5 Environment variables for all Vercel projects

Set these in each Vercel project's dashboard (Settings → Environment Variables).

**Required in all three apps:**

| Variable | Example / Source |
|----------|-----------------|
| `DATABASE_URL` | `postgresql://…?pgbouncer=true&connection_limit=10` |
| `DIRECT_DATABASE_URL` | `postgresql://…` (no pgbouncer query) |
| `REDIS_URL` | `https://us1-xxxx.upstash.io` |
| `REDIS_TOKEN` | From Upstash dashboard |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `OTP_PEPPER` | `openssl rand -hex 32` |
| `AUDIT_CHAIN_SEED` | `openssl rand -hex 32` |
| `SMS_PROVIDER` | `console` (dev) or `africastalking` (prod) |
| `SMS_API_KEY` | From Africa's Talking |
| `SMS_USERNAME` | From Africa's Talking |
| `SMS_SENDER_ID` | `ESOQO` |
| `NEXT_PUBLIC_APP_URL` | `https://app.esoqo.co.ke` |
| `NEXT_PUBLIC_WEB_URL` | `https://esoqo.co.ke` |
| `CORE_API_URL` | `https://core.esoqo.co.ke` (or Railway URL) |
| `SEED_ADMIN_PIN` | Admin PIN for seeding |

**Additional for `esoko-admin` only:**

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_APP_URL` | `https://app.esoqo.co.ke` |
| `NEXT_PUBLIC_WEB_URL` | `https://esoqo.co.ke` |

### 4.6 Node.js version

Set the Node.js version to `20.x` in Vercel:
- Project Settings → General → Node.js Version → `20.x`

Or via `.nvmrc` in the project root:

```
20.11
```

Or via `engines` in root `package.json` (already set to `>=20.11`).

---

## 5. Prisma + Vercel Build

### 5.1 Prisma schema considerations

The schema uses `previewFeatures = ["relationJoins"]`. Ensure your Prisma version
(specified in `packages/db/package.json`) supports this. The current version is
`6.1.0`, which supports it.

### 5.2 Shadow database (for migrations)

If you need to run `prisma migrate dev` (local development), the schema references
`shadowDatabaseUrl = env("SHADOW_DATABASE_URL")`. For Vercel deployments, you only
run `prisma migrate deploy` (no shadow DB needed). Set `SHADOW_DATABASE_URL` locally
or in CI to a separate Neon branch.

### 5.3 Build cache

Use Vercel's build caching. The Turbo cache in `.turbo/` is ignored by `.gitignore`.
On Vercel, the entire monorepo is cloned fresh each build, so the Turbo cache won't
persist across builds unless you configure remote caching (not required).

---

## 6. CSP / Security Headers

The Next.js configs already set security headers. For production, you may want to
tighten the Content-Security-Policy. Currently `contentSecurityPolicy: false` is
passed to Fastify's helmet in the core service — the Next.js apps do not set CSP.

If you need CSP, add it in each app's `next.config.mjs`:

```js
async headers() {
  return [{
    source: '/:path*',
    headers: [
      // existing headers…
      {
        key: 'Content-Security-Policy',
        value: "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.upstash.io;",
      },
    ],
  }];
}
```

---

## 7. Deployment steps

### 7.1 Prepare the code

```sh
# Switch to the main branch
git checkout main

# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Run typecheck
pnpm typecheck

# Build locally to verify
pnpm build
```

### 7.2 Set up the production database

```sh
# Run migrations against the production database
DATABASE_URL="<production-direct-url>" \
DIRECT_DATABASE_URL="<production-direct-url>" \
pnpm --filter @esoqo/db exec prisma migrate deploy
```

### 7.3 Seed the admin account

```sh
DATABASE_URL="<production-pooled-url>" \
DIRECT_DATABASE_URL="<production-direct-url>" \
SEED_ADMIN_PIN="<your-pin>" \
SEED_ADMIN_HASH="<pre-computed-argon2-hash>" \
pnpm db:seed
```

To generate the hash locally:

```sh
node -e "const {hash} = require('@node-rs/argon2'); \
hash('<your-pin>', {memoryCost: 19456, timeCost: 2, parallelism: 1}).then(console.log)"
```

Set `SEED_ADMIN_HASH` in Vercel env vars so that any future seed (e.g., ephemeral
preview environments) produces the same admin credential.

### 7.4 Connect Vercel to GitHub

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the `esoko-254` repository
3. Configure each project:
   - **esoko-web**: Root directory = `apps/web`, Framework = Next.js
   - **esoko-app**: Root directory = `apps/app`, Framework = Next.js
   - **esoko-admin**: Root directory = `apps/admin`, Framework = Next.js
4. Add environment variables from §4.5 for each project
5. Deploy

### 7.5 Custom domains

After the initial deploy succeeds, add custom domains in Vercel:

| Project | Domain |
|---------|--------|
| esoko-web | `esoqo.co.ke` |
| esoko-app | `app.esoqo.co.ke` |
| esoko-admin | `ops.esoqo.co.ke` |

Update DNS — Vercel will provide the target records.

### 7.6 Environment variables per environment

Use Vercel's environment variable scoping:

| Variable | Preview | Production |
|----------|---------|------------|
| `DATABASE_URL` | Neon branch DB | Production DB |
| `NEXT_PUBLIC_WEB_URL` | `https://preview-web.vercel.app` | `https://esoqo.co.ke` |
| `NEXT_PUBLIC_APP_URL` | `https://preview-app.vercel.app` | `https://app.esoqo.co.ke` |
| `CORE_API_URL` | Staging core URL | Production core URL |

---

## 8. Post-deployment verification

### 8.1 Health check

```sh
curl https://esoqo.co.ke/help
# Should return the help page

curl https://ops.esoqo.co.ke
# Should redirect to sign-in page
```

### 8.2 Admin login

1. Navigate to `https://ops.esoqo.co.ke/signin`
2. Sign in with `ops@esoqo.co.ke` and the PIN you set during seeding
3. Verify the dashboard loads with staff list, registration stats, etc.

### 8.3 Verify Redis connectivity

Trigger an OTP request (sign-in flow on `app.esoqo.co.ke/signin`). Check Upstash
dashboard for the OTP state keys appearing in Redis.

### 8.4 Verify core service connectivity

```sh
curl https://<core-service-url>/health
# Expected: {"ok":true,"service":"core",...}
```

---

## 9. Troubleshooting

### Build fails with "Cannot find module '@esoqo/db'"

Ensure `transpilePackages` in `next.config.mjs` includes all workspace dependencies.
The current config includes `@esoqo/ui`, `@esoqo/a11y`, `@esoqo/domain`. If other
packages are needed (e.g., `@esoqo/db`, `@esoqo/auth`), add them.

### Prisma Client not found during build

Add `prisma generate` as a `postinstall` script in `packages/db/package.json`.

### Redis connection errors on Vercel

You are using `ioredis` (TCP-based) instead of `@upstash/redis` (HTTP-based).
Follow §2 above to migrate.

### "Response can't return body in Edge Middleware" warnings

The proxy in `apps/app/proxy.ts` returns `new NextResponse('Bad request', { status: 400 })`
from Edge Middleware. This is allowed — Vercel Edge Middleware can return responses
for non-page routes.

### Cold start latency

Prisma + Upstash Redis + Neon Postgres should have acceptable cold starts (~300-800ms
on first invocation). If latency is an issue, consider:
- Vercel Pro (more memory, faster cold starts)
- Neon's prepared statement pooling
- Upstash Redis global replication

---

## 10. Files changed for Vercel compatibility

| File | Change |
|------|--------|
| `packages/auth/src/redis.ts` | Replace `ioredis` with `@upstash/redis` |
| `packages/db/package.json` | Add `postinstall: "prisma generate"` |
| `apps/web/vercel.json` | Create Vercel config |
| `apps/app/vercel.json` | Create Vercel config |
| `apps/admin/vercel.json` | Create Vercel config |
| `turbo.json` | Add `REDIS_TOKEN` to `globalEnv` |

---

## 11. Production checklist

- [ ] Secrets generated (`SESSION_SECRET`, `OTP_PEPPER`, `AUDIT_CHAIN_SEED`)
- [ ] Redis migrated to Upstash (ioredis → @upstash/redis)
- [ ] Database migrated and seeded with known admin PIN
- [ ] Core service deployed and reachable via `CORE_API_URL`
- [ ] SMS provider switched from `console` to `africastalking`
- [ ] OTP daily spend cap set (`OTP_DAILY_SPEND_CAP_KES`)
- [ ] Custom domains configured in Vercel
- [ ] CSP headers reviewed
- [ ] Monitoring set up (Vercel Analytics, Sentry, or similar)
- [ ] Daily database backups configured (Neon point-in-time recovery)
