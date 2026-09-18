'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { DispatchRun, ParcelOrgStaffRow, ParcelOrgStationRow } from '@/lib/parcel-org-session';
import {
  arriveDispatch, cancelDispatch, createDispatch, listDispatches,
  reportDispatchPosition, type DispatchCrewInput,
} from '../actions';
import { setFormActive } from '../form-activity';
import { FleetDispatchMap } from './FleetDispatchMap';

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

function statusPill(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'p-ok';
    case 'ARRIVED': return 'p-info';
    default: return 'p-bad';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'On the road';
    case 'ARRIVED': return 'Arrived';
    case 'CANCELLED': return 'Cancelled';
    default: return status;
  }
}

/**
 * The dispatch board: open a run (vehicle + crew + leg + receiving
 * team), watch the whole fleet on one map, and check runs in on
 * arrival. Fleet-level, deliberately — this page never lists individual
 * parcels; a run is the unit a dispatcher thinks in.
 */
export function DispatchBoard({
  initialRuns, stations, staff,
}: {
  initialRuns: DispatchRun[];
  stations: ParcelOrgStationRow[];
  staff: ParcelOrgStaffRow[];
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => initialRuns.find((r) => r.status === 'ACTIVE')?.id ?? null,
  );
  const [showClosed, setShowClosed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = runs.find((r) => r.id === selectedId) ?? null;
  const visible = showClosed ? runs : runs.filter((r) => r.status === 'ACTIVE');
  const activeStaff = staff.filter((s) => s.active);

  async function refresh() {
    setRuns(await listDispatches(true));
  }

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
              document.getElementById(`run-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
          />
          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            {visible.map((r) => (
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
                    <span className={`pill ${statusPill(r.status)}`}>{statusLabel(r.status)}</span>
                    <div className="sub" style={{ marginTop: 4 }}>
                      {r.origin?.name ?? '—'} → {r.destination?.name ?? '—'}
                      {' · '}{r.crew.length} crew
                      {r.receivers.length > 0 && <> · receiving: {r.receivers.map((x) => x.name).join(', ')}</>}
                    </div>
                  </div>
                  <button
                    className="btn btn-o btn-sm"
                    onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                  >
                    {r.id === selectedId ? 'Hide details' : 'Details'}
                    <Icon name="chevron-right" size={14} />
                  </button>
                </div>
                {r.id === selectedId && (
                  <RunDetail
                    run={r}
                    pending={pending}
                    startTransition={startTransition}
                    onChanged={refresh}
                  />
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function CreateDispatchForm({
  stations, staff, pending, startTransition, onDone,
}: {
  stations: ParcelOrgStationRow[];
  staff: ParcelOrgStaffRow[];
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  onDone: (id: string) => void;
}) {
  const [plate, setPlate] = useState('');
  const [vehicleType, setVehicleType] = useState<string>('VAN');
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
  run, pending, startTransition, onChanged,
}: {
  run: DispatchRun;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  onChanged: () => Promise<void>;
}) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const isActive = run.status === 'ACTIVE';

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
      <div style={gridStyle}>
        <div>
          <h4 style={sectionTitleStyle}>Crew aboard</h4>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {run.crew.map((c) => (
              <li key={c.id} style={{ marginBottom: 4 }}>
                <strong>{c.name}</strong>{' '}
                <span className="sub">{c.roleLabel.toLowerCase()}{c.msisdn ? ` · ${c.msisdn}` : ''}</span>
              </li>
            ))}
          </ul>
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
                onChange={(e) => setLat(e.target.value.replace(/[^\d.\-]/g, ''))}
              />
              <input
                style={{ ...inputStyle, marginTop: 0, maxWidth: 170 }} className="mono"
                value={lng} placeholder="Longitude" inputMode="decimal"
                onChange={(e) => setLng(e.target.value.replace(/[^\d.\-]/g, ''))}
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
