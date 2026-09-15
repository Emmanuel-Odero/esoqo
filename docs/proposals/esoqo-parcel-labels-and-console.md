# esoqo Parcels — The Label, The Counter, and Who Gets to See What

**Status:** proposed
**Scopes:** `core-go` (fleetqr, dbx/parcels, handlers_parcels, handlers_admin_parcels), `packages/db` (parcel, parcel_label_stock), `apps/admin` (parcels), `apps/app` (`/parcel-org`), `apps/web` (tracking), mobile scan.

---

## 0. The finding

The parcel domain model is unusually well built — 60+ routes, SLAs, custody chains, exception states, COD floats, revenue splits, coverage tiers. The expensive half is done. Three things stop it short:

1. **The label is a dead string.** Its QR encodes `PKG-ABC12X` as plain text, so a phone camera shows a code and nowhere to go. Stock belongs to nobody, is signed by nothing, and carries no brand.
2. **The dashboard can print a code but cannot read one**, has no screen for taking a parcel in at a counter, and permanently hides any label the moment somebody fills it in.
3. **Everyone who scans sees the same thing** — correctly PII-minimal, which means the actual receiver is starved and has no path from "stranger" to "this is mine".

These are one problem seen from three sides: the physical object, the screen that fills it in, and the page it resolves to.

---

## 1. Audit

Verified against the tree. Severity is operational consequence, not code quality.

### Blocking

| # | Finding | Evidence |
| --- | --- | --- |
| **A1** | **The QR encodes a bare string.** `QRCode.toCanvas(canvas, code)` — a phone camera shows plain text. Someone who finds a dropped box has nowhere to go. | `ParcelLabelPrint.tsx:76` |
| **A2** | **No scanner anywhere in admin.** `apps/admin` carries `qrcode` + `jsbarcode` — both *generators*. `html5-qrcode` exists only in `apps/web`. The dashboard that prints every label in the network cannot read one. | `apps/admin/package.json:19-22` vs `apps/web/package.json:20` |
| **A3** | **No intake screen at all.** `parcels/actions.ts` has 48 actions — assign, cancel, refund, flag, price, onboard, remit — and **not one creates a parcel**. `POST /v1/parcels` is reachable only from the customer web flow. A clerk with a walk-in customer has no screen. | `apps/admin/.../parcels/actions.ts` |
| **A4** | **Stock has no owner.** `parcel_label_stock` has no `parcelOrgId`, though `parcel` gained tenancy in the Sept 12 migration. Any authenticated actor can bind any blank code, and cost/revenue lands on the wrong tenant. | schema vs `20260912140000_parcel_org_tenancy` |
| **A5** | **Attached labels become invisible.** `ListUnusedParcelLabelStock` filters `WHERE "usedAt" IS NULL AND "infoAttachedAt" IS NULL`, and it is the only list endpoint. Fill in a label and it drops out of the product. | `dbx/parcels.go:1113` |
| **A6** | **Editing a label silently destroys data.** `LabelInfoModal` initialises every field to `''` and never fetches existing info; `AttachParcelLabelInfo` overwrites rather than merges. Reopen a filled label, correct one typo, save — the other six fields are now empty. | `LabelInfoModal.tsx:48-57` |
| **A7** | **The work queue structurally hides the work.** `AdminListParcels` is `ORDER BY "createdAt" DESC LIMIT 200` — no pagination, no cursor, no date filter. You get the 200 *newest*. Stuck parcels are by definition the *oldest*, so they are exactly what falls off the bottom, under a footer reading "200 shown" rather than "200 of 4,318". | `dbx/parcels.go:1713-1735` |

### Serious

