# services/ledger · Rust

**Status: not started. Phase 2.**

Double-entry ledger, escrow and settlement. Rust for the reasons in
ADR-0004: `rust_decimal` removes the float-bug class, `sqlx` checks SQL
against the real schema at compile time, and ~50 MB resident against a
JVM's ~500 MB matters on a 12 GB box.

**This service is not AI-owned.** The failure mode of a ledger bug is
silent and delayed: code that passes every test you thought to write can
carry an isolation fault that only appears under concurrent load months
later, by which time the corruption is in history. A named human owns
this, and the property-based tests are written before the implementation.

Invariants, to be asserted as properties, not examples:
- every `JournalEntry` sums to exactly zero across its postings
- no balance is ever stored — always derived from `Posting`
- every write is idempotent on `idempotencyKey`
- serialisable isolation on all ledger transactions
