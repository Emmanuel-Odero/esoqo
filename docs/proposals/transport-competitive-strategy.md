# Esoqo Transport — Back to the Drawing Board

**Status:** strategy proposal · 2026-09-20
**Scope:** the transport vertical across `core-go` fleet/ticketing/parcel, `apps/app` org consoles, `apps/admin`, the Flutter app
**Premise:** assume the first push did *not* land. Work out why from the code, not from the pitch deck.
**Benchmark:** Voltic Kenya (BOSS + Travler)

---

## 0 · What the competitor actually sells

Voltic sells **two** things, and both are narrow on purpose:

| Product | What it is | Their claim |
|---|---|---|
| **BOSS** — Bus Operators Service System | Operator-side ERP | "automates passenger manifesting, revenue collection and fleet logistics with **zero upfront investment**, ensuring **total accountability** across every route you serve"; spare-parts purchasing; owner can see **profit per route**; tracks what employees do "in office and on the road" |
| **Travler** | Consumer bus-booking app | "Kenya's number one choice for online bus ticketing", M-Pesa integrated, book "in just minutes" |

Reach claimed: **3 countries, 68+ routes** (Nairobi · Dar es Salaam · Kampala).

Read their copy carefully and the entire proposition is one sentence: **an owner who is not in the vehicle can still see the money.** Manifest, revenue, profit-per-route, employee monitoring — four names for the same anxiety. "Zero upfront investment" tells you the commercial model (revenue share / per-ticket, not licence) and therefore that the sales objection they clear is *risk*, not price.

That is the target. Not their feature list.

---

## 1 · The honest read on why this hasn't landed

Five diagnoses, each verified in the code, ordered by how much damage they do.

### 1.1 A bus company logs in and sees a civic registry

`apps/admin` has **48 pages across 22 top-level sections** — `registrations`, `sectors`, `groups`, `jamii-pages`, `jamii-media`, `jamii-campaigns`, `jamii-donations`, `jamii-interest`, `estores`, `documents`, `vouchers`, `support-tickets`, plus `parcels` and `ticketing`. The README describes the product as "a consented credential-and-cashflow registry for Kenya's informal economy."

All of that is true and much of it is good. None of it is what a SACCO chairman bought. Voltic's landing page says *bus operators*; ours says *informal economy registry with transport among eleven other things*. A transport buyer reads that as "this is not for me, and these people will be distracted."

The platform breadth is a genuine long-run asset — but it must be **invisible at the point of sale and at the point of daily work**. What ships to a transport client should be one console with one noun: the fleet.

### 1.2 The passenger plane and the physical plane are not connected

This is the structural hole, and it is the reason we cannot answer Voltic's pitch at all today.

There are two independent worlds in `schema.prisma`:

**The selling world** — `Listing` → `ListingSchedule` → `TicketClass` → `Seat` → `Booking` → `Ticket`. Sells reserved seats, takes M-Pesa, issues QR tickets. Real and working.

**The physical world** — `FleetVehicle` → `Trip` → `CrewMember` (DRIVER/CONDUCTOR) → `VehiclePing` → `FarePayment` → `CollectionDeclaration`. Tracks actual vehicles on actual roads with actual crews and actual cash. Also real and working.

**They do not touch.** `ListingSchedule` (`schema.prisma:4867`) records the vehicle as `vehicleOrHallLabel String?` — free text. There is **no** `vehicleId`, no `driverId`, no `conductorId`, no `tripId`. A repo-wide grep for any schedule↔trip linkage in `core-go` returns nothing.

Everything Voltic advertises falls out of that one missing relation:

| Their claim | Why we can't make it | Unblocked by the FK |
|---|---|---|
| Passenger manifesting | A manifest needs *this vehicle, this crew, these passengers*. We can list a schedule's tickets, but not bind them to a plate or a named conductor. | ✅ |
| Revenue collection accountability | `FarePayment` (short-route cash/STK) and `Booking` (intercity seats) never meet. Two revenue streams, no single view. | ✅ |
| **Profit per route** | Needs revenue per vehicle-run. We can't attribute a `Booking` to a vehicle. (Also needs costs — §1.3.) | ✅ (partly) |
| Fleet logistics | `TripEndStatus.NEEDS_REPAIR` can't be joined to the 40 seats already sold on that bus tomorrow. | ✅ |
| Employee monitoring | Intercity revenue is attributable to nobody; only short-route `FarePayment` names a crew. | ✅ |