| # | Finding |
| --- | --- |
| **A8** | **One projection for every scanner.** `GetParcelStatus` is guest-safe and has no tier above it. The receiver cannot get their own delivery address. |
| **A9** | **The nine KPI tiles are not clickable.** "Refunds owed: 7" is a plain `<div>`. The page names nine problems and offers no way to see any of them; the filter below is one status dropdown and a text box. |
| **A10** | **Courier companies cannot mint or print labels.** `/parcels/labels` is esoqo-admin only; `/parcel-org` has no labels route. The tenant that should own its stock has no way to get any. |
| **A11** | **The label is unsigned and unbranded.** A lookalike sticker printed by anyone is indistinguishable from ours, on the box and on the scan page. |
| **A12** | **"Other" with no free-text partner**, in both `ITEM_TYPE_OPTIONS` and `GENDER_OPTIONS`. Selecting "Other" records strictly less than if the field didn't exist. *(Standing rule on this project.)* |
| **A13** | **`ownerContact` is one unvalidated free-text field** for "phone or email". `packages/domain/src/phone.ts` exists and is unused. Nothing normalised can drive an OTP claim, an SMS, or a dedupe. |
| **A14** | **No dimensions, anywhere.** `weightRangeKg` is a five-bucket string; there is no L/W/H on `parcel` or on stock, so **no volumetric weight**. A bulky-but-light item is charged as light — a continuous, invisible margin leak on exactly the freight most likely to travel. |
| **A15** | **No manifest screen.** `GET /v1/parcels/trips/:tripId/manifest` exists and **no web surface calls it**. A driver leaves without a signed list of what is in the vehicle. |
| **A16** | **No bulk anything** — no multi-select, no bulk assign, no bulk print, no CSV export or import. |

### Small but confirmed

| # | Finding |
| --- | --- |
| A17 | `nav-routes.ts` is missing `/parcels/labels` and `/parcels/teams`, which `Shell.tsx:45-46` renders. The file's own comment says to keep them in sync by hand; they drifted. |
| A18 | `destination` on a label is free text, though the structured-info migration's stated motivation was "a destination picker" and `parcel_zone` / `parcel_agent` exist to back one. |
| A19 | No declared-value or coverage-tier capture at intake, despite `DeclaredValueKes` / `CoverageTierName` on the row and a full `CoverageEditor` screen. |
| A20 | No prohibited/dangerous-goods declaration at intake. |
| A21 | No item photo at intake — the standard defence against damage disputes. |

### What already works and should not be rebuilt

`parcel_label_stock`'s collision-safe minting (see [universal-scan-and-code-mint](./universal-scan-and-code-mint.md)); `AttachParcelLabelInfo`'s field-first capture; `GetParcelStatus`'s fallback so a never-booked label still resolves; `RequestParcelReceiptOtp`, which already establishes the right rule — **the OTP goes to the number stored on the parcel, never to one the caller supplies**; the `/parcel-org` dashboard; the `/parcels/live` control tower; the KPI tiles' choice of *which* nine numbers matter.

---

## 2. What the industry does

### Pre-printed stock is normal, and it is always account-bound

DHL waybill pads, FedEx airbills and UPS label stock are all issued as **pre-numbered serial ranges assigned to a shipper account**. The number on the paper *is* the billing relationship. Misuse isn't blocked by the paper — it's caught at first induction scan, because the serial belongs to an account that didn't tender it. **Steal: issue in ranges, to a named holder, enforce at bind time.**

**GS1 SSCC-18 / UCC-128** puts a GS1 company prefix inside the barcode, so the code structurally names its issuer. **Steal the idea, improve the mechanism** — a prefix is guessable, an HMAC is not.

**GS1 Digital Link** is the modern replacement for bare-code QRs: the QR *is* an HTTPS URL resolving to different content for different audiences. Exactly the "scan shows a tracking link" we want, and a standard rather than an invention. **Steal wholesale.**

### Intake is scan-first, always

ShipStation, Sendcloud, Shippo, Shiprocket, MyDHL+ and every warehouse WMS converge on one loop, and it inverts what this dashboard assumes:

> **The barcode is the input, not the output.**

The clerk scans first and the screen reorganises around that code. Typing by hand is the degraded path. Sendcloud calls it *scan-to-print*; warehouses call it *scan-pack-verify*; DHL counters call it *waybill capture*.

The mechanical detail that matters: **a scanner gun is a keyboard.** It types fast and presses Enter; you detect it by inter-keystroke timing (<30ms), not by integrating a device. Scan-first costs a `keydown` listener, not a hardware project — and the same screen works with a phone camera via `html5-qrcode`, already in this monorepo.

### The counter screen is one screen

Not a wizard. ShipStation's "Create Label", Sendcloud's "New parcel", Aramex's counter — all single-view, keyboard-navigable, price recalculating live. Counter work is measured in seconds per customer and every route transition is a stall.

### Weight and dimensions are captured together, and volumetric wins

Every carrier charges `max(actual, volumetric)`, where volumetric is `(L × W × H) / 5000` for air, `/6000` for road in several markets. This is the most common revenue leak in a young logistics operation, and it is invisible in reporting because nothing records what *should* have been charged.

