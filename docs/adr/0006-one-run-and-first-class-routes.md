# ADR-0006 — One run, and routes as a first-class thing

Status: accepted
Date: 2026-09-20

## Context

A courier company's vehicle movement was modelled twice, in two tables
with no foreign key between them.

`parcel_shipment` owned the **cargo**: `parcel_shipment_item` links each
parcel to the run, with `loadedAt`, `offloadedAt` and an exception code.
Its sense of place was three free-text columns — `originLabel`,
`destinationLabel`, `routeLabel`. It serves both Esoqo-operated runs
(`parcelOrgId` NULL) and a company's own.

`parcel_dispatch` owned the **journey**: origin and destination as real
station foreign keys, crew with roles, a receiving team at the far end,
and a GPS trail. It had no parcels at all.

So one lorry leaving Nairobi for Kisumu was two rows in two tables, and
which one you got depended on which screen you opened. The Dispatch
board read dispatches and could not tell you what was on the vehicle.
The Scanner loaded parcels onto shipments and could not tell you who was
driving. The manifest added in phase 4 had to hang off a separate list
rather than off the board, because a dispatch run has no manifest to
print.

This is the same entity-duplication that produced two scanners and three
run-creators in the UI, one layer down.

Two further things were blocked behind it:

- **Multi-leg journeys.** `parcel_shipment_item` can already express a
  parcel riding two vehicles — load, offload, load again. What was
  missing was any vocabulary for *where* the transfer happens, because
  places were free text on one model and foreign keys on the other.
- **Route-based pricing.** A courier prices by distance. The rate card
  was per parcel type only, because there was no route to price against.

## Decision

### 1. One run

Merge into `parcel_shipment`, not into `parcel_dispatch`.

`parcel_shipment` already serves both tenant classes and already owns
the join table where the valuable data lives. Merging the other
direction would mean either stranding Esoqo-operated runs or rebuilding
`parcel_shipment_item` against a new parent. The journey columns are
additive; the cargo table is untouched.

`parcel_dispatch`'s children — crew, receivers, pings — are re-pointed
rather than rebuilt. The data migration inserts each dispatch into
`parcel_shipment` **keeping its own id**, so the children's existing
foreign key values stay correct and only the column they point through
is renamed. `parcel_dispatch` is then dropped.

Lifecycle, merged from both vocabularies:

```
LOADING  →  DEPARTED  →  ARRIVED
   └──────────┴─────────────→  CANCELLED
```

`parcel_shipment.OPEN` becomes `LOADING` (what it always meant). A
migrated dispatch lands in `DEPARTED`, not `LOADING`: a dispatch was
created at the moment a vehicle set off and never had a loading phase,
because it never had parcels to load. Calling those rows `LOADING` would
assert a state they were never in.

### 2. Routes as a first-class thing

```
parcel_route        id, parcelOrgId, name, code, active
parcel_route_stop   id, routeId, sequence, stationId → parcel_agent
```

A route is an ordered list of stations a company serves. A run may cite
a route (`parcel_shipment.routeId`) or stand alone — an ad-hoc vehicle
at the door still has to be openable without a manager first defining a
route for it, or the counter stops during the exact rush the ad-hoc run
exists to absorb.

Places on a run become station foreign keys
(`originStationId`/`destinationStationId`). The free-text labels stay,
demoted to a **snapshot**: a run that happened is a historical record,
and a station renamed in March must not silently rewrite what a manifest
printed in January said. New runs write both; old rows keep the text
they always had.

**A leg is a consecutive pair of stops.** This needs no table. A parcel
loaded at stop 2 and offloaded at stop 4 rode legs 2→3 and 3→4, and
`parcel_shipment_item` already records exactly that, twice, once per
vehicle. Station-to-station transfer stops being a feature to build and
becomes a thing the existing rows can already say, once the stops have
names.

## Consequences

Enabled, in order of business value:

- **Route-based rates.** The rate card can now key on a route, which is
  how couriers actually price. This is the revenue feature the free-text
  columns made impossible.
- **The manifest becomes part of the board.** One run, one manifest,
  printed from the thing you are already looking at.
- **Legs.** Nairobi → Nakuru → Kisumu as one booking across two
  vehicles.
- **Route reporting.** Volume and on-time rate per route, which free
  text could never group by.

Costs and risks:

- One destructive migration. `parcel_dispatch` is dropped after its rows
  are copied; the id-preserving insert is what makes that reversible in
  principle, but it is a forward-only migration in practice.
- `/v1/parcel-orgs/me/dispatch` and `/v1/parcel-orgs/me/shipments` both
  now describe the same records. They are kept as aliases of
  `/v1/parcel-orgs/me/runs` rather than broken, because a rider's
  installed PWA may hold either.

## UI consequence

The portal's rule is one verb per page (see the parcel-org layout's own
nav comment). Routes obey it by splitting across two pages the way
Stations already does:

- **Defining** a route — its name, its stops, their order — is
  configuration a manager does monthly. It belongs in Settings, beside
  Stations, which is the same kind of thing: the company's own map.
- **Running** one is Dispatch, daily. Opening a run becomes picking a
  route instead of typing three free-text fields, with ad-hoc entry kept
  for the vehicle nobody planned for.

No new top-level nav entry: Routes is a Settings tab, and the run is
still Dispatch.