And one thing Voltic *doesn't* offer that becomes free: **a passenger watching their own bus approach.** `VehiclePing` already streams positions and `ActiveTrails` already renders them for the operator. The ticket holder cannot see it — not because it's hard, but because their `Ticket` has no path to a `Trip`.

> **The single highest-leverage change in this document is adding `vehicleId`, `driverId`, `conductorId` and `tripId` to `ListingSchedule`, plus an "assign vehicle & crew" step at schedule creation.** One migration and one form unlock six headline features, including the passenger-facing one no competitor has.

### 1.3 We count revenue. We do not count cost. So "profit" is unavailable.

Verified absent from the entire schema: any `Expense`, `Cost`, `Fuel`, `Maintenance`, `Asset`, `Payroll` or `Loan` model. Repo-wide, "maintenance", "spare part", "odometer", "per route" and "payroll" return **zero** matches; "fuel" matches only `TripEndStatus.NEEDS_FUEL`.

`GetFleetOverview` (`dbx/fleet.go:710`) is genuinely strong on the revenue side — active trips, vehicles reporting in the last 15 minutes, fares today, cash fares today, declared cash, and **`CashVarianceToday` = cash fares − declared cash**. That variance figure is the single best thing in the transport codebase and I'll come back to it in §2.1.

But an owner asking "does the Kisumu run make money?" cannot be answered. Voltic answers it. This is not a big build: cost capture belongs at **close of trip, entered by the crew who spent the money**, not in a back-office accounting module nobody fills in.

```
TripExpense
  tripId, kind (FUEL | PARTS | STATION_FEE | CESS | POLICE | CREW_ALLOWANCE | REPAIR | OTHER)
  amountKes, litres?, odometerKm?, receiptPhotoKey?, note?, enteredBy (crewId), at
```

Then, honouring rule 2 (*balances are derived, never stored*), profit is a query: revenue (`FarePayment` + `Booking` + parcel revenue, all now joinable to `Trip` via §1.2) minus `TripExpense`, rolled up per trip → per vehicle → per route → per day. `TripEndStatus` already gives the crew a three-chip close-out UI to hang this on.

Note what this quietly produces: **cost per seat-km and fuel consumption per vehicle.** An owner who learns that KCA-123X burns 18% more diesel per km than the rest of the fleet has found a siphoning driver or a failing injector. Nobody in this market gives them that.

### 1.4 The crew's app stops working where the crew works

Offline support in the repo: `apps/store/src/lib/pos-offline.ts` — the retail PoS outbox. That's it.

- The Flutter app (`mobile/esoqo_app`) has **no** local write queue — no `hive`, no `sqflite`, no `isar`, no outbox. Grep for offline persistence returns one unrelated hit in `group_detail_screen.dart`.
- `apps/app/src/app/parcel-org/counter` is Next.js Server Actions — `FrontDeskClient.tsx:118` wraps a network round trip in `useTransition` with no optimistic local state and no queue.

A conductor scanning tickets between Mai Mahiu and Nakuru has no network. A counter clerk in Kisii on a bad ADSL day has intermittent network. Today both get a spinner, then a failure, then they reach for the paper waybill — and the moment they reach for paper, every promise in the pitch (verifiability, turnaround, accountability) is void for that trip, and the owner's dashboard silently lies.

**This is also the real answer to the four-second target.** You cannot hit four seconds across a 3G Server Action round trip; p95 mobile latency in Kenya won't allow it. You hit it by making the *local* write authoritative for the UI and the sync invisible. Offline-first is not a resilience feature here — it is the performance feature.

### 1.5 Crew identity is deniable, which makes accountability unenforceable

`docs/proposals/esoqo-unified-crew-identity.md` already diagnoses this correctly: org staff authenticate as **AGENT** — org slug + free-text name + PIN, **no Party**, capabilities frozen at sign-in, no live kill switch.