### The dashboard is a worklist, not a ledger

Onfleet, Detrack, Circuit and Shipday structure the operator view as **queues with clocks**: unassigned, at risk, failed, aged. Each is a destination you land in and work down — oldest first, bulk-actionable, SLA countdown per row. Esoqo's KPI tiles already name these queues perfectly. They just aren't wired to anything, and the sort is backwards for the purpose.

### Address books, because counters serve the same people daily

A market trader ships to the same six shops every week. This matters more in a matatu-and-boda network than in e-commerce, because the senders are *repeat traders*, not one-off consumers.

### Tiered disclosure is already the norm

DPD asks for the postcode before showing detail. Amazon requires sign-in before showing an address. Royal Mail's public page is deliberately a stub. Nobody shows a full address to a bare tracking number. **Steal, and go one better:** our tiers are role-shaped, not just locked/unlocked.

### Four smaller things worth copying

- **The peel-off lodgement stub** the sender keeps (DHL) — removes the commonest support call, "I lost the paper".
- **Void-if-removed tamper adhesive** on the seal. Cheap, and visible trust is the product.
- **Manifests are paper, and that's correct** — not because the app is untrusted, but because a signature survives a dispute six weeks later when the phone was replaced.
- **Offline-tolerant intake.** A counter in Kisumu at 7am on bad data has to keep taking parcels. Almost nobody in this market does it.

---

## 3. Design

### 3.1 The central idea: one record, progressive intake

The product currently has **two unrelated features with two vocabularies for the same physical act**:

| | "Attach info to a label" | "Book a parcel" |
| --- | --- | --- |
| Parties | `ownerName`, `ownerContact` (one party, free text) | `senderName/Msisdn`, `receiverName/Msisdn` (two, structured) |
| Destination | free text | zone / agent / pin |
| Weight | five-bucket string | `weightKg` |
| Screen | `LabelInfoModal` | *(none in admin)* |
| Outcome | write-only; row vanishes | full lifecycle |

These are not two features. They are **the same counter interaction, interrupted at different points** — a handler sticking a label on a suitcase at a bus stage and a clerk booking a paid shipment are doing the same job with different amounts of time and information.

So: **one record, filled in as far as the moment allows.**

```
      ┌──────────────────────────────────────────────────────────┐
      │  SCAN  ▸  WHO  ▸  WHAT  ▸  MEASURE  ▸  PRICE  ▸  PRINT   │
      └──────────────────────────────────────────────────────────┘
        ▲         ▲                    ▲                     ▲
        │         │                    │                     │
     stage     counter              counter               counter
     handler   (no pay)             (quoted)              (paid)
     stops     stops                stops                 completes
     here      here                 here                  here
```

Every stop is valid, visible and resumable. Nothing is write-only. A label that only reached "SCAN + WHAT" is still listed, searchable, and resumable by whoever picks that box up next.

Concretely this means **retiring the parallel vocabulary**: `ownerName`/`ownerContact` become `senderName`/`senderMsisdn` on the stock row, which grows the same nullable receiver/destination shape a parcel has. One set of field names, one validation path (`packages/domain/phone.ts`), one destination picker, one screen. The migration is small — the structured columns landed this pilot cycle and the last one's comment already admits the data is ad-hoc test fill.

### 3.2 The Counter — `/parcels/counter`

One route. Keyboard-first. Never navigates away.

