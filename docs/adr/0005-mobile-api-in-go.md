# ADR-0005 · Mobile API (`services/core-go`) in Go, not TypeScript

**Status:** Accepted · 2026-08-30

## Context
ADR-0004 assigns `apps/*` and `services/core` to TypeScript specifically because one Zod
schema in `packages/domain` serves the form, the Server Action, the API and the DAL — a
same-language, same-repo advantage. That advantage does not extend to a mobile client: Flutter
apps are Dart, so no request/response schema can be shared with `packages/domain` regardless of
which language answers the HTTP call. The schema-sharing argument for TypeScript is therefore
neutral for this component, not a reason for it.

Esoqo now needs a mobile-facing REST API (Android/iOS/Wear OS, Flutter) for three domains:
groups/chamas, shopping/store, ticketing. None of the existing services expose HTTP endpoints
for these — `apps/app`/`apps/store` call `packages/db` DAL functions directly from Next.js
Server Actions.

## Decision
Add `services/core-go` — Gin, deployed via Docker runtime (same pattern as
`services/cecf-wordpress`) — as the mobile API. It talks to the same Postgres (through the
mandatory `pgbouncer`, per ADR-0002) and the same Redis as the rest of the stack, using `sqlc`
against the schema still authored by `packages/db/prisma/schema.prisma`. Domain logic
(authorization rules, business invariants) is ported from the corresponding
`packages/db/src/dal/*.ts` files rather than re-derived, so behaviour stays identical across
the TypeScript and Go call paths during the transition.

This is additive, not a replacement of `services/core` (which keeps serving CECF/Jamii-domain
webhooks and the existing Next.js apps) — at least until enough of the mobile-relevant domain
logic has moved that retiring the TypeScript path becomes the next decision, tracked
separately.

**Rejected:** Extending `services/core` (Fastify/TS) to also serve mobile — would work, but the
team explicitly wants a path off TypeScript for these three domains, and a clean new service
avoids entangling that migration with `services/core`'s existing CECF/webhook responsibilities.

## Consequences
- A fourth language enters the stack. Binary memory footprint is not a concern here — a Go
  binary is materially lighter than the Node processes ADR-0004's budget was built around, so
  this does not threaten the Oracle Always Free 2 OCPU/12 GB ceiling.
- Two services now write to overlapping tables (chama/store/ticketing) from two languages
  during the transition. Mitigated by porting business rules 1:1 from the DAL rather than
  reinventing them, and by leaving schema/migration ownership with Prisma until the TypeScript
  side is fully retired (avoids a second migration system racing the first).
- `services/core-go` is not part of the pnpm workspace or turbo's task graph (no JS build
  step) — same shape as `services/cecf-wordpress`: own directory, own Dockerfile, own
  container image.
