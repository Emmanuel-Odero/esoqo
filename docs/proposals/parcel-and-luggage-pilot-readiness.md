# Parcel + Passenger Luggage — Pilot Readiness

**Status:** largely implemented · 2026-09-20
**Scope:** narrowed to the two things being piloted — parcel management, and passenger luggage labelling
**Supersedes, on one point:** `docs/proposals/transport-competitive-strategy.md` §1.4 — see §0 below

> **Implementation status.** §2.1, §2.2, §2.4 and all of §3 are built — see
> the change log at the end. §2.3 turned out to rest on a wrong premise
> and is **not** built; §2.5 is not built. Both are corrected and
> restated in that log rather than quietly edited out of the body above,
> so the reasoning that led to them stays legible.

---

## 0 · Correction to the earlier strategy note

The strategy document said the counter has no offline support. That was wrong, and the mistake matters because it understates how close the parcel side is.

`packages/ui/src/parcelOfflineQueue.ts` exists and is one of the better-reasoned modules in the repo. It queues counter intake in IndexedDB and — crucially — solves replay safety without an idempotency table by observing that **the pre-printed code on the sticker *is* the idempotency key**, minted before the parcel existed and spent under `FOR UPDATE` inside `BookParcel`'s `existingCode` transaction. A replay that fails with "that label isn't unused" has in fact succeeded. That is a genuinely elegant piece of design and it is the reason offline intake here is honest rather than a hack.

What remains true, and is the actual constraint on this pilot, is narrower and sharper: **the queue is only wired to intake.** Grep for its importers and there is exactly one — `packages/ui/src/ParcelCounter.tsx`. Everything that happens to a parcel *after* the desk is online-only. §2.1.

---

## 1 · Where the two features actually stand

### 1.1 Parcel management is far more built than the last audit suggests

`docs/proposals/parcel-audit-and-pilot-plan.md` lists COD, ePOD, insurance, courier earnings and vetting evidence as gaps. Most have since shipped. The current domain is **24 models** and closes nearly all of them:

`Parcel` · `ParcelLabelStock` · `ParcelOrg` · `ParcelOrgStaff` · `ParcelPricingRule` · `ParcelHandoff` · `ParcelShipment` · `ParcelShipmentItem` · `ParcelCourier` · `ParcelCourierTariff` · `ParcelCourierPayout` · `ParcelCourierPing` · `ParcelZone` · `ParcelDistanceRate` · `ParcelAgent` · `ParcelDispatch` · `ParcelDispatchCrew` · `ParcelDispatchReceiver` · `ParcelDispatchPing` · `ParcelCoverageTier` · `ParcelDeliveryAttempt` · `ParcelCodPolicy` · `ParcelCodRemittance` · `CourierTrip`

Specifically now present, all verified in `schema.prisma:3200–3550`:

- **The custody bracket** — `intakePhotoUrl`/`intakePhotoAt` paired with `podPhotoUrl`. The schema comment states the reasoning exactly right: *"with only the second one every dispute is the customer's word against the courier's."*
- **Intake as a distinct act from booking** — `intakeConfirmedAt` + `intakeConfirmedByStaffId` gate the sender/receiver SMS, so nobody is told a parcel is moving because a form was submitted.
- **`serviceTicketNumber` (`TCK-`) vs `code` (`PKG-`)** — a self-service booker gets a bearer credential scoped to "prove you booked this", not "track this". The tracking code only activates at intake. This is a subtle and correct piece of security design.
- **Volumetric weight** with a refusal to guess a missing third dimension, and `ChargeableKg` taking the greater. Tested.
- **Contents declaration** as timestamp-plus-person, not a boolean — *"six weeks later 'was this declared' is nearly useless next to 'who asked, and when'."*
- **Addressing that degrades honestly** — pin (7 d.p.), then zone, then free text.
- **Frozen promises** — `slaDeadlineAt`, `transportMode`, `coverageFeeKes`, `platformFeeKes`/`orgEarningsKes` all copied at commit time so a later rate-card edit can't reshuffle an in-flight parcel or move money already split.
- **Signed labels** (`fleetqr/label.go`) — a truncated HMAC in the QR, scoped so it can't be replayed as a trip or voucher signature, bound to company *and* batch so a stolen pad stays individually well-formed while the database knows it was withdrawn. A forgery fails **offline, at the scanner, before any request**, and `/p/[code]` renders an explicit "this is not a genuine label" verdict rather than a tracking page.
- **Money maths is tested** — COD allocation always reconciles, tariffs never pay more than the sender paid, revenue splits clamp and round, coverage fees land on an exact cent.

