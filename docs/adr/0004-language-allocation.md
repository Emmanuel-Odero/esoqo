# ADR-0004 · Three languages, each with a stated job

**Status:** Accepted · 2026-07-27

## Context
The team knows Ruby, Rust, Java, PHP, Python and TypeScript. The pilot
runs on Oracle Always Free, which was reduced on 15 June 2026 from
4 OCPU / 24 GB to **2 OCPU / 12 GB**. Memory is a real constraint, not a
stylistic one.

## Decision
| Component | Language | Reason |
|---|---|---|
| `apps/*`, `services/core`, `services/credential` | **TypeScript** | One Zod schema in `packages/domain` serves the form, the Server Action, the API and the DAL. Nothing else on the list gives that. Best W3C VC / OID4VCI ecosystem. |
| `services/ledger`, `services/channels` | **Rust** | ~3k lines handling other people's money; `rust_decimal` removes the float bug class; `sqlx` checks SQL at compile time. ~50 MB resident vs ~500 MB for a JVM, and no GC pause against the 2s USSD SLA. |
| `services/workers` | **Python** | Tesseract bindings, batch reconciliation, future scorecard tooling. |

**Rejected:** Java/Spring (4 × ~500 MB = 2 GB of a 12 GB budget for no
gain), Ruby/Rails (loses monorepo type-sharing), PHP/Laravel (a fourth
language with no problem to solve).

## Consequences
- Full stack fits in ~5.6 GB with ~6.4 GB headroom.
- Hiring risk: Rust engineers are scarcer in Nairobi. Mitigation — keep
  the Rust surface small (~5k lines), document heavily, pair a TypeScript
  engineer in so the bus factor is never one. Documented fallback is
  Java 21 + Spring Boot with virtual threads, accepting the memory cost.
