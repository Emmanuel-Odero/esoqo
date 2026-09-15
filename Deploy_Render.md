# Deploying Esoqo to Render

This guide covers deploying all Esoqo services to [Render](https://render.com).
Unlike Vercel, Render runs **long-lived Node processes**, so the Fastify core
service and `ioredis` Redis client work without modification.

---

## Architecture on Render

```
┌──────────────────────────────────────────────────────────┐
│   Render Web Services                                    │
│                                                          │
│   esoko-web     (esoqo.co.ke)       Next.js SSR app      │
│   esoko-app     (app.esoqo.co.ke)   Next.js SSR app      │
│   esoko-admin   (ops.esoqo.co.ke)   Next.js SSR app      │
│   esoko-core    (core.esoqo.co.ke)  Fastify API           │
│                                                          │
│   All four share:                                        │
│   ─ Render Managed PostgreSQL                            │
│   ─ Render Managed Redis                                 │
└──────────────────────────────────────────────────────────┘
```

### Why Render works without changes

| Component | Render | Vercel |
|-----------|--------|--------|
| Next.js SSR | ✅ Full Node process | ✅ Serverless Functions |
| Fastify core | ✅ Full Node process | ❌ Not supported |
| `ioredis` (TCP) | ✅ Works | ❌ Edge not supported |
| Prisma + PgBouncer | ✅ Works | ✅ Works |
| Long-running processes | ✅ Native | ❌ 60s function limit |

---

## Prerequisites

- Node.js >= 20.11
- pnpm >= 9.12.0
- Render account
- GitHub repository connected to Render
- `render.yaml` (infrastructure as code) — or use the Render Dashboard

---

## 1. Database — Render Managed PostgreSQL

### Provision

1. In Render Dashboard, create a new **PostgreSQL**
2. Choose region closest to your users (e.g., `Frankfurt` or `Oregon`)
3. Plan: Starter (512 MB RAM, $7/mo) or higher
4. Note the **Internal Database URL** and **Public Database URL** from the connection details

Render PostgreSQL is fully managed — no PgBouncer needed for the connection counts
of a Starter instance. If you still want PgBouncer (recommended for production with
many concurrent connections), follow step 1.1 below.

### 1.1 (Optional) PgBouncer sidecar

If you expect >20 concurrent connections, deploy a PgBouncer sidecar:

Create `services/pgbouncer/Dockerfile`:

```dockerfile
FROM edoburu/pgbouncer:latest
ENV DB_HOST=<your-render-postgres-internal-host>
ENV DB_PORT=5432
ENV DB_USER=esoqo
ENV DB_PASSWORD=<password>
ENV DB_NAME=esoqo
ENV POOL_MODE=transaction
ENV MAX_CLIENT_CONN=200
ENV DEFAULT_POOL_SIZE=20
```

Deploy as a Render Web Service (no HTTP server — just the PgBouncer process listening
on port 5432). Then use the PgBouncer service's internal hostname in `DATABASE_URL`.

> For most teams, direct PostgreSQL without PgBouncer is sufficient at Render's scale.
> The Prisma schema already uses `?pgbouncer=true` in `DATABASE_URL` — omit this query
> param when connecting directly.

### Connection strings

```
# Direct connection (recommended for Render without PgBouncer)
DATABASE_URL="postgresql://esoqo_user:password@dpg-xxxx.render.com:5432/esoqo"
DIRECT_DATABASE_URL="postgresql://esoqo_user:password@dpg-xxxx.render.com:5432/esoqo"

# Via PgBouncer sidecar (if deployed)
DATABASE_URL="postgresql://esoqo:password@pgbouncer:5432/esoqo?pgbouncer=true&connection_limit=10"
DIRECT_DATABASE_URL="postgresql://esoqo:password@postgres:5432/esoqo"
```

---

## 2. Redis — Render Managed Redis

### Provision

1. In Render Dashboard, create a new **Redis**
2. Choose region (same as your PostgreSQL)
3. Plan: Starter (250 MB, $7/mo) or higher
4. Note the **Internal Connection String** from the details page

**No code changes needed** — the existing `ioredis` client in `packages/auth/src/redis.ts`
works out of the box with Render Redis.

```
REDIS_URL="redis://red-xxxx.render.com:6379"
```

If the Redis instance uses TLS (Render Redis does not by default, but some plans do):

```
REDIS_URL="rediss://red-xxxx.render.com:6380"
```

The `ioredis` client auto-detects the `rediss://` scheme and enables TLS.

---

## 3. Deploy the Core Service (Fastify)

The core service runs as a **Web Service** on Render.

### Via Dashboard

1. **New → Web Service**
2. Connect your GitHub repository
3. **Name**: `esoko-core`
4. **Root Directory**: `services/core`
5. **Runtime**: `Node`
6. **Build Command**: `pnpm install && pnpm --filter @esoqo/core-service build`
7. **Start Command**: `pnpm --filter @esoqo/core-service start`
8. **Plan**: Starter or higher
9. **Advanced** → Add environment variables (see §5)

### Via `render.yaml`

The `render.yaml` at the project root (see §7) defines the core service declaratively.

---

## 4. Deploy the Next.js Apps

Each Next.js app runs as a **Web Service** on Render (not "Static Site", because we
need SSR, API routes, and middleware).

### Important: Render expects an HTTP server

Each Next.js app needs a `start` command that binds to `0.0.0.0`. Render provides
the `PORT` env var automatically. The app's `next start` already respects `PORT`
from the package.json scripts.

### Via Dashboard

| Setting | `esoko-web` | `esoko-app` | `esoko-admin` |
|---------|-------------|-------------|---------------|
| **Name** | `esoko-web` | `esoko-app` | `esoko-admin` |
| **Root Directory** | `apps/web` | `apps/app` | `apps/admin` |
| **Runtime** | `Node` | `Node` | `Node` |
| **Build Command** | `pnpm install && pnpm build` | same | same |
| **Start Command** | `pnpm start` | `pnpm start` | `pnpm start` |
| **Plan** | Starter | Starter | Starter |

> The `pnpm build` command works because Render runs it from the app's root directory
> (`apps/web/` etc.), and the `package.json` scripts reference `next build` which
> is available via the workspace.

### Health check path

Set a health check path for each service to avoid false restarts:

| App | Health Check Path |
|-----|------------------|
| `esoko-web` | `/help` |
| `esoko-app` | `/api/health` |
| `esoko-admin` | `/signin` |
| `esoko-core` | `/health` |

---

## 5. Environment Variables

Set these in each Render service's **Environment Variables** section (or via
`render.yaml`).

