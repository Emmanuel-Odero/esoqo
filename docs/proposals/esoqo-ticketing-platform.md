# Esoqo Ticketing — events, tours/travel & transport booking

**Status:** v1 shipped · 2026-08-14

## Context

Esoqo wants to onboard event companies, event influencers/promoters,
tour/travel operators, and transport companies (bus/coach/matatu
SACCOs) to sell and manage tickets on the platform — alongside chamas,
CECF members and stores that already live here. Customer and admin
dashboards both need to live on the existing `apps/app` surface
(`localhost:3001`), with role-appropriate menus: a chama admin should
not see ticketing controls, a ticketing org's gate scanner should see
nothing but the scanner, and a customer should see their bookings
wherever they came from.

## Decision: reuse, don't parallel-build

The platform already has the exact shape this needs, twice over:

- **Merchant identity.** `Enterprise` → `Store` is "a Party runs a
  commercial thing." An event company or SACCO is just another
  enterprise. `TicketOrg` belongs to `Enterprise` the same way `Store`
  does — no new "become a business" onboarding flow.
- **Org-scoped staff.** `Cashier` (PIN login, store-scoped, no Party)
  is the template for `TicketOrgStaff` (PIN login, org-scoped,
  ADMIN/MANAGER/SCANNER).
- **Checkout.** `StoreOrder` (buyer info, payment method, M-Pesa
  checkout id, journal entry link, status machine) is the template for
  `Booking`.
- **Access control.** Capabilities, not roles
  (`packages/db/src/capabilities.ts`). A menu item's visibility is
  `can(ctx, capability)`, never a role-name switch — the codebase's own
  stated reason (CECF's old platform hardcoded nine roles into route
  tables) applies just as much to a fourth and fifth vertical as it did
  to the first three.

## Domain model

```
TicketOrg          — belongs to Enterprise; vertical: EVENTS | TRANSPORT
TicketOrgStaff      — org-scoped PIN login; role ADMIN | MANAGER | SCANNER
Venue               — events: where
Route                — transport: origin → destination
Listing              — an Event or a Trip definition
ListingSchedule      — one occurrence (showtime / departure)
TicketClass         — a price tier ("VIP", "Economy seat"); seated or GA
Seat                 — a numbered seat, generated per schedule for seated classes
Booking (≈StoreOrder) — a checkout: buyer, payment, status
Ticket                — one issued seat/slot; QR code, VALID/USED/CANCELLED/REFUNDED
```

Seating was decided up front rather than deferred: transport in Kenya
is overwhelmingly reserved-seat (bus/coach seat maps), so `TicketClass.
seated` and per-schedule `Seat` rows shipped in v1 rather than as a
later migration. Unseated (general admission) classes sell against a
plain `capacity` count instead.

## Access control

New capability group `Ticketing` in `CAPABILITY_CATALOGUE`:
`ticketorg.*`, `ticketorgstaff.write`, `venue.write`, `route.write`,
`listing.write`, `listing.publish`, `ticketclass.write`,
`schedule.write`, `booking.*`, `ticket.checkin`.

- **SUBJECT** preset gains `*.own` grants for all of the above — any
  signed-in person may open a ticketing org (owning it via their
  Enterprise, exactly like opening a store) and always books as
  themselves.
- **ESOKO_OPS** gains `ticketorg.read`, `ticketorg.moderate`,
  `booking.read`, `booking.refund` — platform oversight, same shape as
  its existing Store oversight.
- **`TICKETING_STAFF_CAPABILITIES`** (new, alongside
  `CASHIER_CAPABILITIES`) — the bundle an org-scoped `TicketOrgStaff`
  AGENT session holds: SCANNER gets `ticket.checkin` only; MANAGER adds
  listings/schedules/bookings; ADMIN adds org and staff writes.
- `Ctx.ticketOrgId` (new, alongside `Ctx.storeId`) scopes an AGENT
  session to one org — `assertOwnsOrg` in `dal/ticketing.ts` mirrors
  `assertOwnsStore` exactly: an owner is authorised via their
  Enterprise's `partyId`; an org-staff AGENT is authorised by
  `ctx.ticketOrgId` matching, no qualifier needed.

