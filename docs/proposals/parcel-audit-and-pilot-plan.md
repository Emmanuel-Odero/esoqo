# Esoqo Parcel: Competitive Audit, Kenya-Market Innovations, and Day-One Pilot Plan

Status: Internal audit / product proposal
Scope: The "parcel" feature in the Esoqo monorepo (Go `core-go` backend, Flutter app, Next.js admin, public web)
Audience: Product, engineering, and leadership preparing for a parcel pilot demo

---

## 1. Executive summary

Esoqo's parcel feature is already a **broad, production-grade system** — a hybrid model no single Kenyan player currently runs:

1. **Consumer booking/payment** — sender books, pays inline with Esoqo points or M-Pesa STK, prints a 60×40mm label with a PKG- dash code.
2. **Hybrid dispatch** — an admin-scheduled *fleet* path (courier teams, `AssignParcelCollector`, SLA deadlines) **and** a *gig/on-demand* path (courier pings, nearest-first `available-jobs`, race-safe first-accept-wins claim). Both funnel into a single custody field enforced by scan handoffs — an unusually clean architecture.
3. **Guest-safe tracking** — anyone who scans a PKG- code sees status on a web page or in the app without an account (PII-minimal projection), plus a pre-printed-label fallback (`LABEL_PRINTED`).
4. **Receipt with OTP + condition rating** — receiver confirms with a masked-code OTP and rates condition 1–5; courier on-time and condition performance is *computed*, never separately tracked.
5. **SMS notifications at every status transition** — 10 parcel templates in `notify.go`.

Where it falls short of what Kenyan customers and courier operators now expect (Jumia Send, DHL SameDay, iCargos, Traksend, Boxleo, Glovo):

- **No live GPS tracking shown to sender/receiver** — courier pings already exist but only drive an **admin** live map.
- **No photo / signature proof of delivery** (ePOD is the industry baseline).
- **SMS only, no WhatsApp channel**, and no branded tracking page.
- **No cash-on-delivery, no insurance, no scheduled/self-serve pickup**, no reverse logistics.
- **Free-text addresses** (`originLabel`/`destinationLabel`) in a market where 25% of parcels never reach recipients and 58% are delayed via addressing failure (CIAK).
- **Courier vetting is a status flip** with no document/KYC evidence trail.

**The single most differentiating, demo-winning idea is one nobody in the Kenyan market offers:** ship parcels on *Esoqo's own matatu/intercity fleets* — the same trips users already ride — with the **conductor as the courier**. The seed already proves the pattern (`PKG-DEMO005` held by demo conductor Alice; `ensureMetroCoachFleet` stands up the vehicle/trip). "Send your parcel, track it on the same bus you ride" turns Esoqo's existing transit infrastructure into a national delivery network that Sendy, Jumia, and Glovo cannot copy without building a vehicle network.

---

## 2. User types covered

| # | User | Surface | What they need |
|---|------|---------|----------------|
| 1 | Sender | Flutter app | Book, pay (points/STK), print/keep label, track, schedule, cancel/refund, re-send |
| 2 | Receiver | Flutter app, guest web, SMS | Track without an account, OTP-confirm, rate, proof of condition |
| 3 | Courier company & its employees | Flutter app (hub → Nearby tab), admin console | Onboard, get vetted, go online, see/claim nearby jobs, scan handoffs, capture POD, see earnings |
| 4 | Esoqo staff — ops admin | Admin console | List/KPI dash, live dispatch map, assign, vet couriers, teams, cancel/refund, label batches, pricing/Zones editor |
| 5 | Esoqo staff — manager/user | Admin console | SLA/on-time KPIs, dispute/refund oversight, COD reconciliation, tariff/governance, partner integration |

---

## 3. Current-state capability map (verified in code)