The security consequences are in that proposal. The *commercial* consequence isn't: **an action attributed to a shared PIN and a typed-in name is not evidence.** When a SACCO confronts a conductor over a KES 4,000 variance and he says "that wasn't me on the phone," the system cannot contradict him. We are selling accountability on top of an identity layer that cannot support it.

That proposal is sound and should ship **before** any scale push, not after. One amendment in §3.3.

---

## 2 · Seven things we can own that Voltic structurally cannot

Not a feature list — these are positions defensible because of decisions already made in this codebase.

### 2.1 Cash variance as the product, not a metric

`CashVarianceToday` already exists. Systems that store balances cannot produce an honest variance figure, because the stored balance *is* whatever was last written to it. Ours is derived from `FarePayment` sums against `CollectionDeclaration` sums — two independently-sourced numbers that disagree when someone is stealing.

Make it the front door of the operator console: **"Yesterday: KES 412,300 collected · KES 398,100 declared · KES 14,200 unaccounted — across 3 vehicles, 2 crews."** Drill to the crew. Drill to the trip. Drill to the individual fare.

This is the number the buyer already lies awake about. Leading with it says, in one screen, that we understand the business.

### 2.2 A tamper-evident revenue record — as a document the owner can hand to a bank

The README's **hash-chained audit log with a verifier that names the first broken link** is the most commercially valuable asset in this repo and it is currently invisible to customers.

Ship it as an artefact: a monthly **Revenue Integrity Statement** per operator — total collected, per route, per vehicle, per crew, with a chain hash and a public `esoqo.co.ke/verify/...` URL where a third party checks it without an account (the `/verify` flow and `ResolveCertificateByCode` already do exactly this shape for attestations).

Why it's defensible: a SACCO seeking asset finance, insurance, or an NTSA/county licence renewal has to *prove* turnover. Today they hand over a spreadsheet nobody believes. A competitor storing balances in a mutable column cannot produce this, and retrofitting it means rebuilding their ledger. **This converts a compliance chore into the reason they can't leave us.**

### 2.3 Parcels riding the passenger fleet

`Parcel.tripId` (`schema.prisma:3585`) already exists, with the comment: *"A passenger trip doubles as freight capacity that would otherwise travel empty."* `docs/proposals/parcel-audit-and-pilot-plan.md` correctly identifies this as the wedge.

The economics, stated plainly: the marginal cost of a parcel in a boot that is already making the journey is **approximately zero**. Voltic runs ticketing and parcels as separate modules over separate cost bases. We can price parcels below anyone's floor, permanently, and still book margin — while the operator gets a new revenue line on trips they are already running.

`GetTripManifest` is already built and already sorts by drop stage — "what's in my boot", in the order the conductor needs it. This is nearly done and under-marketed.

### 2.4 One scanner for everything

`docs/proposals/universal-scan-and-code-mint.md` is implemented: `GET /v1/scan/resolve` takes any code and returns kind + action across `trip | voucher | fare | product | store | table | ticket | order | party | certificate`, with unbiased minting, retry-on-collision, and typo-rejecting checksums on hand-typed prefixes.

This is a straight-up learning-curve moat. A conductor learns **one** gesture. Not "open the ticket scanner for tickets, the parcel screen for parcels, the fare screen for fares." Point the camera at anything; the right thing happens. Competitors with per-module apps cannot collapse to this without rewriting their routing.

Exploit it harder — see §3.1.

### 2.5 The feature phone

Rule 3 in the README: *if it cannot work on USSD, it is not a core feature.* `services/channels` holds the discipline that matters (≤3 menu levels, `0` back / `00` home, ≤182 chars per screen, 120s timeout **with resumption**, every END screen a receipt, Kiswahili written natively) — and there's a working `docs/demos/ussd-ticket-booking-demo.html`.

**It is not built.** Status: "not started."

Travler is a Play Store app. Every passenger without a smartphone, and every passenger who won't spend 40MB on an app to buy one ticket, is unreachable by our competitor and reachable by us. In the upcountry routes where the margins actually are, that is not a minority.

Stated honestly: this is the biggest *unbuilt* differentiator we have, and it needs a Rust service written. Don't put it in a pitch until it answers a real shortcode.