Every write in `dal/ticketing.ts` calls `assertOwnsOrg`/
`requireCapability` before touching Prisma — the DAL is still the only
enforcement boundary (ADR-0003). UI-level gating (`apps/app/src/lib/
ticketing.ts`'s `canOrg`) is convenience only.

## Dashboard packaging (what each user sees)

`apps/app` (`localhost:3001`) is reserved for signed-in dashboards
only; the public storefront lives on `apps/web` (`localhost:3000`)
instead, next to `/discover` and `/prices`. That's a deliberate split
from `apps/store`'s pattern, where `/discover` only browses and hands
off to `apps/store` for checkout — ticketing has no separate storefront
app, so both browsing and booking stay on `apps/web`.

Under `apps/web` (`localhost:3000`):

- **`/tickets`** and **`/tickets/[slug]`** — the public storefront.
  Browsing needs no session; booking requires a signed-in subject with
  a phone number on file. Since the subject session itself is only
  ever created on `apps/app`, an anonymous visitor is bounced to
  `${NEXT_PUBLIC_APP_URL}/signin?next=...` and back, and a booking's
  "sell tickets" / "view your tickets" follow-ups link out to
  `apps/app` the same way.

Under `apps/app` (`localhost:3001`):

- **`/me`** — every signed-in subject. Gained a "Tickets" primary tab
  (booking history + QR codes) and a "Sell tickets" entry in More,
  unconditionally — same pattern as "Group" and "Payments" already
  showing regardless of whether the user has one.
- **`/me/organiser`** — the switchboard: lists ticketing orgs the
  subject owns, each linking to its console; a form to open a new one
  against an existing Enterprise.
- **`/org/[orgId]`** — the org console, capability-gated tab by tab
  (`layout.tsx` builds nav from `canOrg`, not from a role name):
  Dashboard, Listings, Bookings, Scan tickets, Staff. A SCANNER-role
  session (once org-staff sign-in ships — see Follow-ups) would see
  only "Scan tickets"; the owning SUBJECT sees everything their
  capability set allows, which today is all of it.

## What shipped vs. what's next

Shipped: schema + migration, capability catalogue, `dal/ticketing.ts`
(org/staff/venue/route/listing/class/schedule/booking/check-in/cancel),
domain zod schemas, and the full UI slice above, wired end-to-end
against the live dev database.

Shipped since: **org-staff PIN sign-in** (`/org-staff/[slug]`,
`requireOrgAccess`, a second session cookie scoped by `Ctx.ticketOrgId`
— exact mirror of `apps/store`'s cashier terminal sign-in) and
**M-Pesa STK push** (`/tickets/[slug]` triggers `initiateStkPush` after
`createBooking`, console mode auto-confirms, the real Daraja path stays
`PENDING_PAYMENT` until `services/core`'s `/webhooks/mpesa/stk-callback`
— now trying booking as a fourth kind alongside store/registration/
donation — calls the new `confirmBookingPayment`; a waiting screen
polls `getBookingStatus`, and `/me/tickets` can retry a stalled prompt).

Shipped since: the storefront (`/tickets`, `/tickets/[slug]`,
`BookingForm`, and its `actions.ts`) moved from `apps/app` to
`apps/web`, so `localhost:3001` is dashboards-only. `apps/web` already
carried a thin `/tickets` directory (mirroring `/discover`) and its own
`lib/session.ts` reading the same `esoqo_session` cookie, so the move
reused both rather than inventing a second session story.

Deliberately still deferred:

- **Camera QR scanning.** The gate check-in screen takes a typed/
  scanner-keyboard code today; a `getUserMedia` camera decode is a
  pure UI addition on top of the same `checkInTicket` DAL call.
- **Seat-hold TTL.** Seat claims are atomic (transactional
  AVAILABLE→BOOKED) but there's no "seat reserved for 5 minutes while
  you pay" hold; a `PENDING_PAYMENT` booking currently keeps its seats
  claimed until someone cancels it.
