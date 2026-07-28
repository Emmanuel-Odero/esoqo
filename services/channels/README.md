# services/channels · Rust

**Status: not started. Phase 1 — ship this before the PWA.**

USSD, SMS and WhatsApp gateway. Holds session state in Redis and must
answer inside the aggregator's ~2 second SLA under sustained concurrency,
with no GC pause.

Non-negotiables carried from the design work:
- ≤ 3 menu levels; `0` is back and `00` is home, everywhere, forever
- every screen ≤ 182 characters including the options
- 120-second session timeout **with resumption** — losing a half-typed
  payment amount is a reason never to try again
- every END screen is a receipt with a reference number
- Kiswahili written natively, not translated