### Domain & status machine
- `ParcelStatus`: `DRAFT_PENDING_PAYMENT → BOOKED → PICKED_UP → IN_TRANSIT → DELIVERED`; `CANCELLED` is admin-only and unreachable after pickup. (`packages/db/prisma/schema.prisma:3112`)
- `ParcelType`: ENVELOPE_DOCUMENT, SMALL, MEDIUM, LARGE, HEAVY_OVERSIZE (`dbx/parcels.go:38`).
- `ParcelTransportMode`: BODA, TUKTUK, VAN, TRUCK, BICYCLE, ON_FOOT.
- Supporting models: `ParcelPricingRule`, `ParcelZone` (+ `HaversineKm` geo-surge), `ParcelDistanceRate`, `ParcelHandoff` (append-only custody), `ParcelCourier` (+ `PENDING_VETTING/ACTIVE/SUSPENDED/REJECTED`), `ParcelCourierPing`, `ParcelLabelStock` (pre-printed code pool), `CourierTeam`/`CourierTeamMember`.

### Booking → delivery flow (mobile)
`BookParcelScreen` → `ParcelPricingScreen` (standard price or bounded "make an offer", price always re-derived server-side) → `ParcelPaymentScreen` (points inline or M-Pesa STK + poll) → `ParcelStatusScreen`. Label via `ParcelLabelScreen`. Receiver confirms via `ParcelReceiptConfirmationScreen` (OTP + 1–5 rating, guest-safe).

### Dispatch (hybrid)
- **Fleet/scheduled**: `AssignParcelCollector`, `CourierTeam`s, `slaHours`/`slaDeadlineAt`. Admin AssignPanel in `apps/admin/src/app/(dashboard)/parcels/**`.
- **Gig/on-demand**: mobile hub **"Nearby" tab** (`parcels_hub_screen.dart`) posts the courier's ping every 30s while open, lists `available-jobs` nearest-first within `radiusKm` (default 15), and claims first-accept-wins (`ClaimParcel` guarded by `assignedCollectorPartyId IS NULL`).
- Both feed `assignedCollectorPartyId`, enforced by `ScanHandoff`.

### API surface (core-go)
- Public: `POST /v1/parcels`; pricing; payment (points/STK + poll); `GET /v1/parcels/:code/status` (guest-safe); `GET /v1/parcels/:code/label`; `POST /v1/parcels/:code/receipt-confirmation`; `POST /v1/parcels/:code/claim`; `POST /v1/parcel-couriers/me/pings`; `GET /v1/parcel-couriers/me/available-jobs`.
- Admin: list/stats, assign, cancel, refund, edit; courier onboard/status/performance; teams; label stock (`GenerateParcelLabelStock` 1–500), pricing/Zones; `GetLiveDispatchView` (live map).
- Notify: 10 parcel SMS templates (`notify.go:95–207`): collection-scheduled, pickup-assigned, picked-up, in-transit, delivered, received, cancelled, refunded, payment-confirmed, receipt-confirmed.

### Admin UI
Parcels list + KPIs, `ParcelDetailModal` action panels, live map (`live/`), couriers (`couriers/`), teams (`teams/` + `[id]`), labels (`labels/`), pricing (`pricing/` — `ParcelPricingEditor`, `ZonesEditor`). Gated by capabilities `parcels.read/assign/cancel/refund/edit`, `parcel_pricing.write`, `parcels.couriers.manage` (`capabilities.ts:255–263`).

### Known weak spots (code-level)
- **`actionGetParcelLabel` is dead code** in `apps/admin/src/app/(dashboard)/parcels/actions.ts:257`.
- Parcels entry is **only the Home hub tile, always last** (`home_hub_screen.dart:64–70, 91–136`) — near-zero discoverability.
- Courier vetting is a **status flip, no document evidence** (`schema.prisma:3099` comment admits no KYC pipeline).
- Zone/pricing is **seeded, not manager-editable beyond the pricing editor** (`demo_unified_identity.go:448–478`).
- No live GPS surfaced to sender/receiver; ePOD absent; WhatsApp absent; COD absent; insurance absent.