That is a pilot-grade system. The remaining work is not features; it is the five items in §2.

### 1.2 Passenger luggage labelling is not built

There is no luggage concept anywhere in the codebase. Repo-wide, "luggage" returns exactly **two** hits — both the same string in a content-type picker:

```
packages/ui/src/ParcelCounter.tsx:38          'Luggage / Suitcase', 'Backpack', 'Box / Carton', …
apps/admin/.../labels/LabelInfoModal.tsx:17   'Luggage / Suitcase', 'Backpack', 'Box / Carton', …
```

"baggage", "bag tag", `LUG-` and `BAG-` return nothing.

So today, labelling a passenger's suitcase means booking it as a parcel with `itemType: 'Luggage / Suitcase'`. That will demo. It should not be what ships, for the reasons in §3.

The good news is that the hard parts are already built and reusable: pre-printed pads (`ParcelLabelStock`), field-attached info before any booking exists, code minting and signing (`fleetqr`), the universal resolver, and `Parcel.tripId`/`dropStageId` proving the "riding an actual passenger trip, coming off at a named stage" pattern.

---

## 2 · Getting the parcel pilot to near-perfection

Five items. None is large. They are ordered by what breaks first in the field.

### 2.1 Offline covers the desk but not the road — and the road is where the pilot runs

The queue is wired to intake only. Every custody event after that is an online-only round trip:

| Event | Where it happens | Offline today |
|---|---|---|
| Counter intake / booking | station desk | ✅ queued |
| `ScanHandoff` — custody change | roadside, boot of a bus | ❌ |
| Board parcel onto trip (`BoardParcelOnTrip`) | loading bay, stage | ❌ |
| Drop parcel at stage (`DropParcelFromTrip`) | intermediate stage, often at night | ❌ |
| Deliver + delivery-code entry (`DeliverParcel`) | receiver's door / shop | ❌ |
| Intake photo, POD photo | both ends | ❌ (see §2.3) |
| Delivery attempt (`ParcelDeliveryAttempt`) | receiver's door | ❌ |

The Flutter app (`mobile/esoqo_app`) has no local write persistence at all — no `hive`, no `sqflite`, no `isar`, no outbox. So the surface that crews actually hold is the one with no queue, while the desk — which usually has the better connection — is the one that has it.

This is the binding constraint. A station clerk in Kisumu is protected; a conductor dropping a parcel at Sachangwan at 21:40 is not, and when his scan fails he does what people do, which is hand the box over and move on. The parcel then arrives in the data as still-on-the-bus. Every downstream claim — turnaround time, custody chain, the dispute-settling photo pair — is void for that parcel, and the console reports it confidently.

**Fix:** generalise the queue from "bookings" to "custody events". The idempotency argument extends cleanly and is arguably stronger: a handoff is keyed by `(parcelCode, toStatus)` and the server already enforces a legal status transition (`NextHandoffStatus`, tested), so a replayed board-scan on an already-boarded parcel is a no-op rather than a duplicate. `ParcelHandoff` is append-only, which is exactly the shape that tolerates replay. Then port the same queue to Flutter — same contract, different storage.

### 2.2 Offline dedupe hinges on matching an error message in prose

```ts
// parcelOfflineQueue.ts
function alreadySpent(error: string): boolean {
  return /unused pre-printed label/i.test(error);
}
```

```go
// dbx/parcels.go:350
return "", "", "", "", &ParcelError{"BAD_INPUT", "That label code isn't a known, unused pre-printed label"}
```

The module's own comment admits this: *"Brittle by nature; kept to one place so it is one line to fix."* It is one line to fix on the client — but the thing that breaks it is a copy-edit in Go, made by someone who has no reason to know a regex in a TypeScript package depends on their wording. The failure is silent and lands on the clerk as a permanently stuck queue item for a parcel that shipped fine.