### 2.6 Crew who are also customers

The unified-crew-identity decision — crew hold real Esoqo accounts and use the consumer product themselves — has a support benefit the proposal names, and a commercial one it doesn't: **the conductor becomes a distribution channel.** A conductor with a wallet, a payment QR (`ESK-` codes, already shipped to the Settings tab) and a personal record sells the passenger-side product forty times a day without being asked to.

Voltic's employees are monitored subjects of their system. Ours are participants in it. Over a year of retention, that difference compounds.

### 2.7 Money that is already correct

`internal/money`, `internal/ledger`, `Decimal(12,2)` throughout, derived balances, double-entry `JournalEntry`/`Posting`, `docs/proposals/money-representation.md` at 630 lines. Fares, bookings, parcels and store sales all post through one ledger rather than four.

This never wins a demo. It is why, eighteen months in, our numbers will still reconcile and a rushed competitor's won't. Hold the line (rule 2: no balance column, ever).

---

## 3 · The four-second promise, made concrete

"Tasks that took a minute now take under four seconds" is the right promise and currently an unfalsifiable one. Make it a specification, then measure it.

### 3.1 The one-gesture contract

Every high-frequency crew task must be **scan → confirm → done**: at most one deliberate tap after the scan, zero navigation, zero typing, and it must complete with the phone in airplane mode.

| Task | Today | Target | Blocked on |
|---|---|---|---|
| Check in a passenger | open scanner, type/scan code, await network | scan → green → next | offline queue (§1.4) |
| Board a parcel on a trip | navigate to trip, find parcel, tap board | scan parcel → scan trip → done | offline queue |
| Take a cash fare | multi-field form | scan stage-to → tap amount chip → done | fare quick-chips from `FareStage.fareKes` |
| Declare cash at close | form | one screen: amounts pre-filled from confirmed fares, crew confirms or corrects | exists; needs the close-out screen |
| Record fuel | impossible | scan pump receipt → litres + KES → done | `TripExpense` (§1.3) |
| Print a parcel label | counter flow | scan → auto-print, no dialog | exists; remove the confirm step |
| Find "where is my bus" | impossible for passengers | open ticket → live map | the `ListingSchedule` FK (§1.2) |

Design rules that follow, and should be enforced in review:

- **Scan-to-confirm is the only pattern.** If a crew task needs a form, the form is a bug.
- **Optimistic and local.** The UI commits on local write. Sync is a background badge, never a modal, never a blocker.
- **Amounts are chips, not keypads.** `FareStage.fareKes` is known; render the three plausible amounts as buttons.
- **Errors are physical, not textual.** Red screen + distinct buzz pattern for a bad ticket, green + single beep for good. A conductor in a moving vehicle does not read prose.
- **One-handed.** Every crew action reachable by a right thumb on a 5.5" screen.

### 3.2 Instrument it, then publish it

Add client-side task timing per role and surface **p50 / p95 seconds per task type** in the operator console and in our own internal dashboard.

Two payoffs. Internally, a regression in tap count shows up as a number instead of a complaint. Externally, we can say *"passenger check-in, p95, measured across 1.2 million scans: 2.8 seconds"* — a claim no competitor in this market is currently in a position to make, because none of them measure it.

### 3.3 One amendment to the crew-identity proposal

The proposal settles on a **30–90 day** (`ORG_CONTEXT_ACTIVATION_DAYS`, default 60) org-context activation TTL, with suspension as the compensating control. Right for scanning and check-in.

Wrong for the cash-handling capabilities specifically — `CapCollectionDeclare`, `CapFareVerify`, and fare creation. Those authorise money movement, and a 60-day dormant-but-live activation on a handset that spends its life in a matatu is a large window. Split the TTL:

- **Scan/check-in capabilities** — 60 days, as proposed.
- **Cash-handling capabilities** — scoped to the open `Trip`, auto-expiring at `CloseTrip`.

Re-activation must not cost an OTP each shift, or crews will share handsets to avoid it — which destroys the attribution in §1.5. Use **device binding**: register the handset once at first activation, and thereafter re-activate on that device with the PIN alone. The open item the proposal already flags ("whether `org_context_activations` needs per-device binding") should be resolved as **yes**, and that resolution is what makes the shorter TTL affordable.

