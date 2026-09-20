'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import type { DispatchPing, DispatchRun, OrgRoute, ParcelOrgStaffRow, ParcelOrgStationRow } from '@/lib/parcel-org-session';
import {
  arriveDispatch, cancelDispatch, createDispatch, getDispatch, listDispatches,
  reportDispatchPosition, type DispatchCrewInput,
} from '../actions';
import { setFormActive } from '../form-activity';
import { DemoCallButton, DemoMessageButton } from '@/components/DemoContact';
import { FleetDispatchMap } from './FleetDispatchMap';
import {
  currentSpeedKmh, distanceCoveredKm, journeyProgress, lastSeenLabel,
  lastSeenTone, recordedStops,
} from './dispatch-stats';

const VEHICLE_TYPES = ['VAN', 'TRUCK', 'BUS', 'PICKUP', 'MOTORBIKE', 'OTHER'] as const;

const CREW_ROLES: [value: string, label: string][] = [
  ['DRIVER', 'Driver'],
  ['TOUT', 'Tout / conductor'],
  ['LOADER', 'Loader'],
  ['OTHER', 'Other…'],
];

const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '9px 11px',
  border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.92rem',
};

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px',
  background: 'var(--paper)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0, fontSize: '.72rem', fontWeight: 700, letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--tx-2)',
};

const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: 10, marginTop: 8,
};

interface CrewRow {
  key: number;
  name: string;
  msisdn: string;
  role: string;
  customRole: string;
  staffId: string;
}

let crewKey = 1;
function blankCrewRow(): CrewRow {
  return { key: crewKey++, name: '', msisdn: '', role: 'DRIVER', customRole: '', staffId: '' };
}

// A run now has a loading phase, because it now has cargo. ACTIVE used
// to be the only live status a dispatch could hold — it was created at
// the moment a vehicle set off, having nothing to wait for (ADR-0006).
function statusPill(status: string): string {
  switch (status) {
    case 'LOADING': return 'p-warn';
    case 'DEPARTED': return 'p-ok';
    case 'ARRIVED': return 'p-info';
    default: return 'p-bad';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'LOADING': return 'Loading';
    case 'DEPARTED': return 'On the road';
    case 'ARRIVED': return 'Arrived';
    case 'CANCELLED': return 'Cancelled';
    default: return status;
  }
}

/** Still the dispatcher's problem today: at the shed taking boxes, or
 *  out on the road. Two states where there used to be one. */
function isOpenRun(status: string): boolean {
  return status === 'LOADING' || status === 'DEPARTED';
}

function seenPillTone(tone: 'g' | 'a' | 'r' | undefined): string {
  switch (tone) {
    case 'g': return 'p-ok';
    case 'a': return 'p-warn';
    case 'r': return 'p-bad';
    default: return '';
  }
}

/**
 * The dispatch board: open a run (vehicle + crew + leg + receiving
 * team), watch the whole fleet on one map, and check runs in on
 * arrival. Fleet-level, deliberately — a run is the unit a dispatcher
 * thinks in, so this page still never lists individual parcels.
 *
 * It does now say how many are aboard, and prints the manifest for
 * them. Before ADR-0006 it could do neither: the parcels lived on a
 * separate shipment record with no foreign key to this one, so the
 * board showed a lorry it could not tell you the contents of.
 */