`ParcelError` already carries a code field; it is just set to the generic `BAD_INPUT` here. **Fix:** introduce `LABEL_ALREADY_SPENT` as its own code, match on the code, and leave the prose free to change. Add a test on each side asserting the pair agrees. Ten minutes, and it removes the only fragile joint in an otherwise airtight offline story.

### 2.3 An offline intake produces a parcel with no intake photo

`intakePhotoUrl` is a storage URL, so capturing it needs an upload. A queued booking has no upload path, which means the custody bracket the schema explicitly relies on — *"condition when we took it in, as `podPhotoUrl` is condition when we handed it over"* — is broken precisely on the parcels taken in during an outage, and an outage is when records are thinnest and disputes most likely.

**Fix:** a second IndexedDB store holding photo blobs keyed by the same pre-printed code, flushed after the booking it belongs to succeeds. Same for POD once §2.1 lands. Cap it (say 20 pending photos, oldest evicted with a visible warning) so a week-long outage can't fill the device.

### 2.4 The label prints no human-readable destination — decide deliberately whether that's right here

`ParcelLabel.tsx` is code-only by design, and the comment explains why:

> *sender/receiver/route/weight used to be on here too, but a label rides in the open on a box in transit and gets handled by people who never open the app — the actual shipment details now live behind a scan instead.*

For a warehouse, a scanner gun and a privacy review, that reasoning is correct: printing a receiver's name and phone number on adhesive on the outside of a box is a real data-protection exposure, and the ODPC checklist in the README is still open.

But it assumes every handler has a working scanner. In this pilot they will not — §2.1 is exactly about the moments they don't. A conductor sorting eleven boxes at a stage with a dying phone needs to know which come off *here*, and a QR cannot tell him that.

**Recommendation:** add one line, and only one — the **destination stage**, in large type. Not the sender, not the receiver, not the phone number. A destination is operational routing information, not personal data, so it adds no PII exposure while removing the need to scan eleven boxes to find two. Keep everything else behind the scan.

### 2.5 Instrument the pilot, or the four-second claim stays unfalsifiable

`ParcelCounter`'s header already states the standard — *"counter work is measured in seconds per customer and every route transition is a stall"* — and the form is built to it: one view, not a wizard; scan field holds focus from mount; a handheld gun submits without touching the mouse.

Measure it, per station and per role:

- seconds from first scan to label printed (p50 / p95)
- scans per parcel across its life — the number that catches a workflow making people scan twice
- share of custody events captured offline and later synced (this is the honesty metric for §2.1)
- share of parcels holding **both** intake and POD photos (the §2.3 metric)
- queued-but-stuck items, aged (the §2.2 metric)
- COD expected vs. remitted variance per rider

Two of those are the pilot's actual success criteria; the rest exist so a regression shows up as a number instead of a complaint. And "intake, p95, 3.1 seconds, measured across 4,000 parcels" is a sentence no competitor in this market is currently in a position to say.

---

## 3 · Passenger luggage: design it as its own thing

### 3.1 Why luggage is not a parcel

Modelling luggage as a `Parcel` with a flag will work on day one and hurt continuously afterwards. The two have almost nothing in common operationally:

| | Parcel | Passenger luggage |
|---|---|---|
| Who receives it | a **third party** at the far end | the **same person** who handed it over |
| Custody | a chain of handoffs across couriers, agents, trips | a **bracket** — on at boarding, off at alighting, one vehicle |
| Journey | may take days, multiple legs, re-routing | ends when the bus ends |
| Price | the product; rules, zones, distance, volumetric, COD | usually **free with the ticket**; at most an excess-weight fee |
| Proof at the far end | `deliveryCode` typed by a receiver who was sent it | the passenger is **standing there** with a stub |
| SLA | hours, `slaDeadlineAt`, on-time % | arrives when the bus arrives; SLA is meaningless |
| Dominant failure | never delivered, or delivered late | **taken by the wrong passenger at an intermediate stage** |
| Volume shape | tens per station per day | 20–50 pieces per departure, all within 3 minutes of boarding |