### All services (shared)

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Render PostgreSQL connection string |
| `DIRECT_DATABASE_URL` | Same as DATABASE_URL when bypassing PgBouncer |
| `REDIS_URL` | Render Redis connection string |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `OTP_PEPPER` | `openssl rand -hex 32` |
| `AUDIT_CHAIN_SEED` | `openssl rand -hex 32` |
| `SMS_PROVIDER` | `africastalking` (production) |
| `SMS_API_KEY` | From Africa's Talking |
| `SMS_USERNAME` | From Africa's Talking |
| `SMS_SENDER_ID` | `ESOQO` |
| `OTP_RATE_LIMIT_PER_HOUR` | `5` |
| `OTP_DAILY_SPEND_CAP_KES` | `5000` |

### Per-service variables

**`esoko-web`** (`apps/web`):

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_WEB_URL` | `https://esoko.onrender.com` (or your custom domain) |
| `NEXT_PUBLIC_APP_URL` | `https://app-esoko.onrender.com` |
| `CORE_API_URL` | `https://esoko-core.onrender.com` |
| `PORT` | `10000` (auto-assigned by Render — but set explicitly) |

**`esoko-app`** (`apps/app`):

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_WEB_URL` | `https://esoko.onrender.com` |
| `NEXT_PUBLIC_APP_URL` | `https://app-esoko.onrender.com` |
| `CORE_API_URL` | `https://esoko-core.onrender.com` |

**`esoko-admin`** (`apps/admin`):

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_WEB_URL` | `https://esoko.onrender.com` |
| `NEXT_PUBLIC_APP_URL` | `https://app-esoko.onrender.com` |
| `CORE_API_URL` | `https://esoko-core.onrender.com` |