---

## 4 · Zero-gap security: what to fix before the next client

### 4.1 Cross-tenant leak in the fraud summary — fix this first

`GetFraudSummary` (`services/core-go/internal/dbx/fraud.go:50`) gates on `requireFraudReader`, which checks **only** `ticketorg.read` (`fraud.go:44`). Its three SQL statements have **no org filter of any kind** — they aggregate `fare_verification` and join `fare_payment` across the entire platform, returning fare amounts, trip IDs and **M-Pesa receipt codes**.

`ticketorg.read` is held by every org-staff bundle in `authsvc/capabilities.go:185–205` — including **`SCANNER`**, the lowest-trust role in the system.

The handler comment at `handlers_fraud.go` asserts *"Crew sessions (fare.verify) are denied: the directory is deliberately unscoped, same contract as handleAdminListTicketOrgs"* — but `SCANNER` and `CREW` both carry `ticketorg.read`, so the capability check does not implement the contract the comment describes. A tout with a PIN can read every SACCO's fare data, including competitors on the same platform.

Fix: either scope all three queries by `orgId` for org-scoped callers, or require a platform-staff-only capability. Then add a test asserting a `SCANNER` context gets `403`. Given the proposal in §2.2 is *selling* revenue confidentiality, this cannot ship as-is.

### 4.2 Operational risk that undermines the trust pitch

From the README, and worth restating because it affects the sale:

- **Migrations do not run automatically on Render.** "A schema change that reaches `render` without a manually-run `migrate deploy` … will build and deploy fine, then throw on the very first query that touches the new column — *this has actually happened, more than once.*"
- **`apps/store` has no Render service.** Storefronts and PoS run locally only.
- Seeded ops PIN, `SMS_PROVIDER=console`, and the ODPC checklist are all still open.

When an operator's entire daily revenue flows through us, a first-query-after-deploy failure is not a bug, it is a lost client and a story that travels through a SACCO network fast. Before the next signed customer: automate `migrate deploy` behind a gate, add a post-deploy smoke check that touches the newest migration's columns, and complete the pre-launch checklist.

### 4.3 Where "verifiability" still has a hole

Two, both already named in the parcel audit and both still true: no **ePOD** (photo/signature/GPS at handoff) and **courier vetting is a status flip with no document evidence**. For a transport client, the same gap exists on the passenger side — no evidence trail on a disputed check-in beyond the scan row.

---

## 5 · Sequencing

Ordered so each phase makes the next one saleable. Nothing here requires a new service except where noted.

### Phase 1 — Make the product answer the question the buyer asks (≈4–6 weeks)

1. **`ListingSchedule` → vehicle + crew + trip FKs**, and the assign step at schedule creation. (§1.2 — everything else depends on this.)
2. **Passenger manifest** per departure: plate, driver, conductor, seat-by-seat with check-in state. Printable and phone-readable, like `ManifestSheet` already is for parcels.
3. **`TripExpense`** + crew close-out capture, and the derived **revenue / cost / margin per trip → vehicle → route** rollup. (§1.3)
4. **Operator home screen leads with cash variance.** (§2.1)
5. **Fix the fraud-summary leak** + regression test. (§4.1)
6. **A transport-only console shell** — the fleet, its routes, its money, its people. Nothing about registrations, sectors, Jamii or eStores is reachable from it. (§1.1)

At the end of Phase 1 we can stand next to Voltic's own claims and answer every one, plus show them profit-per-route with a *verified* cost side.

### Phase 2 — Make it faster and more trustworthy than anything in the market (≈6–8 weeks)

7. **Offline-first crew writes.** Local queue in the Flutter app; IndexedDB outbox on the counter surfaces, reusing `apps/store/src/lib/pos-offline.ts`'s pattern. Signed, idempotent, replay-safe. (§1.4)
8. **The one-gesture contract**, task by task, with timing instrumentation. (§3.1, §3.2)
9. **Unified crew identity**, with the split TTL and device binding. (§1.5, §3.3)
10. **Passenger live-bus tracking** — now a thin view over `VehiclePing`. (§1.2)
11. **ePOD** on parcel and passenger handoffs. (§4.3)