`Parcel` carries roughly sixty columns, of which about fifty are meaningless for a bag: `receiverName`/`receiverMsisdn`, `deliveryCode`, all COD, all zone/distance/coverage/payout, `assignedCollectorPartyId`, `ParcelDeliveryAttempt`, `slaDeadlineAt`. Its status machine (`DRAFT_PENDING_PAYMENT → BOOKED → … → DELIVERED`) does not describe a suitcase. Forcing luggage through it means every parcel query grows a filter, every parcel invariant grows an exception, and the parcel product gets slower to change forever in exchange for saving one migration now.

Note too the volume shape in that last row: it is the real design driver. Forty bags in three minutes, at a dark stage, is a fundamentally different UX problem from twelve parcels across a morning at a desk.

### 3.2 What to reuse — which is most of the machinery

Build a thin new model; share everything underneath.

- **`ParcelLabelStock` — the pre-printed pads.** Already exactly right for this: a pad is issued to a company, tracked by batch, voidable in one statement, and carries field-attached info (`itemDescription`, `destination`, `senderName`, `weightRangeKg`, dimensions) recorded *before any booking exists*. That "label first, record later" shape is precisely how a bag gets tagged at a bus stage. A luggage tag is a pre-printed code, plus an attach-info event, plus a trip binding.
- **`fleetqr`** — minting, unbiased sampling, retry-on-`23505`, and the checksum character. Register `LUG-` with a checksum: luggage codes get read aloud and typed by hand more than parcel codes do, because the person asking is at a counter looking at a stub.
- **`SignLabel` / `VerifyLabel` / `/p/[code]`** — a passenger can verify their own tag is genuine, offline, before they hand the bag over. Nobody in this market offers that.
- **`GET /v1/scan/resolve`** — add a `luggage` kind. Crews keep one gesture.
- **`Parcel.tripId` + `dropStageId`** — the pattern for "riding an actual passenger trip, coming off at a named stage" is proven; luggage uses the same two columns against the same `Trip` and `FareStage`.
- **The offline queue from §2.1** — luggage needs it more than parcels do, not less. Boarding happens at the roadside, always.

### 3.3 The model

```
LuggageTag
  code                  LUG- + checksum, unique; from ParcelLabelStock or minted
  tripId                the Trip this bag is riding          ← required
  ticketId?             the passenger's Ticket, when they hold one
  passengerName         always captured, ticket or not
  passengerMsisdn?
  pieceNo, pieceCount   "2 of 3" — the thing that catches a missing bag
  dropStageId?          FareStage; null = rides to the terminus
  destinationLabel      what prints in large type on the tag
  weightKg?             only when an excess fee applies
  excessFeeKes?         null when carried free with the ticket
  photoUrl?             one photo at boarding; the whole dispute, settled
  boardedAt, boardedByCrewId
  claimedAt, claimedByCrewId
  claimMethod           STUB_SCAN | CODE_TYPED | TICKET_MATCH | OVERRIDE
  claimOverrideReason?  required when claimMethod = OVERRIDE
  status                TAGGED | ABOARD | CLAIMED | UNCLAIMED | MISSING
```

Design notes, each carrying a reason:

- **`pieceNo`/`pieceCount` is the highest-value field here.** "3 of 4" is what makes a missing bag visible at the moment of claiming rather than three hours later on a phone call. It costs nothing and it is the single field that turns a tag into a control.
- **`claimMethod` + `claimOverrideReason`** rather than a boolean. Overrides will happen — a stub gets lost, a phone dies — and the honest record is *which* override and why, in the same spirit as `contentsDeclaredAt`'s who-and-when. A month of override reasons is also the best available list of what to fix next.
- **`ticketId` optional.** Plenty of passengers board without a digital ticket, and a luggage system that refuses them is a luggage system crews will stop using by lunchtime. Name and phone always; ticket when it exists.
- **`tripId` required.** A bag with no trip is not a bag this system can help with, and allowing it would recreate the parcel product badly.
- **No price rules, no zones, no COD, no SLA.** If excess weight needs charging, it is one amount on one row, posted through the existing ledger — not a rate card.

### 3.4 The tag prints differently from a parcel label

This is where §2.4's tension resolves in the opposite direction, and deliberately so.

