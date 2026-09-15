# Our Jamii — custom domains

**Type** · Implementation note (feature is built: `packages/db`, `services/core`,
`apps/jamii`, `apps/admin`)
**Prepared** · 18 August 2026
**Status** · Shipped and testable locally end to end — see "Testing locally" below

Lets an Our Jamii group point a domain they own (e.g. `mchamawetu.org`) at their
existing page. Nothing about the page, the dashboard, donations or admin tooling
changes — a verified `JamiiDomain` just changes how the page is *reached*.

## Shape

- `JamiiDomain` (1:1 with `JamiiPage`) — `packages/db/prisma/schema.prisma`.
- DAL — `packages/db/src/dal/jamii-domain.ts`: self-serve request/remove (page
  `ADMIN` only), staff moderation (`jamii-domain.moderate`), and the public
  `resolveJamiiDomain()` the app's middleware calls.
- Provisioning — **Cloudflare for SaaS** (Custom Hostnames). The Cloudflare API
  token lives only in `services/core`'s env, never in `apps/jamii` or the
  browser — see `services/core/src/lib/cloudflare-saas.ts` and
  `routes/jamii-domains.ts`'s `POST /internal/jamii-domains/reconcile`. Gated by
  `JAMII_DOMAIN_PROVIDER=console|cloudflare` the same way `MPESA_PROVIDER` gates
  Daraja and `SMS_PROVIDER` gates OTP delivery — `console` (the default, and the
  only thing `development` will ever honour) never calls Cloudflare or does a
  real DNS lookup, so the whole flow is testable with no Cloudflare account and
  no owned domain.
- Ownership is proven two independent ways before a domain ever goes `ACTIVE`:
  Cloudflare's own hostname verification, and a separate `_esoqo-verify.<host>`
  TXT record we generate and check ourselves.
- Routing — `apps/jamii/src/middleware.ts` resolves the `Host` header against
  verified, `ACTIVE` domains only, and rewrites to `/o/{slug}/...`
  transparently. `apps/jamii/src/lib/org-links.ts` is what keeps every link on
  the page root-relative (`mchamawetu.org/about`, not `.../o/{slug}/about`)
  when served this way.
- Admin — the existing `jamii-pages` screen shows each page's domain and status,
  with suspend/reinstate/remove wired to the same `recordAudit` trail as
  `moderateJamiiPage`.

## Scheduling the reconciler

`POST /internal/jamii-domains/reconcile` does nothing on its own — something
has to call it on an interval. `.github/workflows/jamii-domain-reconcile.yml`
does that: a scheduled GitHub Action hitting it every 5 minutes (plus
`workflow_dispatch` for a manual run). It's just a scheduler — all the actual
logic (Cloudflare calls, DB writes, audit trail) lives in the endpoint, so
whichever PaaS `services/core` eventually runs on (still open per ADR-0001 /
`infra/README.md` / `Deploy_Render.md`) doesn't matter; this keeps working
unchanged as long as `CORE_API_URL` reaches it. Two repo secrets need setting
before it does anything (`gh secret set CORE_API_URL`, `gh secret set
JAMII_DOMAIN_RECONCILE_SECRET` — the latter matching the same-named env var on
`services/core`); until then the workflow fails loudly with a clear error
rather than silently no-opping.

If `services/core` ends up somewhere with its own native cron (Render Cron
Jobs, a Coolify scheduled container), swapping in that instead of the GitHub
Action is a config change, not a code change — the endpoint doesn't care who
calls it.

## Testing locally

No Cloudflare account, no owned domain, no `/etc/hosts` edit needed — console
mode (the default under `APP_ENV=development`, which is the default `APP_ENV`)
simulates an immediately-healthy hostname and skips the real DNS ownership
check, so the whole `PENDING_DNS -> VERIFYING -> ACTIVE -> serves the page`
flow runs against your local Postgres alone.

1. **Set one env var**, if it isn't already in your `.env` (any value works —
   it only protects the reconcile endpoint, not a real vendor):
   ```
   JAMII_DOMAIN_RECONCILE_SECRET="dev-jamii-domain-secret-local-only"
   ```
   Leave `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ZONE_ID`/`JAMII_DOMAIN_PROVIDER`
   unset — console mode needs none of them.

2. **Run the core service and the jamii app**:
   ```
   pnpm --filter @esoqo/core-service dev   # :4000
   pnpm --filter @esoqo/jamii dev          # :3004
   ```

3. **Request a domain** from a signed-in page ADMIN in the jamii dashboard
   (`/dashboard/settings` → "Your own domain"). Use a hostname under
   [`localtest.me`](http://localtest.me) — e.g. `mchama-demo.localtest.me` —
   which publicly resolves to `127.0.0.1` with no `/etc/hosts` edit. Status
   starts at `PENDING_DNS`.

4. **Drive the reconciler manually** — this is what the GitHub Action calls on
   a schedule in a real deploy; locally you just call it yourself:
   ```
   curl -X POST http://localhost:4000/internal/jamii-domains/reconcile \
     -H "X-Reconcile-Secret: dev-jamii-domain-secret-local-only"
   ```
   Console mode needs two ticks to reach `ACTIVE` (first tick: `PENDING_DNS ->
   VERIFYING`, registers a simulated hostname; second tick: `VERIFYING ->
   ACTIVE`, checks the simulated status) — the same two-phase shape the real
   Cloudflare flow goes through, just instant instead of waiting on real DNS
   propagation. Call it twice.

5. **Visit the page** at `http://mchama-demo.localtest.me:3004/about` — the
   middleware resolves the `Host` header, rewrites internally to
   `/o/{slug}/about`, and every link on the page stays under
   `mchama-demo.localtest.me/...` with no `/o/{slug}` segment, exactly as it
   would on the group's real domain.

Removing the domain and re-running step 4 exercises the teardown path
(`removedAt` set -> simulated Cloudflare hostname "deleted" -> row cleaned up,
hostname free to reclaim) the same way.

## Why not a second product

The request was "let a group's minisite feel like their own website." The
tempting-but-wrong version of this is a site builder. What a group actually
wants is: *their* domain, in the address bar, showing the page they already
have. That's a routing + certificate problem, not a content problem — so
`JamiiPage` stays the single source of truth, and `JamiiDomain` is purely
"how do visitors get here."