**`esoko-core`** (`services/core`):

| Variable | Value |
|----------|-------|
| `LOG_LEVEL` | `info` |
| `PORT` | `4000` |

---

## 6. Database Migrations & Seeding

### 6.1 Run migrations

Render does not auto-run Prisma migrations. You must run them manually or as a
one-off job.

**Option A: Manual (after first deploy)**

```sh
# From your local machine, targeting the Render DB
DATABASE_URL="<render-direct-db-url>" \
DIRECT_DATABASE_URL="<render-direct-db-url>" \
pnpm --filter @esoqo/db exec prisma migrate deploy
```

**Option B: Release command in `render.yaml`**

Add a `postDeploy` hook to run migrations automatically after each deploy:

```yaml
services:
  - type: web
    name: esoko-core
    # ...
    postDeploy:
      command: pnpm --filter @esoqo/db exec prisma migrate deploy
```

**Option C: One-off Job (Render Cron Jobs)**

Create a Render Cron Job that runs `prisma migrate deploy` after each deploy:

```
pnpm --filter @esoqo/db exec prisma migrate deploy
```

### 6.2 Seed the admin account

After migrations, seed the admin:

```sh
DATABASE_URL="<render-db-url>" \
DIRECT_DATABASE_URL="<render-db-url>" \
SEED_ADMIN_PIN="<your-pin>" \
SEED_ADMIN_HASH="<pre-computed-argon2-hash>" \
pnpm db:seed
```

Generate the hash locally:

```sh
node -e "const {hash} = require('@node-rs/argon2'); \
hash('<your-pin>', {memoryCost: 19456, timeCost: 2, parallelism: 1}).then(console.log)"
```

---

## 7. Infrastructure as Code — `render.yaml`

Create `render.yaml` in the project root for declarative deployments:

```yaml
# render.yaml
services:
  # ───────────────────────────────────────────────────────────
  # Core API — Fastify
  # ───────────────────────────────────────────────────────────
  - type: web
    name: esoko-core
    runtime: node
    repo: https://github.com/Emmanuel-Odero/esoko-254
    branch: main
    rootDir: services/core
    buildCommand: pnpm install && pnpm --filter @esoqo/core-service build
    startCommand: pnpm --filter @esoqo/core-service start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: LOG_LEVEL
        value: info
      - key: PORT
        value: "4000"
      - key: DATABASE_URL
        fromDatabase:
          name: esoko-db
          property: connectionString
      - key: DIRECT_DATABASE_URL
        fromDatabase:
          name: esoko-db
          property: connectionString
      - key: REDIS_URL
        fromDatabase:
          name: esoko-redis
          property: connectionString
      - key: SESSION_SECRET
        sync: false
      - key: OTP_PEPPER
        sync: false
      - key: AUDIT_CHAIN_SEED
        sync: false
      - key: SMS_PROVIDER
        value: console
      - key: SMS_API_KEY
        sync: false
      - key: SMS_USERNAME
        sync: false
      - key: SMS_SENDER_ID
        value: ESOQO
    postDeploy:
      command: pnpm --filter @esoqo/db exec prisma migrate deploy

  # ───────────────────────────────────────────────────────────
  # Web — public Next.js app
  # ───────────────────────────────────────────────────────────
  - type: web
    name: esoko-web
    runtime: node
    repo: https://github.com/Emmanuel-Odero/esoko-254
    branch: main
    rootDir: apps/web
    buildCommand: pnpm install && pnpm build
    startCommand: pnpm start
    healthCheckPath: /help
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: esoko-db
          property: connectionString
      - key: DIRECT_DATABASE_URL
        fromDatabase:
          name: esoko-db
          property: connectionString
      - key: REDIS_URL
        fromDatabase:
          name: esoko-redis
          property: connectionString
      - key: NEXT_PUBLIC_WEB_URL
        value: https://esoko.onrender.com
      - key: NEXT_PUBLIC_APP_URL
        value: https://app-esoko.onrender.com
      - key: CORE_API_URL
        value: https://esoko-core.onrender.com
      - key: SESSION_SECRET
        sync: false
      - key: OTP_PEPPER
        sync: false
      - key: AUDIT_CHAIN_SEED
        sync: false

  # ───────────────────────────────────────────────────────────
  # App — Next.js PWA
  # ───────────────────────────────────────────────────────────
  - type: web
    name: esoko-app
    runtime: node
    repo: https://github.com/Emmanuel-Odero/esoko-254
    branch: main
    rootDir: apps/app
    buildCommand: pnpm install && pnpm build
    startCommand: pnpm start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: esoko-db
          property: connectionString
      - key: DIRECT_DATABASE_URL
        fromDatabase:
          name: esoko-db
          property: connectionString
      - key: REDIS_URL
        fromDatabase:
          name: esoko-redis
          property: connectionString
      - key: NEXT_PUBLIC_WEB_URL
        value: https://esoko.onrender.com
      - key: NEXT_PUBLIC_APP_URL
        value: https://app-esoko.onrender.com
      - key: CORE_API_URL
        value: https://esoko-core.onrender.com
      - key: SESSION_SECRET
        sync: false
      - key: OTP_PEPPER
        sync: false
      - key: AUDIT_CHAIN_SEED
        sync: false

  # ───────────────────────────────────────────────────────────
  # Admin — Next.js operations dashboard
  # ───────────────────────────────────────────────────────────
  - type: web
    name: esoko-admin
    runtime: node
    repo: https://github.com/Emmanuel-Odero/esoko-254
    branch: main
    rootDir: apps/admin
    buildCommand: pnpm install && pnpm build
    startCommand: pnpm start
    healthCheckPath: /signin
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: esoko-db
          property: connectionString
      - key: DIRECT_DATABASE_URL
        fromDatabase:
          name: esoko-db
          property: connectionString
      - key: REDIS_URL
        fromDatabase:
          name: esoko-redis
          property: connectionString
      - key: NEXT_PUBLIC_WEB_URL
        value: https://esoko.onrender.com
      - key: NEXT_PUBLIC_APP_URL
        value: https://app-esoko.onrender.com
      - key: CORE_API_URL
        value: https://esoko-core.onrender.com
      - key: SESSION_SECRET
        sync: false
      - key: OTP_PEPPER
        sync: false
      - key: AUDIT_CHAIN_SEED
        sync: false

# ─────────────────────────────────────────────────────────────
# Databases
# ─────────────────────────────────────────────────────────────
databases:
  - name: esoko-db
    databaseName: esoqo
    user: esoqo
    plan: starter
    region: frankfurt
    postgresMajorVersion: 16

  - name: esoko-redis
    plan: starter
    region: frankfurt
    maxmemoryPolicy: noeviction
```

### Apply the blueprint

```sh
render blueprint apply --repo https://github.com/Emmanuel-Odero/esoko-254
```

Or connect your repo in Render Dashboard and select **Blueprint** as the deployment
method — Render auto-detects `render.yaml`.

---

## 8. Build Configuration Notes

### 8.1 pnpm constraints

Render's Node environment supports pnpm via Corepack. The `packageManager` field
in root `package.json` (`pnpm@9.12.0`) is already set — Corepack will auto-install
the correct version.

If Corepack is not enabled by default on Render, add a `preBuild` command:

```bash
corepack enable && corepack prepare pnpm@9.12.0 --activate
```

Add this in each service's **Build Command** or prepend to the build command in
`render.yaml`:

```yaml
buildCommand: corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install && pnpm build
```

### 8.2 Prisma Client generation

Prisma Client must be generated during build. Add a `postinstall` script to
`packages/db/package.json`:

```json
"scripts": {
  "postinstall": "prisma generate"
}
```

This ensures `prisma generate` runs automatically after `pnpm install` in any
service that depends on `@esoqo/db`.

### 8.3 Next.js output

The Next.js apps do not use `output: 'standalone'` — they use the default output
mode. This is correct for Render Web Services because Render runs `next start`
directly.

If you prefer `output: 'standalone'` (for Docker or tighter control), set it in
each `next.config.mjs`:

```js
const nextConfig = {
  output: 'standalone',
  // ...
};
```

And update the start command: `node .next/standalone/apps/web/server.js`.