### Phase 3 — Make it hard to leave (≈8–12 weeks)

12. **Revenue Integrity Statement** with public verification. (§2.2)
13. **Parcel-on-passenger-fleet**, priced against the near-zero marginal cost, sold as a new revenue line to existing operators. (§2.3)
14. **USSD** — build `services/channels`, ticket booking first. This is the one item requiring a new service in a language we don't yet ship; scope it honestly. (§2.5)
15. **Fleet health from money**: fuel-per-km outliers, `NEEDS_REPAIR` joined to forward bookings, service intervals from odometer readings captured in (3).

### What to say no to

- **Spare-parts purchasing.** Voltic lists it; it's a procurement module that will consume a quarter and win no deals. Cost *capture* (§1.3) gives the owner the insight; buying parts through us gives them nothing.
- **Generic employee surveillance.** "Track what employees do in office and on the road" is Voltic's framing, and it is a worse product than ours. Our position is *attributable actions and honest variance* — which crews will actually cooperate with, because it also protects them from being blamed for someone else's shortfall. A crew that trusts the system enters real numbers into it; a crew that feels spied on learns to defeat it. This is a product decision, not a values statement.
- **A second admin app for transport.** The console shell in Phase 1 (6) is a capability-filtered view of what exists. Forking the app doubles the surface we have to keep secure.
- **Anything that can't work offline.** Per §1.4, in this market that is the same as saying it doesn't work.

---

## 6 · The one-sentence positioning

> **Voltic tells a bus owner what their fleet reported. Esoqo lets them prove it — to their bank, their insurer, and themselves — and does it in four seconds with no network.**

Everything in Phase 1 exists to make the first clause true. Everything in Phase 2 makes the second. Phase 3 is why they stay.

---

## Appendix — code anchors for every claim above

| Claim | Anchor |
|---|---|
| `ListingSchedule` has no vehicle/crew/trip FK | `packages/db/prisma/schema.prisma:4867` — `vehicleOrHallLabel String?` is free text; no FK; no Go linkage |
| Physical fleet plane | `schema.prisma:5152` (`FleetVehicle`), `:5177` (`CrewMember`), `:5257` (`Trip`), `:5298` (`VehiclePing`), `:5352` (`CollectionDeclaration`) |
| Cash variance already derived | `services/core-go/internal/dbx/fleet.go:710` — `GetFleetOverview`, `CashVarianceToday` |
| No cost/expense model anywhere | repo-wide: zero matches for `maintenance`, `spare part`, `odometer`, `per route`, `payroll`; `fuel` only via `TripEndStatus.NEEDS_FUEL` (`schema.prisma`) |
| Offline exists only in retail PoS | `apps/store/src/lib/pos-offline.ts`; no local-write persistence in `mobile/esoqo_app/lib` |
| Counter is a blocking round trip | `apps/app/src/app/parcel-org/counter/FrontDeskClient.tsx:118` |
| Parcel manifest already built | `dbx/parcel_fleet.go:252` `GetTripManifest`; `apps/admin/.../parcels/trips/[id]/manifest/ManifestSheet.tsx` |
| Parcels ride passenger trips | `schema.prisma:3585` `Parcel.tripId`; `:5289` comment |
| Universal scanner | `docs/proposals/universal-scan-and-code-mint.md`; `GET /v1/scan/resolve` |
| Fraud summary cross-tenant leak | `dbx/fraud.go:44,50` (no org filter); `authsvc/capabilities.go:185–205` (`SCANNER` holds `ticketorg.read`); `httpapi/handlers_fraud.go` comment vs. behaviour |
| AGENT identity weakness | `docs/proposals/esoqo-unified-crew-identity.md`; `authsvc/capabilities.go:172–199` |
| USSD not built | `services/channels/README.md` — "Status: not started" |
| Admin surface breadth | 48 `page.tsx` across 22 sections under `apps/admin/src/app/(dashboard)` |
| Deploy/migration risk | `README.md` § *Deployed* |
| Prior parcel competitive work | `docs/proposals/parcel-audit-and-pilot-plan.md` |