---

## 4. Competitive benchmark (Kenya, field research)

### Consumer / on-demand platforms
| Player | Status | Model | What they offer |
|---|---|---|---|
| **Jumia Send** | Live (2025) | Asset-light public parcel-send over 300+ 3P pick-up stations | KES 160–1,600; real-time tracking; 60% of deliveries to secondary towns; windows 2–4 days |
| **Glovo** | Live (Uber & Delivery Hero deal 2026) | Quick commerce, in-app live tracking, courier app, Business portal | Leads food (33%) & grocery (46%) preference; KES 10B Kenya investment to 2030 |
| **Bolt Food / Delivery** | Live | Real-time courier tracking, advance scheduling, pickup option | Entered supermarket delivery (Quickmart) |
| **Uber / Uber Connect** | Live (Kenya) | On-demand cargo + ride | Applied for National Courier Operator licence → expanding into parcels |
| **GetBoda** | Deadpooled | Metered on-demand boda | KES 85 next-day, ~30 KES/km same-day; rating |
| **Sendy** | Shut down 2023 | Marketplace matching cargo ↔ 3P transporters | 700+ drivers, 180k deliveries, agency-model pilot, transparent pricing |
| **Emergen8** | Live | Fully electric courier, RFID live tracking | Same-day/express, green fleet |
| **Fargo** | Live | Traditional national courier | 650 vehicles, express options, freight/warehousing |

### Courier/business SaaS & 3PL benchmarks (the "older expectations" bar)
- **iCargos** — route optimization, **electronic POD (photo + signature + GPS stamp)**, WhatsApp/SMS in English/Swahili, live tracking links, **COD tracking & daily reconciliation**, GPS-pin + landmark addressing, boda/multi-modal fleets.
- **Traksend** — **WhatsApp AI order capture**, white-label branded tracking page (no app for customers), pay-on-delivery as first-class flow, live GPS for own drivers.
- **Boxleo** — COD via Bank/M-Pesa/Airtel/Crypto with weekly remittance, fulfillment + smart packaging, real-time tracking, 24–48h delivery.
- **Lastmile Courier** — POD systems, COD remittance, cross-border KE/UG/TZ/NG/GH/RW/ZM.
- **MPost / Tap-A-Delivery** — mobile number = virtual address; Posta partnership; scheduled + recurring deliveries; "Scan and Get Delivery" at stores.
- **Pickspot** — digital addressing + smart lockers: delivery agent unlocks with pre-sent password, recipient notified by SMS, unlocks with a code; charges by size/hold time.
- **Pick-Up Mtaani** — neighbourhood shops as collection points; flat fee via M-Pesa PayBill; SMS with unique collection code.
- **DHL SameDay Kenya** — 24/7/365, air/road tiers (Jetline/Speedline/Sprintline, pickup in 60 min), M-Pesa, SMS/email proof, micro-fulfilment, local-partner routing.

### Market pain points (data that informs innovation)
- **Addressing**: CIAK — **25% of parcels never delivered, 58% delayed** due to missing addresses (Business Daily, Pickspot piece).
- **Regulatory**: CA of Kenya created a **"Courier-Hailing Service Provider" licence** (app + initial KES 100k, annual KES 100k or **0.4% of audited turnover**; **+0.5% universal service levy**); took effect Jul 29, 2026. Ecosystem valued ~KES 132B; KRA linking **eTIMS** invoices to platform receipts.
- **Channel reality**: SMS + **WhatsApp** is where Kenyan customers are; USSD still dominates financial flows (>850M connections, ~90% of SSA digital transactions) — feature-phone reach is real.
- **Glass-half-full for incumbents**: delivery platforms are under margin pressure (fuel, price-sensitive consumers); partners absorb last-mile risk (Jumia) — an asset-owning player (Esoqo) can undercut on cost and control the handoff.