---

## 9. Custom Domains

After initial deployment, add custom domains in Render Dashboard:

| Service | Domain |
|---------|--------|
| `esoko-web` | `esoqo.co.ke` |
| `esoko-app` | `app.esoqo.co.ke` |
| `esoko-admin` | `ops.esoqo.co.ke` |
| `esoko-core` | `api.esoqo.co.ke` |
| `cecf-wordpress` | `childeldercare.foundation` + `www.childeldercare.foundation` |

Render provides the target CNAME records for DNS configuration — open the
service's Settings → Custom Domains → the domain's "…" menu → "View DNS
details" to see the exact current values (they can change; don't hardcode
them here). For `cecf-wordpress` specifically, `WP_HOME`, `WP_SITEURL` and
`MULTISITE_DOMAIN` in `render.yaml` are deliberately `sync: false` — the
domain value lives only in the Render dashboard, not committed to git, so
adding the custom domain here is the one step that actually makes the site
resolve correctly (Bedrock's asset/permalink URLs are all built from
`WP_HOME` at runtime; a mismatch between that and where DNS actually points
is what causes theme assets — CSS/JS/images — to 404).

### SSL/TLS

Render automatically provisions and renews Let's Encrypt certificates for all
custom domains.

---

## 10. Post-deployment verification

```sh
# Health checks
curl https://esoko-core.onrender.com/health
curl https://esoko.onrender.com/help
curl https://ops-esoko.onrender.com/signin

# Admin login
open https://ops-esoko.onrender.com/signin
# Sign in with ops@esoqo.co.ke / your-seeded-pin
```

Check Render Dashboard logs for each service to verify clean startup.

---

## 11. Maintenance

### Deploy updates

Push to the `main` branch — Render auto-deploys. To trigger a manual deploy:

```sh
curl -X POST https://api.render.com/v1/services/<service-id>/deploys \
  -H "Authorization: Bearer <render-api-key>"
```

### View logs

```
Render Dashboard → esoko-web → Logs
```

Or via CLI:

```sh
render logs --service esoko-web --tail
```

### Scale

Render Web Services support horizontal scaling via the dashboard (Instances).
Each service can run 1–N instances behind a built-in load balancer.

### Backups

Render PostgreSQL includes automated daily backups with 7-day retention (Starter)
or 30-day retention (Professional).

---

## 12. Comparison: Render vs. Vercel

| Aspect | Render | Vercel |
|--------|--------|--------|
| Next.js SSR | ✅ Web Service (long-running) | ✅ Serverless Functions |
| Fastify core | ✅ Web Service | ❌ Not possible |
| Redis (`ioredis`) | ✅ Works natively | ❌ Must use Upstash |
| Cold starts | ❌ Slower (container-based) | ✅ Near-zero (functions) |
| Pricing | 💰 Flat monthly per service | 💸 Usage-based (can be cheaper) |
| Managed Postgres | ✅ Built-in | ❌ Third-party (Neon/Supabase) |
| Managed Redis | ✅ Built-in | ❌ Third-party (Upstash) |
| Auto-scaling | ✅ Manual scaling | ✅ Automatic per-function |
| Custom domains | ✅ Let's Encrypt | ✅ Vercel DNS |
| `render.yaml` / `vercel.json` | ✅ Blueprint IaC | ✅ Framework-preset |
| Free tier | Service spins down after inactivity | Functions stay warm |

---

## 13. Production checklist

- [ ] Secrets generated (`SESSION_SECRET`, `OTP_PEPPER`, `AUDIT_CHAIN_SEED`)
- [ ] Database migrated and seeded with known admin PIN
- [ ] Core service deployed and health-check passing
- [ ] All four Render services connected to same PostgreSQL and Redis
- [ ] SMS provider switched from `console` to `africastalking`
- [ ] Custom domains configured with DNS
- [ ] OTP daily spend cap set (`OTP_DAILY_SPEND_CAP_KES`)
- [ ] PostgreSQL automated backups verified
- [ ] Logging and monitoring set up
- [ ] Render Blueprint committed to repo for IaC traceability
- [ ] Health check paths configured on all services to prevent false restarts