A parcel label is code-only because its handlers have scanners and its box carries a stranger's details. A luggage tag's handler is a conductor with forty bags and three minutes, and the "details" are the passenger standing in front of him. So the tag leads with what a human reads at arm's length in bad light:

```
┌────────────────────────────────┐
│  NAKURU              2 of 3    │   ← destination huge; piece count beside it
│  ─────────────────────────     │
│  [QR]    LUG-7K2M9P            │   ← code, human-readable, checksummed
│          WANJIKU M.            │   ← surname + initial only
└────────────────────────────────┘
        ✂ ─────────────────
┌────────────────────────────────┐
│  LUG-7K2M9P          2 of 3    │   ← the passenger's stub: code + piece only
└────────────────────────────────┘
```

- **Destination in the largest type on the tag.** This is the routing decision made a hundred times per trip; it should never require a scan.
- **Surname and initial, not a full name or a phone number.** Enough for a conductor to call it out over a crowd; not enough to be a PII leak on adhesive. This is the same judgement §2.4 reaches for parcels, applied consistently.
- **A tear-off stub, matching code and piece count.** The claim check is physical first and digital second, which is what lets it work with a dead phone. The digital scan is the *verifiable* path; the stub is the *always-works* path. Both, not one.
- **Two pieces per label means the pad layout changes** — `ParcelLabel.tsx`'s 90×50mm at 2-across/5-down A4 becomes a tag plus stub. Keep the module's existing discipline: millimetres not pixels, offscreen canvas rasterised to `<img>`. That comment block documents real print bugs already paid for once; don't re-learn them.

### 3.5 The two crew flows, against the four-second bar

**Boarding — must sustain ~40 bags in 3 minutes, i.e. under 5 seconds per bag, offline:**

1. Conductor opens the trip once. It stays open; every subsequent bag is inside it.
2. Peel the next tag off the pad, stick it on the bag, scan it.
3. Passenger's name: scan their ticket QR if they have one (auto-fills, zero typing), otherwise type a surname — the only typing in the flow.
4. Destination: a chip row from `FareStage` rows on this route, pre-sorted by which stages this trip actually serves. One tap.
5. Piece count: defaults to "1 of 1"; one tap on "+" makes it "1 of 2" and queues the next tag in the same group.
6. Tear the stub, hand it over. Local write, green flash, field re-focuses for the next bag.

No route transitions, no confirm dialog, one typed field at most, and it completes with the radio off.

**Claiming — must work at a stage in the dark with no signal:**

1. Passenger presents stub. Conductor scans or types the code.
2. Screen shows destination, piece count, and **whether the other pieces in that group have been claimed** — "2 of 3, one still aboard" is the whole point.
3. Green = matched, mark claimed. No match, or no stub → override path, which demands a reason and is flagged on the trip's close-out.
4. At close of trip, anything still `ABOARD` becomes `UNCLAIMED` and appears on the conductor's close-out screen next to `TripEndStatus` — the screen they already have to visit.

That last step is what makes the system self-auditing rather than aspirational: the bag nobody claimed surfaces to the person who was holding it, while they are still holding it.

---

## 4 · Sequence