### Feature matrix: Esoqo vs. the bar

| Capability | Esoqo today | Kenyan bar | Verdict |
|---|---|---|---|
| Book from app, no phone call | ✅ | ✅ | Parity |
| Digital/instant payment (STK, wallet) | ✅ + unique points wallet | ✅ | **Ahead** |
| Live GPS tracking for sender/receiver | ❌ (admin-only map) | ✅ | **Gap** |
| Code/QR label + scan custody trail | ✅ PKG- + handoffs | partial | **Ahead** |
| Guest/no-app tracking | ✅ web scan page | ✅ | Parity |
| Proof of delivery (photo/sig/GPS) | ❌ (OTP+rating only) | ✅ | **Gap** |
| WhatsApp notifications | ❌ (SMS only) | ✅ | **Gap** |
| Branded tracking page per business | ❌ | ✅ (Traksend) | Gap |
| Cash on delivery + reconciliation | ❌ | ✅ | Gap |
| Pickup-point / locker network | ❌ (zones only) | ✅ (Jumia, Mtaani, Pickspot) | Gap |
| GPS-pin / plus-code addressing | ❌ (free text + zones) | ✅ | **Gap** |
| Insurance / declared value | ❌ | partial | Gap |
| Scheduled & recurring pickup | partial (admin sets) | ✅ | Gap |
| Route optimization | partial (nearest-first) | ✅ | Gap |
| KYC/vetting evidence for couriers | ❌ (status flip) | partial | **Gap** |
| Couriers as fleet staff (own vehicles) | ✅ (teams + dispatchers) | ❌ (3P only) | **Ahead** |
| eTIMS-compliant invoice | ❌ | emerging | Gap (regulatory) |
| Courier earnings/payout ledger | ❌ | ✅ | Gap |
| Reverse logistics (returns) | ❌ | partial | Gap |

---

## 5. Kenya-market innovations (prioritized for the pilot)

Legend: **P0** = demo-critical/must-show, **P1** = soon-after, **P2** = roadmap.

### P0 — Demo-differentiating
1. **"Send it on the bus you ride" — parcel-on-fleet.** Ship parcels on existing Esoqo matatu/intercity trips; conductor scans on/off (seed `PKG-DEMO005`/'Alice the conductor' already does this). Novel vs. Sendy/Jumia/Glovo because Esoqo owns the rolling asset. For the pilot: book a parcel to a route-terminus, hand it to the conductor at scan-in, confirm at terminus.
2. **Live courier position on the tracking page.** Reuse `parcel_courier_ping` (already per-courier + per-parcel assigned) to render sender/receiver a live map + ETA alongside the status timeline. Cheapest highest-impact credibility win; one endpoint + one view.
3. **ePod on receipt.** Attach a photo (and optional signature) at `ScanHandoff`/delivery, displayed in the receipt confirmation and admin detail. Industry baseline; destroys "it never arrived" disputes.

### P1 — The next month
4. **WhatsApp lane.** WhatsApp status/OTP/tracking link (wx/AfricasTalking-type) with SMS fallback; a WhatsApp "track PKG-CODE" autoreply. Belio/ICT stats show this is the default African channel.
5. **GPS-pin addressing.** Booking fields suggest "use my current location" pin + plus-code; label prints a small lat/lng; zone fallback if no zone matched. Directly attacks the CIAK 25%/58% statistic.
6. **Pickup-point collection.** Let receivers choose "collect at a hub / branch / Mtaani-style partner shop" → SMS a unique code (uses existing OTP machinery); pre-cursor to lockers.
7. **Visitor tracking page** for businesses (white-label) + **Jumia-Send-style public price table (KES 160–1,600 bracket)** on the web so "anyone can send" without the app.
8. **Courier earnings + payout.** Minimal ledger on deliveries × agreed tariff, M-Pesa bulk payout, shown in courier profile; makes the gig side operationally real.
9. **Vetting with evidence.** Document upload + staff checklist on the courier record before ACTIVE (or at least a vettingNotes timeline); regulator-aligned.

