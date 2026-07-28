# ADR-0001 · Two-plane architecture

**Status:** Accepted · 2026-07-27

## Context
The platform must serve a web tier globally and run four workloads that
elastic, request-scoped compute handles badly: a USSD gateway with a ~2s
aggregator SLA and stateful sessions, a double-entry ledger needing
serialisable isolation and strict connection discipline, long-running
reconciliation workers, and credential signing with KMS-held keys.

Vercel's Fluid Compute is genuinely good for the web tier, but it scales
execution units freely and relies on downstream infrastructure to absorb
the impact. A documented case: `max: 5` across 10 spawned processes
attempting 50 concurrent connections and flooding the provider limit.
The application layer alone cannot manage database concurrency there.

## Decision
Two planes.

- **Web plane** — `apps/*` on Vercel (or self-hosted during pilot).
- **Core plane** — `services/*` on always-on containers, in or near Kenya.

They communicate over mTLS with signed service tokens. The core plane
owns the database connection; the web plane never connects directly.

## Consequences
- The ledger is never at the mercy of function fan-out.
- The USSD gateway holds warm state and meets its SLA.
- Vercel lock-in is limited: business logic lives in `services/*`.
- Cost: two deployment targets instead of one.