export function DispatchBoard({
  initialRuns, stations, staff, routes, orgName,
}: {
  initialRuns: DispatchRun[];
  stations: ParcelOrgStationRow[];
  staff: ParcelOrgStaffRow[];
  routes: OrgRoute[];
  orgName: string;
}) {
  const [runs, setRuns] = useState(initialRuns);
  // The page's DropoffPoll calls router.refresh() every 30s, which
  // re-runs the server component and hands us a fresh initialRuns. The
  // board must adopt it or the poll would re-fetch endlessly and never
  // move the board — this is the whole "live fleet" mechanism.
  useEffect(() => {
    setRuns(initialRuns);
  }, [initialRuns]);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => initialRuns.find((r) => isOpenRun(r.status))?.id ?? null,
  );
  // What the map marker + inspector highlight (selectedId) is separate
  // from which run card is actually expanded. Picking a marker on the
  // map opens the inspector under the map instead of yanking the page
  // down to the card, and the card only opens when the dispatcher asks
  // for full detail — so a click never feels like it "slides away".
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [trails, setTrails] = useState<Record<string, DispatchPing[]>>({});
  const [showClosed, setShowClosed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = runs.find((r) => r.id === selectedId) ?? null;
  const withTrail = (r: DispatchRun): DispatchRun => {
    const t = trails[r.id];
    return t ? { ...r, trail: t } : r;
  };
  const selectedWithTrail = selected ? withTrail(selected) : null;
  const runsWithTrails = runs.map(withTrail);
  const visible = showClosed ? runsWithTrails : runsWithTrails.filter((r) => isOpenRun(r.status));
  const activeStaff = staff.filter((s) => s.active);

  async function refresh() {
    // A failed refetch (network blip, or the shift session expired) is
    // not worth throwing the dispatcher out of the board over — the
    // mutation that triggered it already succeeded server-side, and the
    // board stays on what it has. The next action will surface the
    // session problem when it matters.
    try { setRuns(await listDispatches(true)); } catch { /* keep the current board */ }
  }

  // The board list carries no trail (payload weight); the selected
  // run's journey loads on demand for the map line and the detail.
  useEffect(() => {
    if (!selectedId || trails[selectedId]) return;
    let live = true;
    void getDispatch(selectedId).then((detail) => {
      if (live && detail) setTrails((t) => ({ ...t, [selectedId]: detail.trail ?? [] }));
    });
    return () => { live = false; };
  }, [selectedId, trails]);

  // While the create form is open the dashboard poller stands down, so
  // the page never refreshes mid-entry (see DropoffPoll).
  useEffect(() => {
    if (!formOpen) return;
    setFormActive(true);
    return () => setFormActive(false);
  }, [formOpen ]);

  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-p btn-sm" onClick={() => setFormOpen((v) => !v)}>
          <Icon name={formOpen ? 'close' : 'plus'} size={14} />
          {formOpen ? 'Close' : 'New dispatch'}
        </button>
        <label className="sub" style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show arrived &amp; cancelled
        </label>
      </div>

      {formOpen && (
        <CreateDispatchForm
          stations={stations}
          staff={activeStaff}
          routes={routes}
          pending={pending}
          startTransition={startTransition}
          onDone={(id) => { setFormOpen(false); void refresh().then(() => setSelectedId(id)); }}
        />
      )}

      {visible.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="ico"><Icon name="send" size={22} /></span>
            <h3>No runs on the board.</h3>
            <p className="sub">Open a dispatch to put the first fleet on the map.</p>
          </div>
        </div>
      ) : (
        <>
          <FleetDispatchMap
            runs={visible}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              // The inspector sits just under the map, so this barely
              // moves — it never scrolls the page to the run card.
              document.getElementById('run-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
          />

          <RunInspector
            run={selectedWithTrail}
            onFullDetails={(id) => {
              setExpandedId((prev) => (prev === id ? null : id));
              document.getElementById(`run-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
          />

          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            {visible.map((r) => {
              const expanded = r.id === expandedId;
              return (
              <article
                key={r.id}
                id={`run-${r.id}`}
                className="card"
                style={{
                  padding: 16,
                  outline: r.id === selectedId ? '2px solid var(--blue, #1565C0)' : undefined,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <span className="mono" style={{ fontWeight: 800, fontSize: '1.05rem' }}>{r.vehiclePlate}</span>
                    <span className="sub"> · {r.vehicleType.toLowerCase()}</span>{' '}
                    <span className={`pill ${statusPill(r.status)}`}>{statusLabel(r.status)}</span>{' '}
                    {r.status === 'DEPARTED' && (
                      <span className={`pill ${seenPillTone(lastSeenTone(r.currentAt))}`}>{lastSeenLabel(r.currentAt)}</span>
                    )}
                    <div className="sub" style={{ marginTop: 4 }}>
                      {r.origin?.name ?? '—'} → {r.destination?.name ?? '—'}
                      {r.routeName && <> · {r.routeName}</>}
                      {' · '}{r.crew.length} crew
                      {r.receivers.length > 0 && <> · receiving: {r.receivers.map((x) => x.name).join(', ')}</>}
                    </div>
                    {/* What is actually on the vehicle, and the paper for
                        it. The board could not answer either question
                        before the merge — the parcels lived on a record
                        this one had no key to (ADR-0006). */}
                    <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
                      <span className="pill p-info mono">
                        {r.loaded} {r.loaded === 1 ? 'parcel' : 'parcels'}
                      </span>
                      <Link
                        className="btn btn-o btn-sm"
                        href={`/parcel-org/dispatch/runs/${r.id}/manifest` as Route}
                      >
                        <Icon name="print" size={14} />Manifest
                      </Link>
                    </div>
                  </div>
                  <button
                    className="btn btn-o btn-sm"
                    onClick={() => {
                      const next = expanded ? null : r.id;
                      setExpandedId(next);
                      if (next) document.getElementById(`run-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }}
                  >
                    {expanded ? 'Hide details' : 'Full details'}
                    <Icon name="chevron-right" size={14} />
                  </button>
                </div>
                {expanded && (
                  <RunDetail
                    run={r}
                    orgName={orgName}
                    pending={pending}
                    startTransition={startTransition}
                    onChanged={refresh}
                  />
                )}
              </article>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/**
 * The strip that sits under the fleet map. Clicking a marker puts that
 * run here — plate, driver, how far along the leg, how it's moving —
 * without dragging the page down to the card. "Full details" is the
 * deliberate step for the whole card, with its crew/receiving/custody
 * controls (see DispatchBoard's expandedId).
 */
function RunInspector({
  run, onFullDetails,
}: {
  run: DispatchRun | null;
  onFullDetails: (id: string) => void;
}) {
  if (!run) {
    return (
      <div id="run-inspector" className="card" style={{ padding: 14, marginTop: 10 }}>
        <p className="sub" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
          <Icon name="map" size={16} />
          Pick a marker on the map to inspect that run.
        </p>
      </div>
    );
  }

  const driver = run.crew.find((c) => c.role === 'DRIVER') ?? run.crew[0] ?? null;
  const progress = journeyProgress(run);
  // DEPARTED, not merely open: a run still at the shed has no position
  // to report and no arrival to confirm, and the server refuses both
  // for a LOADING run (see dbx.ReportRunPosition).
  const isActive = run.status === 'DEPARTED';

  return (
    <div id="run-inspector" className="card" style={{ padding: 14, marginTop: 10 }}>
      <div className="row" style={{ gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontWeight: 800, fontSize: '1.05rem' }}>{run.vehiclePlate}</span>
            <span className="sub">{run.vehicleType.toLowerCase()}</span>
            <span className={`pill ${statusPill(run.status)}`}>{statusLabel(run.status)}</span>
            {isActive && (
              <span className={`pill ${seenPillTone(lastSeenTone(run.currentAt))}`}>{lastSeenLabel(run.currentAt)}</span>
            )}
          </span>
          <div className="sub" style={{ marginTop: 4 }}>
            {run.origin?.name ?? '—'} → {run.destination?.name ?? '—'}
            {driver && <> · {driver.name}{driver.msisdn ? ` (${driver.msisdn})` : ''}</>}
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {driver?.msisdn && (
            <>
              <DemoCallButton msisdn={driver.msisdn} primary />
              <DemoMessageButton msisdn={driver.msisdn} />
            </>
          )}
          <button className="btn btn-p btn-sm" onClick={() => onFullDetails(run.id)}>
            Full details<Icon name="chevron-right" size={14} />
          </button>
        </div>
      </div>

      {progress !== null && (
        <div aria-label={`${Math.round(progress * 100)}% of journey complete`} style={{ height: 6, borderRadius: 4, background: 'var(--line)', overflow: 'hidden', marginTop: 14 }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--blue, #1565C0)' }} />
        </div>
      )}
    </div>
  );
}

function CreateDispatchForm({
  stations, staff, routes, pending, startTransition, onDone,
}: {
  stations: ParcelOrgStationRow[];
  staff: ParcelOrgStaffRow[];
  routes: OrgRoute[];
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  onDone: (id: string) => void;
}) {
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<string>('VAN');
  const [routeId, setRouteId] = useState('');
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [notes, setNotes] = useState('');
  const [crew, setCrew] = useState<CrewRow[]>([blankCrewRow()]);
  const [receiverIds, setReceiverIds] = useState<string[]>([]);
  const [receiverName, setReceiverName] = useState('');
  const [extraReceivers, setExtraReceivers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ready = plate.trim() && destinationId && crew.some((c) => c.name.trim());

  function patchCrew(key: number, patch: Partial<CrewRow>) {
    setCrew((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save() {
    setError(null);
    const crewInput: DispatchCrewInput[] = crew
      .filter((c) => c.name.trim())
      .map((c) => ({
        name: c.name.trim(),
        msisdn: c.msisdn.trim() || null,
        role: c.role,
        customRole: c.role === 'OTHER' ? c.customRole.trim() || c.name.trim() : null,
        staffId: c.staffId || null,
      }));
    const receivers = [
      ...receiverIds
        .map((id) => staff.find((s) => s.id === id))
        .filter((s): s is ParcelOrgStaffRow => Boolean(s))
        .map((s) => ({ name: s.name, staffId: s.id })),
      ...extraReceivers.map((name) => ({ name, staffId: null as string | null })),
    ];
    startTransition(async () => {
      const result = await createDispatch({
        vehiclePlate: plate,
        vehicleType,
        routeId: routeId || null,
        originStationId: originId || null,
        destinationStationId: destinationId || null,
        notes: notes.trim() || null,
        crew: crewInput,
        receivers,
      });
      if (!result.ok) { setError(result.error); return; }
      onDone(result.id);
    });
  }

  return (
    <section className="card" style={{ marginBottom: 18, padding: 18 }}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>New dispatch</h2>
      <p className="sub" style={{ margin: '4px 0 0', maxWidth: '70ch' }}>
        Put a fleet on the board: the vehicle, who is aboard and what each person does,
        where it is going, and who checks it in when it arrives.
      </p>

      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        <fieldset style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Vehicle</h3>
          <div style={gridStyle}>
            <label className="sub">Number plate
              <input style={inputStyle} className="mono" value={plate} placeholder="e.g. KDK 412P"
                onChange={(e) => setPlate(e.target.value.toUpperCase())} />
            </label>
            <label className="sub">Vehicle type
              <select style={inputStyle} value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Journey</h3>
          {/* Route first, and it fills the two fields below. Picking one
              is the common morning case — the same leg every day — and
              typing it out is the exception, not the default. Ad-hoc
              stays possible on purpose: a vehicle at the door nobody
              planned for must not wait on a manager defining a route
              (ADR-0006). */}
          {routes.length > 0 && (
            <label className="sub">Route
              <select
                style={inputStyle}
                value={routeId}
                onChange={(e) => {
                  const id = e.target.value;
                  setRouteId(id);
                  const r = routes.find((x) => x.id === id);
                  if (r && r.stops.length >= 2) {
                    setOriginId(r.stops[0]!.stationId);
                    setDestinationId(r.stops[r.stops.length - 1]!.stationId);
                  }
                }}
              >
                <option value="">Ad-hoc — no route</option>
                {routes.filter((r) => r.active).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.code ? ` (${r.code})` : ''}
                  </option>
                ))}
              </select>
              <em className="sub">
                Sets where it leaves from and where it ends. Change either below if
                this vehicle is only doing part of the route.
              </em>
            </label>
          )}
          <div style={gridStyle}>
            <label className="sub">From
              <select style={inputStyle} value={originId} onChange={(e) => setOriginId(e.target.value)}>
                <option value="">—</option>
                {stations.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="sub">To
              <select style={inputStyle} value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
                <option value="">—</option>
                {stations.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="sub">Notes (optional)
            <input style={inputStyle} value={notes} placeholder="e.g. Two crates of avocados, call on approach"
              onChange={(e) => setNotes(e.target.value)} />
          </label>
        </fieldset>

        <fieldset style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Crew aboard</h3>
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            {crew.map((c) => (
              <div key={c.key} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
                <label className="sub">Name
                  <input style={inputStyle} value={c.name} placeholder="e.g. Otieno"
                    onChange={(e) => patchCrew(c.key, { name: e.target.value })} />
                </label>
                <label className="sub">Phone (optional)
                  <input style={inputStyle} className="mono" value={c.msisdn} placeholder="07…" inputMode="tel"
                    onChange={(e) => patchCrew(c.key, { msisdn: e.target.value })} />
                </label>
                <label className="sub">Role
                  <select style={inputStyle} value={c.role} onChange={(e) => patchCrew(c.key, { role: e.target.value })}>
                    {CREW_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {c.role === 'OTHER' && (
                  <label className="sub">Custom role
                    <input style={inputStyle} value={c.customRole} placeholder="e.g. Mechanic"
                      onChange={(e) => patchCrew(c.key, { customRole: e.target.value })} />
                  </label>
                )}
                <label className="sub">On the roster?
                  <select style={inputStyle} value={c.staffId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const member = staff.find((s) => s.id === id);
                      patchCrew(c.key, {
                        staffId: id,
                        ...(member && !c.name.trim() ? { name: member.name } : {}),
                      });
                    }}>
                    <option value="">Typed name only</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.role.toLowerCase()}</option>)}
                  </select>
                </label>
                <button
                  className="btn btn-o btn-sm" disabled={crew.length <= 1}
                  onClick={() => setCrew((rows) => rows.filter((r) => r.key !== c.key))}
                  aria-label="Remove crew member"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn-o btn-sm" style={{ marginTop: 10 }} onClick={() => setCrew((rows) => [...rows, blankCrewRow()])}>
            <Icon name="plus" size={14} />Add crew member
          </button>
        </fieldset>

        <fieldset style={sectionStyle}>
          <h3 style={sectionTitleStyle}>Receiving team — checks the run in on arrival</h3>
          {staff.length === 0 ? (
            <p className="sub">No team members yet — type a name below instead.</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {staff.map((s) => (
                <label key={s.id} className="sub" style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px' }}>
                  <input
                    type="checkbox"
                    checked={receiverIds.includes(s.id)}
                    onChange={(e) => setReceiverIds((ids) => e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <input
              style={{ ...inputStyle, marginTop: 0, flex: 1 }}
              value={receiverName}
              placeholder="Or type a name at the counter…"
              onChange={(e) => setReceiverName(e.target.value)}
            />
            <button
              className="btn btn-o btn-sm"
              disabled={!receiverName.trim()}
              onClick={() => { setExtraReceivers((xs) => [...xs, receiverName.trim()]); setReceiverName(''); }}
            >
              <Icon name="plus" size={14} />Add
            </button>
          </div>
          {extraReceivers.length > 0 && (
            <p className="sub" style={{ marginTop: 8 }}>
              Added: {extraReceivers.join(', ')}{' '}
              <button className="btn btn-o btn-sm" onClick={() => setExtraReceivers([])}>Clear</button>
            </p>
          )}
        </fieldset>
      </div>

      {error && <p role="alert" className="sub" style={{ color: 'var(--red)', marginTop: 12 }}>{error}</p>}

      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <button className="btn btn-p btn-sm" disabled={pending || !ready} onClick={save}>
          {pending ? 'Opening…' : 'Open dispatch'}
        </button>
      </div>
    </section>
  );
}

function RunDetail({
  run, orgName, pending, startTransition, onChanged,
}: {
  run: DispatchRun;
  orgName: string;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  onChanged: () => Promise<void>;
}) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // DEPARTED, not merely open: a run still at the shed has no position
  // to report and no arrival to confirm, and the server refuses both
  // for a LOADING run (see dbx.ReportRunPosition).
  const isActive = run.status === 'DEPARTED';
  const driver = run.crew.find((c) => c.role === 'DRIVER') ?? run.crew[0] ?? null;
  const others = run.crew.filter((c) => c !== driver);
  const stops = recordedStops(run.trail);
  const speed = currentSpeedKmh(run.trail);
  const progress = journeyProgress(run);
  const covered = distanceCoveredKm(run.trail);

  function useMyLocation() {
    if (!('geolocation' in navigator)) { setError('This device has no location to share'); return; }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
      },
      () => { setLocating(false); setError('Could not read this device’s location'); },
      { timeout: 10000 },
    );
  }

  function postPosition() {
    setError(null);
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) { setError('Enter a valid latitude and longitude'); return; }
    startTransition(async () => {
      const result = await reportDispatchPosition(run.id, la, ln);
      if (!result.ok) { setError(result.error); return; }
      setLat(''); setLng('');
      await onChanged();
    });
  }

  function arrive() {
    setError(null);
    startTransition(async () => {
      const result = await arriveDispatch(run.id, receivedBy);
      if (!result.ok) { setError(result.error); return; }
      await onChanged();
    });
  }

  function cancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelDispatch(run.id);
      if (!result.ok) { setError(result.error); return; }
      await onChanged();
    });
  }

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      {/* Live summary: status, speed, progress, stops — the glanceable row. */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 12 }}>
        <div className="kpi">
          <span className="l">Status</span>
          <span className="n" style={{ fontSize: '1rem' }}>{isActive ? lastSeenLabel(run.currentAt) : statusLabel(run.status)}</span>
          <span className="sub">{orgName} fleet</span>
        </div>
        <div className="kpi">
          <span className="l">Moving at</span>
          <span className="n">{speed === null ? '—' : `${Math.round(speed)} km/h`}</span>
          <span className="sub">from the last two reports</span>
        </div>
        <div className="kpi">
          <span className="l">Journey</span>
          <span className="n">{progress === null ? '—' : `${Math.round(progress * 100)}%`}</span>
          <span className="sub">{covered < 1 ? 'just left' : `${covered.toFixed(1)} km covered`}</span>
        </div>
        <div className="kpi">
          <span className="l">Stops made</span>
          <span className="n">{stops.length}</span>
          <span className="sub">{run.trail.length} position reports</span>
        </div>
      </div>

      {progress !== null && (
        <div style={{ height: 8, borderRadius: 4, background: 'var(--line)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--blue, #1565C0)' }} />
        </div>
      )}

      {stops.length > 0 && (
        <p className="sub" style={{ margin: '0 0 12px' }}>
          <Icon name="pin" size={13} /> Stopped {stops.map((s) => `${s.mins} min`).join(' · ')} along the way.
        </p>
      )}

      <div style={gridStyle}>
        <div>
          <h4 style={sectionTitleStyle}>Driver</h4>
          {!driver ? (
            <p className="sub" style={{ margin: '8px 0 0' }}>No crew recorded on this run.</p>
          ) : (
            <div style={{ marginTop: 8 }}>
              <strong>{driver.name}</strong>{' '}
              <span className="sub">{driver.roleLabel.toLowerCase()}</span>
              {driver.msisdn && (
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <DemoCallButton msisdn={driver.msisdn} primary />
                  <DemoMessageButton msisdn={driver.msisdn} />
                </div>
              )}
            </div>
          )}
          {others.length > 0 && (
            <>
              <h4 style={{ ...sectionTitleStyle, marginTop: 12 }}>Also aboard</h4>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {others.map((c) => (
                  <li key={c.id} style={{ marginBottom: 4 }}>
                    <strong>{c.name}</strong>{' '}
                    <span className="sub">{c.roleLabel.toLowerCase()}{c.msisdn ? ` · ${c.msisdn}` : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <h4 style={sectionTitleStyle}>Receiving team</h4>
          {run.receivers.length === 0 ? (
            <p className="sub" style={{ margin: '8px 0 0' }}>Nobody named — say who signed on arrival.</p>
          ) : (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {run.receivers.map((r) => <li key={r.id}>{r.name}</li>)}
            </ul>
          )}
          {run.notes && <p className="sub" style={{ margin: '8px 0 0' }}>Note: {run.notes}</p>}
          {run.status === 'ARRIVED' && (
            <p className="sub" style={{ margin: '8px 0 0' }}>
              Checked in{run.receivedBy ? <> by <strong>{run.receivedBy}</strong></> : ''}.
            </p>
          )}
        </div>
      </div>

      {error && <p role="alert" className="sub" style={{ color: 'var(--red)', marginTop: 12 }}>{error}</p>}

      {isActive && (
        <>
          <div style={{ ...sectionStyle, marginTop: 12 }}>
            <h4 style={sectionTitleStyle}>Where is the fleet now?</h4>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                style={{ ...inputStyle, marginTop: 0, maxWidth: 170 }} className="mono"
                value={lat} placeholder="Latitude" inputMode="decimal"
                onChange={(e) => setLat(e.target.value.replace(/[^\d.-]/g, ''))}
              />
              <input
                style={{ ...inputStyle, marginTop: 0, maxWidth: 170 }} className="mono"
                value={lng} placeholder="Longitude" inputMode="decimal"
                onChange={(e) => setLng(e.target.value.replace(/[^\d.-]/g, ''))}
              />
              <button className="btn btn-o btn-sm" disabled={locating} onClick={useMyLocation}>
                <Icon name="pin" size={14} />{locating ? 'Reading…' : 'Use my location'}
              </button>
              <button className="btn btn-p btn-sm" disabled={pending || !lat || !lng} onClick={postPosition}>
                {pending ? 'Updating…' : 'Update position'}
              </button>
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <input
              style={{ ...inputStyle, marginTop: 0, flex: 1, minWidth: 200 }}
              value={receivedBy}
              placeholder={run.receivers.length > 0 ? `Who signed? (${run.receivers.map((r) => r.name).join(', ')})` : 'Who signed at the counter?'}
              onChange={(e) => setReceivedBy(e.target.value)}
            />
            <button className="btn btn-p btn-sm" disabled={pending} onClick={arrive}>
              <Icon name="check" size={14} />Mark arrived
            </button>
            <button className="btn btn-o btn-sm" disabled={pending} onClick={cancel}>
              Cancel run
            </button>
          </div>
        </>
      )}
    </div>
  );
}