```
┌─ The Counter ──────────────────────────────── [⌘K] ─┐
│                                                      │
│   ┌────────────────────────────────────────────┐    │
│   │  ⌫  Scan a label, or type the code…        │    │  ← always focused
│   └────────────────────────────────────────────┘    │
│   📷 use camera          last: PKG-7QM2XK ✓ printed  │
│                                                      │
│  ── PKG-A4K9ZT ──────────── blank · esoqo · batch 12 │
│                                                      │
│  FROM  [Wanjiru Kamau        ] [0722 000 000    ] ★  │  ★ = saved party
│  TO    [Otieno Hardware      ] [0733 111 111    ] ★  │
│        [Kisumu ▾] ▸ [Westlands, Nairobi ▾]   📍pin   │
│                                                      │
│  WHAT  [Box / Carton ▾]  [flat-pack shelf unit    ]  │
│        ☐ contains none of the prohibited items       │
│  MEASURE  ⚖ 4.2 kg    ↔ 60 × 40 × 30 cm             │
│           volumetric 14.4 kg  →  charging 14.4 kg ⚠  │
│  VALUE  KES [12,000]   cover: [Standard ▾]  📷 photo │
│                                                      │
│  ───────────────────────────────────────────────────│
│  KES 1,240   ·  road · 2 days · SLA Thu 17:00        │
│  [ Save as blank ]  [ Quote only ]  [ Take payment ] │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Details that carry weight:

- **The scan field is always focused.** Gun input is detected by keystroke timing and auto-submits; nothing steals focus. A clerk never touches the mouse.
- **Scanning a code that already has a parcel** doesn't error — it opens that parcel. One box, every purpose. This is also the fix for A2 across the whole dashboard.
- **Volumetric is shown, not hidden.** The `⚠` fires when volumetric exceeds actual, so the clerk can *see* why the price moved and explain it. Fixes A14 in a way that is auditable rather than a silent price rise.
- **`Save as blank`** is the old `LabelInfoModal`, absorbed. Same screen, less filled in.
- **Saved parties (★)** — three letters of a repeat trader's name gets the row.
- **The prohibited-items tick is a positive affirmation**, recorded with the staff id. That's the artefact that matters if something goes wrong on a bus.
- **Offline**: intake queues to IndexedDB, prints the label from the already-minted code, reconciles on reconnect. Pre-printed stock makes offline intake genuinely sound rather than a hack — this is what it is *for*.

### 3.3 The label: the code stays typeable, the QR gets rich

Do **not** put a signature in the human-readable code. `PKG-ABC12X` is read down a phone line and typed into `/t/` by people standing in a shop; it has a checksum for exactly that reason and must stay six characters plus check.

The three marks carry three payloads:

| Mark | Payload | Read by |
| --- | --- | --- |
| Human text | `PKG-ABC12X` | People. Phones. Voice. |
| Code128 barcode | `PKG-ABC12X` | Handheld guns, which expect a bare code |
| QR | `https://esoqo.co.ke/p/PKG-ABC12X?k=<10-char sig>` | Any phone camera, and our own app |

The QR becoming a URL is the single highest-value change in this document. It costs one argument to `QRCode.toCanvas` and converts every parcel in the network into a working link for anyone holding it.

`/p/` (not `/t/`) because the new path is the *label* resolver — it verifies the signature, renders the trust verdict, then shows the same status panel. `/t/<code>` stays untouched for SMS, where the link must fit one GSM-7 segment. The app's scanner strips the origin, so `/v1/scan/resolve` needs no new kind.

**`k=` is `fleetqr.Sign` over `code | parcelOrgId | batchId`, truncated to ten characters. It is not the authorization — the database is.** What it buys:

- A forged or photocopied label fails **offline, at the scanner, before a DB round-trip** — mass-printed lookalikes never touch our infrastructure.
- A printed sticker becomes *verifiable as genuinely esoqo-issued* by a consumer with a phone. That is a marketing asset, not just a control.
- The failure mode becomes loud: an invalid `k` renders a red **"This is not an esoqo label"** instead of a tracking page. Every fake becomes an advert for the real thing.

A hand-typed code with no `k` still resolves, at the public tier only. Signature absent ≠ signature wrong — the same leniency the voucher/trip checksum guard already applies.

#### The physical label

90 × 50mm is right, and the mm-not-px discipline in `ParcelLabelPrint.tsx` should be left exactly as it is. What changes inside:

```
┌──────────────────────────────────────────┐
│ ◥esoqo            KISUMU ▸ NAIROBI    ⚡ │  ← brand + route band, colour-coded by lane
├───────────────┬──────────────────────────┤
│  ███ ▄▀ █▄▀   │  PKG-ABC12X              │
│  ▀▄█ QR  ██   │  ▌▌▌▐▌▌▐▐▌▌▐▌▌▐▌▌▌       │
│  █▄▀ ███ ▄█   │  Scan to track           │
├───────────────┴──────────────────────────┤
│ ✓ genuine esoqo label · esoqo.co.ke      │
└──────────────────────────────────────────┘
      ╌╌╌╌ peel here ╌╌╌╌
      sender's stub: PKG-ABC12X
```

The **route band** is the point. The most useful thing to a human sorting a pile of boxes at 5am is *where is this going*, readable at arm's length, without scanning. Blank stock prints it empty; attaching info is the moment a handler writes it in — which is the honest workflow. Colour per lane makes a mis-sorted box visible across a room.