**Weeks 1–2 — close the parcel gaps.** §2.2 (error code, hours) → §2.1 (generalise the queue to custody events; web then Flutter) → §2.3 (photo blob queue) → §2.5 (instrumentation, before the pilot rather than after, or there's no baseline) → §2.4 (destination line).

**Weeks 3–5 — luggage.** `LuggageTag` + `LUG-` registration → the tag/stub print layout → the boarding flow → the claim flow → close-out reconciliation → `luggage` kind in `/v1/scan/resolve`.

**Week 6 — one route, end to end.** One corridor, one company, real pads, real bags, real parcels in the same boot. Watch the six numbers in §2.5 and the override-reason list from §3.3. Both of those tell you what week 7 is for.

**Do not build for this pilot:** luggage pricing rules or zones, luggage insurance tiers, a separate luggage app or console, or a luggage SLA. Each one is a parcel feature wearing a bag's clothes, and §3.1 is the argument against all four.

---

## 5 · What this pilot can claim that no competitor can

- **A printed tag a passenger can verify is genuine** — `fleetqr.SignLabel` + `/p/[code]`, failing *offline at the scanner* and rendering an explicit forgery verdict rather than a tracking page.
- **One scanner for parcels, luggage, tickets, fares and payments** — `/v1/scan/resolve`, one learned gesture per crew member.
- **Parcels and luggage in the same boot on the same trip, on one manifest** — `Parcel.tripId` and `GetTripManifest` already sorted by drop stage. Marginal cost of a parcel in a boot already making the journey is near zero.
- **"3 of 4" caught at the stage, not on a phone call the next day.**
- **An intake/POD photo pair that settles damage disputes**, and — once §2.1 and §2.3 land — one that still exists when the network didn't.
- **A measured turnaround number**, because §2.5 measured it.

---

## Appendix — anchors

| Claim | Anchor |
|---|---|
| Counter offline intake exists | `packages/ui/src/parcelOfflineQueue.ts`; code-as-idempotency-key reasoning in its header |
| Queue is wired to intake only | sole importer is `packages/ui/src/ParcelCounter.tsx:7`, used at `:299` (queue) and `:620` (flush) |
| No offline persistence in the crew app | no `hive`/`sqflite`/`isar`/outbox anywhere in `mobile/esoqo_app/lib` |
| Dedupe matches error prose | `parcelOfflineQueue.ts` `alreadySpent()` vs. `dbx/parcels.go:350` `ParcelError{"BAD_INPUT", …}` |
| Custody bracket / intake vs. POD photo | `schema.prisma:3200–3550` (`intakePhotoUrl`, `intakeConfirmedAt`, `serviceTicketNumber`) |
| Label is code-only, and why | `packages/ui/src/ParcelLabel.tsx` header; 90×50mm, 2-across/5-down A4 |
| Label signing | `services/core-go/internal/fleetqr/label.go` (`LabelSigScope`, `LabelSigLength`, `SignLabel`) |
| Label resolver vs. SMS tracker | `apps/web/src/app/p/[code]/page.tsx` and `t/[code]/page.tsx`; `trackingUrlFor` |
| Pre-printed pads with field-attached info | `schema.prisma:3716` `ParcelLabelStock` |
| Parcels ride passenger trips | `schema.prisma:3585` `Parcel.tripId`; `dropStageId` at `:3596`; `dbx/parcel_fleet.go:252` `GetTripManifest` |
| Money maths tested | `internal/dbx/parcel_cod_test.go`, `parcel_courier_earnings_test.go`, `parcel_volumetric_test.go` |
| Luggage absent | repo-wide, "luggage" hits only `ParcelCounter.tsx:38` and `LabelInfoModal.tsx:17`, both the same picker string; "baggage"/`LUG-`/`BAG-` return nothing |
| Counter design standard | `packages/ui/src/ParcelCounter.tsx` header — "one view, not a wizard" |

---

## Change log — what was built, and what this document got wrong

Written after implementing the above. Corrections first, because a
proposal that quietly edits away its own mistakes teaches nobody
anything.

### Corrected: §2.3 rested on a wrong premise

§2.3 said an offline intake "produces a parcel with no intake photo",
which implied the online path captured one. It does not. Checking the
code rather than the schema:

- **`parcel.intakePhotoUrl` has no writer anywhere** outside
  `schema.prisma`. Intake photos are not captured online or offline, by
  any surface. The custody bracket that column exists to provide has
  never been closed for any parcel.
- **POD capture does exist**, and I was wrong to imply otherwise — it is
  in the Flutter app
  (`mobile/esoqo_app/lib/features/parcels/complete_delivery_screen.dart`,
  `image_picker` + camera), and `dbx.DeliverParcel` requires a photo for
  a staff-override hand-over with no delivery code.

So the real gap is larger and differently shaped than "the queue does
not cover photos": intake capture does not exist, and the surface that
does capture photos (Flutter) has no offline layer at all. An
IndexedDB blob store in `packages/ui` would have held nothing. One was
started and removed; `offlineDb.ts` carries a note saying why, so the
next person does not re-add it speculatively.

**Correct scope, not folded in:** build intake capture, give the Flutter
app an offline layer, then queue blobs there. That is a bigger piece of
work than the other four items and belongs in its own change.

### Not built: §2.5, instrumentation

Deliberately left. It is the right next thing — without it the
four-second claim stays unfalsifiable and the pilot has no baseline —
but it is a measurement layer across several surfaces rather than a fix
to one, and it was not part of "close the gaps".

### Built

**§2.2 — the fragile joint, closed.** `LABEL_ALREADY_SPENT` is now a
real error code on both server paths that mint against pre-printed
stock (`dbx.BookParcel`'s `ExistingCode` branch and
`dbx.importOrgParcelWithLabel`), mapped to 409. It is threaded through
`ParcelOrgRequestError`/`GoRequestError` — both fetch wrappers
previously discarded the code and kept only the prose — and the client
branches on it. The prose regex survives as a fallback for a tab open
across a deploy, with a test and a comment saying when it can go.

A second instance was found while doing this: the **courier company's
own counter** — the path the pilot actually books through — returned a
differently-worded message that matched the old regex only because
`"unused pre-printed label"` happens to be a substring of
`"unused pre-printed labels"`. One pluralisation from stranding
parcels.

Named `errorCode`, not `code`, on every failure shape: the success
shapes already use `code` to mean a *parcel* code, and one field name
with two meanings depending on a sibling boolean is a trap.

**§2.1 — offline now covers the road.** `custodyQueue.ts` queues custody
moves, keyed by `(intent, code)`. The replay argument is stronger than
the booking queue's: these are transitions on rows that already exist,
and the server already makes them idempotent — `ScanHandoff` returns
success for "already holding it — replayed scan", `BoardLuggage`
returns an already-ABOARD tag unchanged. Wired into the front desk's
walk-in receipt and the luggage boarding scan, each with a flush on
mount / `online` / interval, and a **visible** held-count banner: a
queue a clerk cannot see is worse than none, because they go home
believing the day's work left the device.

`offlineDb.ts` now owns the database and its version. Two modules each
calling `indexedDB.open()` with their own version is a `VersionError`
for whichever loses, surfacing as a desk that silently stops queueing.

**§2.4 — destination on the label.** Narrower than proposed, because
the proposal was partly wrong: a `route` band already existed, but only
the *admin* print passed it, so the label printed at the counter — the
one that actually goes on the box in the pilot — carried no destination
at all even though the clerk had just typed it. Now wired from both
counter print sites, promoted out of the cramped header into its own
5.5mm band (QR 27mm → 24mm to fund it), and passed through
`dropPointFor`, which keeps only the leading locality: "Westlands,
opposite Sarit" prints WESTLANDS. A clerk's free text can be most of a
street address, and this band is large on something that rides in the
open.

**§3 — luggage, end to end.** `LuggageTag` as its own model (the §3.1
argument held up), `LUG-` registered checksummed, `luggage` in
`/v1/scan/resolve`, four crew routes, three capabilities across both
catalogues, the tag+stub print layout, and the crew desk. Two database
CHECK constraints carry rules the code also enforces — a piece number
outside its count, and an OVERRIDE with no reason — because a release
with no stub and no explanation is the one record a future second
caller must not be able to write by accident. `CloseTrip` now sweeps
anything still aboard to UNCLAIMED in the same transaction and returns
it, so the bags surface while the crew is still holding them.

One bug was caught only by running it: `luggage` resolved as a *kind*
with its payload silently dropped, because `ScanHit` had no field for
it and `hit()`'s switch no case. It compiles, vets and looks right.
`scan_hit_test.go` now asserts every kind carries its payload, and was
confirmed to fail without the fix.

### Verification

`go build`, `go vet`, `go test ./...` green. All TS workspaces
typecheck; `@esoqo/app` production build succeeds with
`/org/[orgId]/luggage` registered. `@esoqo/ui` gained vitest (4 files,
27 tests). The migration was applied and its SQL exercised directly —
both CHECK constraints confirmed firing, manifest ordering confirmed
(terminus sorts last), close-out sweep confirmed to leave CLAIMED rows
alone. The scan resolver was tested against a running server with a
real row: `Mary Nyambura Wanjiku` → `WANJIKU M.`, the PII reduction
working end to end.

One pre-existing failure is untouched and unrelated: `@esoqo/web`
typecheck fails on `src/app/parcels/booking-response.test.ts` importing
a `.ts` extension, from commit 900772f.
