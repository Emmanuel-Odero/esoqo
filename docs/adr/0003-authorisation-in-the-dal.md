# ADR-0003 · Authorisation lives in the Data Access Layer

**Status:** Accepted · 2026-07-27

## Context
Next.js middleware has had two distinct authorisation-bypass classes in
sixteen months:

- **CVE-2025-29927** (CVSS 9.1, March 2025) — sending
  `x-middleware-subrequest` skipped middleware entirely, defeating
  authorisation in any app that treated it as *the* gate.
- **July 2026 security release** — among other fixes, a middleware/proxy
  bypass in App Router applications, SSRF in rewrites, and
  unauthenticated disclosure of internal Server Function endpoints.

This is a recurring category, not an accident. Self-hosted deployments
carry the patching burden themselves.

## Decision
Five layers, and `proxy.ts` is not one of the load-bearing ones.

1. CDN — strips `x-middleware-subrequest`, rate limits, TLS
2. `proxy.ts` — optimistic redirect only. **Never a security boundary**
3. **Data Access Layer** — every query passes through it;
   `requireCapability()` runs before any database call, deny by default
4. Postgres row-level security
5. Hash-chained audit log

Enforcement is mechanical, not cultural: `no-restricted-imports` in
`@esoko/config` forbids importing `@prisma/client` outside
`packages/db`, and CI fails on violation. A rule in a document is
advisory; a rule in CI is enforced — which matters more than usual here
because much of the code is written with AI assistance, and a model does
not remember the code review from three weeks ago.

## Consequences
- A future middleware CVE does not become a data breach.
- Every data path is auditable in one place.
- Slight friction: no ad-hoc Prisma queries in components. That is the point.