### 3.4 Stock gets an owner, a batch, and a lifecycle

```sql
ALTER TABLE "parcel_label_stock"
  ADD COLUMN "parcelOrgId"  UUID REFERENCES "parcel_org"("id"),  -- NULL = esoqo-operated
  ADD COLUMN "batchId"      UUID NOT NULL,
  ADD COLUMN "issuedToOrgStaffId" UUID,
  ADD COLUMN "issuedAt"     TIMESTAMP(3),
  ADD COLUMN "voidedAt"     TIMESTAMP(3),
  ADD COLUMN "voidedReason" TEXT;
```

`parcelOrgId` nullable-means-esoqo follows the convention the tenancy migration already set, so no backfill invents a tenant that doesn't exist.

Two enforcement points, and they matter more than the crypto:

1. **Mint** — an org admin mints only into their own `parcelOrgId`; platform admin may mint into any.
2. **Bind** — `BookParcel`'s `existingCode` path refuses when `stock.parcelOrgId` differs from the acting staffer's org, and refuses outright when `voidedAt IS NOT NULL`. This is the induction-scan check DHL does on a waybill pad, and it is what makes "only one company can use these" true rather than aspirational.

`batchId` exists for the day a pad walks out of a branch: one `UPDATE … WHERE batchId = $1 AND usedAt IS NULL` voids the range, the way airlines recall AWB ranges.

**Five states, because the physical object has five:**

```
MINTED ──issue──▶ ISSUED ──attach──▶ AFFIXED ──book──▶ BOUND ──deliver──▶ SPENT
   └──────────────────── void ────────────────────┘
```

Derived from columns (`issuedAt`, `infoAttachedAt`, `usedAt`, `voidedAt`) rather than stored as an enum, so there is no state field to drift out of sync with the timestamps that are the real record. `ListUnusedParcelLabelStock` is already, quietly, distinguishing MINTED from AFFIXED. This just names it.

### 3.5 The label register — `/parcels/labels`, rebuilt

Fixes A5, A6, A10. Three tabs over one table, since it is one lifecycle:

| Tab | Predicate | Primary action |
| --- | --- | --- |
| Blank | no info, not bound | print, void |
| Filled | info attached, not bound | **resume in the Counter**, print, void |
| Spent | bound to a parcel | open the parcel |

Plus a batch view (mint → issue to a branch/agent → track shrinkage → void a range), search across attached info, and — scoped by `parcelOrgId` — **the same screen mounted at `/parcel-org/labels`** so a courier company mints and prints its own stock. That is what makes per-company ownership operationally true rather than merely enforced.

Editing loads existing values first. Non-negotiable.

### 3.6 Who gets to see what

**Tier 0 — public.** Anyone with the code. No auth. What `GetParcelStatus` returns now, plus the label-validity verdict and carrier brand: code, status, human status line, origin → destination *at town granularity*, ETA/SLA, created date. Never: names, any phone digits, price, exact pin, POD photo, owner contact.

**Tier 1 — party (OTP).** The public page offers *"This is my parcel"*. The caller submits a phone number; the server compares it constant-time against the parcel's stored sender and receiver numbers. Only on a match does an OTP go out — **to the stored number, not the submitted one**, preserving the `RequestParcelReceiptOtp` rule. The response is identical whether or not it matched, so the endpoint cannot test whether a number is on a parcel. Rate-limited per code and per IP.

*Which* stored number matched decides the tier, so sender and receiver get genuinely different pages:

| Field | Public | Sender | Receiver | Handler (custody) | Org admin |
| --- | --- | --- | --- | --- | --- |
| Status, route, ETA | ✓ | ✓ | ✓ | ✓ | ✓ |
| Counterparty name | — | ✓ | ✓ | ✓ | ✓ |
| Counterparty phone | — | last 4 | last 4 | full, audited | full, audited |
| Price / payment state | — | ✓ | COD due only | COD collect only | ✓ |
| Exact destination pin | — | — | ✓ | ✓ | ✓ |
| Agent address, hours, holding fee | — | — | ✓ | ✓ | ✓ |
| POD photo, signed-by | — | ✓ | ✓ | ✓ | ✓ |
| Failed-attempt reasons | — | ✓ | ✓ | ✓ | ✓ |
| Handoff / scan actions | — | — | confirm receipt | ✓ | ✓ |
| Weight, dims, internal notes | — | — | — | ✓ | ✓ |