### P2 — Scale
10. **COD + merchant reconciliation** (Boxleo-style: expected vs. collected at delivery, weekly M-Pesa remittance + daily report).
11. **Declared value / insurance** flat tier at booking; adds revenue and trust.
12. **Route batching & optimization** for couriers (multi-stop day runs vs. single-job taxiing); SLA-overdue auto-escalation queue for ops.
13. **eTIMS invoice** on receipt; CA "Courier-Hailing" licence + USL accounting.
14. **Lockers** (Pickspot model) at hubs, powered by the PKG- code + OTP infra.
15. **Reverse logistics** — returnable labels one stamp apart.

---

## 6. UI/UX improvement list (by surface & persona)

### Sender (Flutter)
- Discoverability: promote Parcels tile from last → pinned/first in Home hub; consider an entry from the Send/Wallet tab too.
- Book screen: weight-first quick chips (Envelope/Small/Medium/Large/Heavy) instead of type dropdown first; show price *and* SLA promise per option.
- Offer "Schedule pickup" (date/range) at booking, not just post-booking admin assign.
- Keep a "Ship again" (duplicate last parcel) action; saved addresses/pins.
- Status: persistent live-tracking card + timeline; copyable tracking link to share with receiver.

### Receiver
- Guest page: English/Swahili toggle, WHOIS-style status, live map, WhatsApp share link.
- Receipt confirmation: photo-of-item confirmation (POD), condition rating already exists — add "this rating goes to the courier" microcopy which motivates couriers.
- No-app OTP via SMS or WhatsApp.

### Courier (corporate employee)
- Not-active-courier UX on the Nearby tab is currently a silent ping failure → explicit "Get vetted" pill + status explanation.
- Claim success should jump to a delivery checklist (scan pickup → scan handoff → photo POD → confirm).
- Add earnings tab (P1 → item 8) and on-time/condition stats (data already computed server-side).
- Offline-friendly actions (scan + capture when no signal; queue sync).

