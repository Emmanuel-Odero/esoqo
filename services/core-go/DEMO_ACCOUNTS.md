# Demo accounts (local dev only)

The mobile app has no self-serve sign-up screen — `POST
/v1/auth/verify-otp` auto-provisions a bare Party+Person on a correct
OTP, but that needs a real SMS round trip. For local development and
demoing the unified-crew-identity model (see `docs/proposals/
esoko-unified-crew-identity.md`) without touching an SMS provider,
`go run ./cmd/seed` plants 21 phone+PIN accounts that sign in
immediately via the normal **Sign in** screen (phone/email + PIN,
`POST /v1/auth/sign-in`).

OTP codes (org-context activation, PIN reset, etc.) need `SMS_PROVIDER`
actually running somewhere to land — locally that's either `console`
(codes print straight to `core-go`'s own stdout/`docker logs`) or
`mock`, which needs its own container up:

```bash
docker compose up -d mock-sms mailhog
```

Then read codes at **http://localhost:8026** (SMS) or
**http://localhost:8025** (email) instead of digging through logs.

Run it any time — every account upserts, nothing duplicates:

```bash
cd services/core-go
DATABASE_URL="postgresql://esoko:esoko_dev_only@localhost:6432/esoko?sslmode=disable" \
go run ./cmd/seed
```

(Also seeds reference data, the original demo ticketing/stores/pilot
fixtures — the main table below covers the 21 accounts from
`internal/seed/demo_unified_identity.go`; the older fixtures are
listed separately further down, not omitted.)

## Accounts

| Phone | PIN | Name | Role |
|---|---|---|---|
| +254700500001 | 500001 | Demo Amina Wanjiru | Store owner — Demo Amina's Grocers (groceries) |
| +254700500002 | 500002 | Demo Brian Otieno | Store owner — Demo Brian's Electronics |
| +254700500003 | 500003 | Demo Faith Njeri | Group treasurer/chairperson — Demo Kilimani Women Chama |
| +254700500004 | 500004 | Demo Peter Kamau | Group member — Demo Kilimani Women Chama |
| +254700500019 | 500019 | Demo Winnie Achola | Group treasurer/chairperson — Demo Umoja Boda SACCO |
| +254700500005 | 500005 | Demo Susan Achieng | Company owner — Demo Nairobi Live Events (events) |
| +254700500006 | 500006 | Demo James Mwangi | Company owner — Demo Metro Coach SACCO (transport) |
| +254700500007 | 500007 | Demo Mary Chebet | Company owner — Demo Highway Express (transport, separate tenant from Metro Coach) |
| +254700500008 | 500008 | Demo Kevin Otieno | Metro Coach staff — SCANNER (org-staff-grant, active) |
| +254700500009 | 500009 | Demo Linda Wambui | Metro Coach staff — MANAGER (org-staff-grant, active) |
| +254700500010 | 500010 | Demo Tom Kiptoo | Metro Coach staff — ADMIN (org-staff-grant, active) |
| +254700500011 | 500011 | Demo Alice Nduta | Metro Coach staff — CREW, linked to a CrewMember (can declare cash **and** close a trip) |
| +254700500012 | 500012 | Demo Sam Kiprotich | Metro Coach staff — SCANNER, **suspended** (use to demo the reinstate flow) |
| +254700500020 | 500020 | Demo Peter Otieno | Metro Coach staff — CREW, **not** linked to a CrewMember (can declare cash, fails closed on trip-close) |
| +254700500013 | 500013 | Demo Nancy Adhiambo | Highway Express staff — SCANNER (separate tenant from Metro Coach — cross-org isolation demo) |
| +254700500014 | 500014 | Demo Ochieng Barasa | Nairobi Live Events staff — SCANNER (gate check-in) |
| +254700500015 | 500015 | Demo Grace Wairimu | Nairobi Live Events staff — ADMIN |
| +254700500016 | 500016 | Demo David Kiprop | **Dual hat** — owns Demo David's Fashion Corner *and* holds a CREW grant on Metro Coach: one login, switch duty on/off from Profile > Acting as |
| +254700500017 | 500017 | Demo Esther Muthoni | Plain shopper — no company, no staff grant |
| +254700500018 | 500018 | Demo Brian Kimutai | Plain shopper — no company, no staff grant; also the courier holding a parcel in transit (see Parcels below) |
| +254700500021 | 500021 | Demo Grace Otieno | Store owner — Demo Nairobi Nights Hotel (hospitality, modelled as a Store — see below) |

### Org/store slugs (for hitting the API directly, not just the app)

| Slug | Owner | Kind |
|---|---|---|
| `demo-aminas-grocers` | Amina Wanjiru (500001) | Store |
| `demo-brians-electronics` | Brian Otieno (500002) | Store |
| `demo-nairobi-live-events` | Susan Achieng (500005) | TicketOrg (EVENTS) |
| `demo-metro-coach` | James Mwangi (500006) | TicketOrg (TRANSPORT, short-distance) |
| `demo-highway-express` | Mary Chebet (500007) | TicketOrg (TRANSPORT, long-distance) |
| `demo-davids-fashion` | David Kiprop (500016) | Store |
| `demo-nairobi-nights-hotel` | Grace Otieno (500021) | Store (hospitality) |

Groups have no slug (join by ID via `GET /v1/groups/search`) — Demo
Kilimani Women Chama (Faith, 500003) and Demo Umoja Boda SACCO
(Winnie, 500019).

## Notes

- **Sign in** with phone + PIN directly — no OTP needed for any of these.
- Org-staff-grant accounts (Kevin, Linda, Tom, Alice, Sam, Peter Otieno,
  Nancy, Ochieng, Grace) are eligible for staff duty but start
  **switched out** — sign in, then go **Profile > Acting as** and switch
  the relevant org on. That step is always OTP-gated (docs/proposals/
  esoko-unified-crew-identity.md); in dev the code prints to the
  `core-go` container/process logs instead of sending a real SMS:
  ```bash
  docker logs -f core-go   # or watch stdout if running `go run ./cmd/api` directly
  ```
- **David Kiprop** (500016) is the account to lead a walkthrough with —
  it's the "log in once, see everything you're entitled to" scenario
  the redesign exists for: their own store as owner, plus a switchable
  CREW context for a company they don't own.
- **Sam Kiprotich** (500012) demonstrates suspend/reinstate: sign in as
  James Mwangi (500006, owns Metro Coach) → Transport → Demo Metro Coach
  SACCO → **Staff & duty roles** — Sam is already suspended.
- **Peter Otieno** (500020) demonstrates the fail-closed case: a CREW
  grant with no linked CrewMember can declare cash but core-go refuses
  to let it close a trip (`dbx.crewOwnsTrip`) — there's nothing to prove
  it's *this* trip's crew.
- **Nancy Adhiambo** (500013) proves tenant isolation: her SCANNER grant
  is on Highway Express only — activating it never grants anything on
  Metro Coach, a different `ticket_org`.
- These are additive to the older demo fixtures also seeded by
  `cmd/seed` — spelled out below rather than left as "see the other
  files," since digging through source just to find a login defeats the
  point of this document.

## Other seeded fixtures (pre-existing, not part of the 21 above)

`cmd/seed` runs several older seed files before
`demo_unified_identity.go` — these all still work and are independent
of the unified-crew-identity accounts:

**Reference data** (`internal/seed/reference.go`)
| Login | PIN | Notes |
|---|---|---|
| ops@esoko.co.ke | printed at seed time, differs per run | Esoko ops/staff login — watch `go run ./cmd/seed`'s own output for the current PIN; change before any real deployment. |

Also seeds 11 counties, 6 issuers, 13 markets, 20 commodities and 4
pricing rules (edit pricing from the admin app afterwards, not by
re-seeding).

**Demo ticketing** (`internal/seed/demo_ticketing.go`) — a second,
older transport + events pair, separate from Metro Coach/Highway
Express/Nairobi Live Events above (all four ticketing orgs coexist
fine):
| Phone/Login | PIN | Role |
|---|---|---|
| +254700100100 | 100100 | Demo Organiser — owns both orgs below |
| Demo Scanner (org-staff PIN, not phone) | 111111 | SCANNER on `demo-rapid-coach` and `demo-nairobi-live` |
| Demo Manager (org-staff PIN) | 222222 | MANAGER on both |
| Demo Admin (org-staff PIN) | 333333 | ADMIN on both |
| +254700200200 | 200200 | Demo Customer — has bookings against both orgs' listings, and pickup orders at Demo Freshmart Kilimani in every click-and-collect state |

Orgs: `demo-rapid-coach` (TRANSPORT — Nairobi→Mombasa Economy/VIP
coach, plus its own short-route matatu fleet: `KDA 123X`, Demo Town
Loop, one open trip) and `demo-nairobi-live` (EVENTS — Demo Nairobi
Live Concert, Regular/VVIP).

The org-staff PIN logins above are the **legacy AGENT credential**
(org slug + free-text name + PIN via `/v1/ticket-staff/sign-in`) —
still supported server-side, not reachable from the mobile app's UI
any more (see docs/proposals/esoko-unified-crew-identity.md's AGENT
retirement). Use them only for testing that legacy path directly
against the API.

**Demo stores** (`internal/seed/demo_stores.go`)
| Login | PIN | Notes |
|---|---|---|
| +254700300300 | 300300 | Merchant — owns all 8 stores below |

Stores (slugs): `demo-wakulima-greens`, `demo-kitale-hardware`,
`demo-nairobi-tailors`, `demo-mama-mboga-mitumba`,
`demo-freshmart-kilimani`, `demo-freshmart-westlands`,
`demo-freshmart-lavington`, `demo-freshmart-south-b`. Freshmart
Kilimani has pickup orders in every state for the Demo Customer login
above.

**Pilot SACCO** (`internal/seed/demo_pilot.go`) — the original
one-SACCO walkthrough kit, org slug `demo-pilot-sacco`:
| Phone/Login | PIN | Role |
|---|---|---|
| +254700300100 | 300100 | Demo Pilot Owner |
| Pilot Scanner (org-staff PIN) | 444444 | SCANNER |
| Pilot Manager (org-staff PIN) | 555555 | MANAGER |
| Pilot Admin (org-staff PIN) | 666666 | ADMIN |
| +254700300200 | 300200 | Demo Pilot Passenger — has `VCH-PILOT` loaded with 2,000 pts (≈KES 200) |

Vehicle `KDP 001A`, open trip `BUS-PILOT`, 3-stage Pilot Town Loop.
Same legacy-AGENT caveat as demo ticketing's staff PINs above.

## Fleet — short-distance (matatu) vs long-distance (intercity bus)

- **Demo Metro Coach SACCO** (James, 500006; slug `demo-metro-coach`)
  — short-distance/matatu shape: one matatu (`KDN 700M`, 14-seat), a
  3-stage town route (Demo Metro Town Loop: Town Stage KES 60,
  Junction Stage KES 90, Estate Terminus KES 120) with an open trip —
  Demo Metro Coach Driver driving, Alice Nduta (500011) conducting.
  Sign in as any Metro Coach staff account, switch duty on, and
  there's an actual trip to verify fares / declare cash / close
  against.
- **Demo Highway Express** (Mary, 500007; slug `demo-highway-express`)
  — long-distance shape: a seated intercity route, Nairobi → Kisumu
  (listing slug `demo-nairobi-kisumu`), Economy (KES 1,200, 44 seats)
  + VIP (KES 2,200, 12 reclining/wifi seats), two scheduled departures
  (`KDQ 900H`, `KDQ 901H`) with real seat maps. Nancy's (500013)
  SCANNER grant has real tickets to check in against.

## Parcels

Five parcels, covering every real status — there is no separate
"parcel handler" role in the domain model (see `dbx/parcels.go`: any
signed-in Party can accept/deliver a scan, the same way a store's own
account is who's allowed to manage it elsewhere):

| Code | Delivery code | Status | Sender | Receiver | Currently held by |
|---|---|---|---|---|---|
| `PKG-DEMO001` | `112233` | BOOKED | Esther Muthoni (500017) | David Kiprop (500016) | — (not yet picked up) |
| `PKG-DEMO002` | `445566` | PICKED_UP | Amina Wanjiru (500001) | Brian Otieno (500002) | Amina (sender still holds it) |
| `PKG-DEMO003` | `778899` | IN_TRANSIT | David Kiprop (500016) | Esther Muthoni (500017) | **Brian Kimutai (500018)** — the demo courier |
| `PKG-DEMO004` | `990011` | DELIVERED | Esther Muthoni (500017) | Amina Wanjiru (500001) | Amina (delivered) |
| `PKG-DEMO005` | `223344` | IN_TRANSIT | David Kiprop (500016) | Amina Wanjiru (500001) | **Alice Nduta (500011)** — sign in as her for one account that's both the demo conductor *and* holding a parcel |

Check status with `GET /v1/parcels/:code/status` (no auth needed —
same bearer-code convention as a pickup code); complete a delivery
with `POST /v1/parcels/:code/deliver` using the matching delivery code
above, signed in as whoever currently holds it.

## On "other profile types" (hoteliers, etc.)

There is no dedicated hotel/hospitality domain model in
`schema.prisma` yet — no room inventory, no date-range booking. Demo
Grace Otieno (500021) is seeded as a **Store** with
`primaryCategory: "Hospitality"` and room-rate "products" ("Standard
room — per night", etc.), which is an honest reuse of the existing
MSME-shape Store model, not a new capability. If real hotel bookings
(date ranges, room availability, check-in/out) become a requirement,
that's new schema and domain work, not something more seed data can
stand in for — flagging this now rather than quietly pretending the
demo account proves more than it does.