**Tier 2 — staff.** Clerks, handlers and admins **never use the OTP path.** They have a session and an org; a per-parcel OTP would be a second, weaker credential for something the session already proves. Their tier is `session role ∩ org match ∩ custody`.

Custody is the interesting half. `GetParcelLabel` exposes `ReceiverPhoneLast4` precisely so a lost label isn't a contact card — right call. But a rider at a gate needs to *call* the receiver. So: **custody is what upgrades last-4 to the full number, and that read is audited.** The existing holder check (`currentHolder`/`assignedCollector`) is already the predicate; it just needs to gate a field it currently doesn't. Org admins see only their own `parcelOrgId`; cross-tenant reads are audited via `packages/db/src/audit.ts`.

#### Threat model

| | Threat | Control |
| --- | --- | --- |
| T1 | Rival prints lookalike labels to ride the brand | `k` signature; scan page renders an explicit "not an esoqo label" verdict |
| T2 | Org B spends stock issued to Org A | `parcelOrgId` checked at bind, not just at mint |
| T3 | Stranger scans a box to snoop | Tier 0 is PII-free by construction |
| T4 | A pad is stolen from a branch | `batchId` void, one statement |
| T5 | Code enumeration to harvest data | Tier 0 has nothing worth harvesting; `noindex` already set; rate limits on `/p/` and OTP issue |
| T6 | Someone claims a parcel that isn't theirs | OTP goes to the number *on file*; possession of the code is not possession of the phone |

T6 justifies the whole OTP design. The tracking code is a bearer credential — it travels on the outside of a box through many hands. It must never be sufficient to unlock a name and an address.

### 3.7 Queues and manifests

Each KPI tile becomes a link to `/parcels?queue=<name>`, and a queue is **oldest-first** (the inversion of A7 — a work queue sorts by dwell, not recency), **paginated with a true total** ("47 of 312"), **multi-select with bulk actions**, and **clocked** — every row showing age and SLA countdown, not just a "Past SLA" pill. No new concepts; the tiles already named the queues correctly. They need to be doors.

And `/parcels/trips/[id]/manifest` — printable run sheet, driver signature line, count, per-parcel COD. The API is already there (A15). Bulk assign from the queue view, then print the manifest, in one pass.

---

## 4. Brand: esoqo → esoqo

Do the rename on the label surface first and the codebase last.

**Now (label + public scan page only):** wordmark, `esoqo.co.ke`, the `/p/` page's chrome. These are the surfaces the public touches and they cost nothing structural.

**Deliberately deferred:** the `esoko://` deep-link scheme, `@esoqo/*` package names, the `ESK-` and `PKG-` prefixes. All are in a registry with live codes in the wild; renaming them is a migration, not a rebrand, and the public never sees them. A code reading `PKG-` under an esoqo logo is entirely normal — DHL waybills don't spell "DHL" either.

**Why the name works.** The `q` is a gift: a QR module grid *is* a lowercase q with a descender if you let it be. The mark can be the QR — so the logo and the scannable object become the same object, on the label, the van, and the shopfront. No courier in the region has that.

---

## 5. Change list, by layer

| Layer | Change |
| --- | --- |
| `packages/db` | Stock ownership migration §3.4; dimensions on `parcel` and stock; retire `ownerName`/`ownerContact` for the sender/receiver shape §3.1 |
| `fleetqr` | `SignLabel(code, orgID, batchID)` / `VerifyLabel` — reuse the existing `Sign`/`Verify` HMAC |
| `dbx/parcels.go` | `GenerateParcelLabelStock` takes org + batch; `BookParcel` existingCode checks org + void; `AdminListParcels` gains cursor + dwell sort + queue predicates; `GetParcelStatus` gains the validity verdict; new `GetParcelStatusForParty`; custody gates full msisdn; `ListLabelStock` stops excluding filled rows |
| `handlers_parcels.go` | `POST /v1/parcels/:code/claim/otp`, `…/claim/verify` → short-lived party-scoped token; `GET /v1/parcels/:code/status?k=` |
| `handlers_admin_parcels.go` | Mint scoped to caller's org; `POST …/labels/batch/:id/void`; list by batch and by state |
| `apps/admin` | Universal scan box in the shell; `/parcels/counter`; label register rebuild; QR encodes the URL; label redesign §3.3; clickable tiles → queues; manifest print; `nav-routes` sync |
| `apps/app` | `/parcel-org/labels` and `/parcel-org/counter`, same components, session-scoped |
| `apps/web` | New `/p/[code]` — verdict + `ParcelStatusPanel` + claim flow; `/t/<code>` unchanged |
| mobile | Scanner strips the `esoqo.co.ke/p/` origin before resolving; handler tier uses session, no OTP |