### Admin (ops staff)
- Live dispatch map as the parcels landing tab (it's the KPI of a dispatch desk).
- Parcel list: add SLA-overdue filter; sort by assigned-collector; inline "delay" badge.
- Courier record: vetting timeline + document list (P1); performance block (delivered/on-time/rating — already served).
- Labels: batch print UX with count confirmation; link "reprint" to stock pool.
- Pricing/Zones: make zone editor fully manager-visible (currently seed-only); show margin impact preview.
- Add Cancel/Refund reason taxonomy + audit trail (single-actor `cancellationReason` today).

### Manager/user
- Operations KPIs tab: SLA on-time %, route-level throughput, courier productivity, dispute/refund aging, COD reconciliation (future).
- One-click export (CSV) of any filtered list — flatly missing today.

---

## 7. End-to-end journey maps (5 personas)

1. **Sender** — Home tile → Book (type/weight, sender+receiver, origin/dest pin, offer or price) → Pay (points or STK) → Label printed/shared → Track live (map + timeline) → Schedule/Re-send → Receive POD/refund if cancelled.
2. **Receiver** — clipboard link / SMS OTP from nothing → track page (live, no sign-in) → get OTP at door (SMS/WhatsApp) → confirm + condition rating → photo POD retained → (optional) collect-at-hub with code.
3. **Courier (employee)** — Onboarded by ops (name/phone/vehicle) → SMS welcome w/ Esoqo ID → vetting → sign in → go online (ping loop) → Nearby jobs (15 km) → Claim (first-accept-wins) → Scan pickup → handoff scan → photo POD → confirm → earnings/rating accumulate.
4. **Ops admin** — Live map → see unassigned/overdue → assign to team or courier (search active couriers) → vet/activate/suspend couriers → batch-print labels → cancel + refund (audited) → pricing/zone updates.
5. **Manager** — KPI dash (SLA/on-time, courier perf, revenue, refunds) → drill into exceptions → approve/export → tariff & SLA governance → partner integration (web send API).

---

## 8. Pilot day-one plan

### Demo spine (reuse seeded state)
- Seeded parcels `PKG-DEMO001..005` cover BOOKED, PICKED_UP, IN_TRANSIT (rider), IN_TRANSIT (conductor Alice), DELIVERED — a full lifecycle in 5 QR codes. Zones Kilimani/Ngara/Westlands/CBD; distance rate KES 15/km.
- Script (single continuous narrative):
  1. **Book** from sender app → pay with points (fallback: M-Pesa STK) → print label.
  2. **Live map** in admin shows the new BOOKED + unassigned parcel; assign to a team courier.
  3. **Courier app** claims/accepts, scans pickup (BOOKED→PICKED_UP) → SMS fires.
  4. **Courier moves** → ping → **tracking page for receiver shows live position** (P0 innovation #2 — this is the "wow" beat).
  5. **Deliver at door** → OTP confirm + photo POD + condition rating → DELIVERED + Delivered SMS.
  6. **Grand finale:** demo innovation #1 — book a parcel to a terminus, toggle to demo conductor screen, scan as the conductor on the running "Demo Metro Town Loop" trip (`ensureMetroCoachFleet`), then show it IN_TRANSIT on that bus.
  7. Optional: cancel+refund a throwaway parcel to show the admin exception path.

### Devices & accounts checklist
- Admin console (manager creds) on one machine; sender app; courier app; a "receiver" phone with **no app installed** (proves guest web tracking); 60×40mm label printer + blank PKG- labels from stock; scanner/M-Pesa sandbox availability.

### Critical-path risks → mitigations
| Risk | Mitigation |
|---|---|
| M-Pesa STK fails in demo env | Demo points inline as primary; STK as secondary; pre-test STK callback/poll |
| GPS permission denied on courier device | Pre-approve; verify ping rows appear; fall back to zone-distance demo |
| SMS provider flaky | Show in-app + guest-page status; keep SMS as nicety; pre-send one real SMS |
| Label printer unavailable/stalls | Show QR on phone screen; QR is scannable without a printout |
| Conductor/bus seed not loaded | Re-run `ensureDemoParcels`/`ensureMetroCoachFleet`; verify trip ACTIVE before demo |
| Live-map assignment racy in front of audience | Pre-assign one parcel, claim one live for tension, keep one pre-claimed |
| Regulator/audience asks "licencing?" | Have the CA Courier-Hailing licence + eTIMS + USL position handily on one slide (P2 items) |

---

## 9. Appendix — quick reference of code anchors

- Booking/status/label/receipt: `services/core-go/internal/dbx/parcels.go`; handlers `handlers_parcels.go`
- Admin ops: `handlers_admin_parcels.go`; UI `apps/admin/src/app/(dashboard)/parcels/**`
- Gig dispatch + live map: `dbx/parcel_dispatch.go`; courier lifecycle `dbx/parcel_couriers.go`; teams/zones `parcel_teams.go`, `parcel_zones.go`
- Notify SMS templates: `services/core-go/internal/notify/notify.go:95–207`
- Schema: `packages/db/prisma/schema.prisma:3060–3510`
- Mobile: `mobile/esoqo_app/lib/features/parcels/**` (hub has Sent / Received / Nearby(courier-gig) tabs)
- Scan entry: `scan/universal_scan_screen.dart` (`case 'parcel'`); `scan_repository.dart:311–312`
- Seeds: `services/core-go/internal/seed/demo_unified_identity.go` (zones :448, parcels :563, couriers :430, fleet :480)
- Admin API proxy: `apps/admin/src/lib/go-ticketing.ts` (`adminGo<T>`)
- Existing partnership pitch (context): `docs/proposals/esoqo-shipping-partnership.md`