---

## 6. Sequencing

Ordered by value per unit of effort, not architectural tidiness.

| Wave | Work | Why here |
| --- | --- | --- |
| **1** | QR encodes the URL; universal scan box in the admin shell (⌘K + gun detection + camera); `LabelInfoModal` loads before it saves; "Other" gets its free-text partner; tiles become links; `nav-routes` sync | Days of work. A1, A2, A6, A9, A12, A17 — the things that are actively *wrong* today rather than merely absent |
| **2** | Paginated, oldest-first, multi-select queues with true totals | A7, A16. Makes existing data usable at real volume |
| **3** | Stock ownership + batches + bind-time enforcement | A4. The correctness fix under everything else, and the unlock for wave 5 |
| **4** | The Counter, minimal: scan → parties → what → save as blank / take payment | A3. The missing screen |
| **5** | Label register rebuild + `/parcel-org/labels` | A5, A10. Makes tenancy operationally real |
| **6** | Tiered disclosure + claim OTP + `/p/` page | A8. The consumer-facing half |
| **7** | Dimensions + volumetric; declared value; photo; prohibited tick | A14, A19, A20, A21. Margin and liability |
| **8** | Signature + label redesign; manifests; saved parties; offline intake | A11, A15 and the differentiators |

Waves 1–2 are the ones I would not defer: they are cheap, and two of them (A6's silent data loss, A7's hidden backlog) are *losing information today*.

---

## 7. Why this wins

1. **It removes a concept rather than adding one.** "Attach info to a label" and "book a parcel" collapse into one record with one vocabulary — fewer tables, fewer screens, fewer field names, and the write-only-data bug disappears as a side effect rather than as a fix.
2. **Pre-minted stock stops being a convenience and becomes the offline story.** A counter that prints a label with no network keeps working in Kisumu at 7am. Nobody in this market does that, and Esoqo is two steps from it because the stock table already exists.
3. **The fraud check is consumer-facing.** "Scan it. If it's not esoqo, it says so" is memorable, demonstrable and *true* — and it makes counterfeiting our labels actively counterproductive for a rival.
4. **Every dropped box becomes an impression.** A URL-bearing QR means a stranger who finds a parcel lands on an esoqo page. Make that page good and put "Send a parcel" on it.
5. **Blank stock is a distribution channel.** A pad of esoqo labels on an agent's counter is shelf presence. Give agents their own `batchId`: their shrinkage is their problem, their volume is visible to them, and the pad itself sells the network.
6. **Every gap here is an operator gap, not a domain gap.** The model already knows about SLAs, custody, exceptions, COD floats, revenue splits and coverage tiers. This is mostly about putting doors on rooms that are already furnished.

---

## 8. Open questions

1. **Volumetric divisor** — 5000 (air) or 6000 (road) for a bus-and-boda network? Changes real prices; a commercial decision, not an engineering one.
2. **Does the Counter live in `apps/admin`, `/parcel-org`, or both?** Recommendation: build once, mount twice, scoped by session — a clerk at a partner company needs it more than an esoqo admin does.
3. **Batch granularity** — per-org, or per-agent sub-ranges? Per-agent is better for shrinkage attribution and is another table.
4. **Saved parties: new table, or reuse `party`?** `party` already carries msisdn identity platform-wide; a "shipped to/from before" edge may beat a new address book.
5. **Does Tier 1 survive a session?** A short-lived cookie scoped to one code avoids re-OTPing on every check. Proposed: 24h, one code, no refresh.
6. **What does a voided-but-affixed label show on scan?** Recommendation: "This label was withdrawn — contact esoqo", never a silent 404. A box in the world with a dead label still needs to route somewhere.
7. **Prohibited-items affirmation: blanket tick or per-category checklist?** A blanket tick is weaker evidence and lighter at the counter.
8. **Retiring `ownerName`/`ownerContact`** — clean rename, or keep both a cycle? The columns landed this pilot with what looks like only test data, but confirm against the pilot database before writing the migration.
9. **`k=` length.** Ten chars is ~60 bits at base32 — ample, and the QR has the density budget. Worth confirming against a 32mm print at 300dpi.
