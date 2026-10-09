'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import type { OrgBus, OrgBusRoute, OrgBusSchedule, OrgBusTrip } from '@/lib/parcel-org-session';
import {
  cancelOrgBusTrip,
  createOrgBusTrip,
  deleteOrgBus,
  deleteOrgBusSchedule,
  saveOrgBus,
  saveOrgBusSchedule,
} from '../../actions';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Tab = 'buses' | 'schedules' | 'trips';

export function TransportManager({
  buses, routes, schedules, trips,
}: {
  buses: OrgBus[];
  routes: OrgBusRoute[];
  schedules: OrgBusSchedule[];
  trips: OrgBusTrip[];
}) {
  const [tab, setTab] = useState<Tab>('buses');

  return (
    <div className="porgroutes">
      <div className="porgroutes-bar" role="tablist" aria-label="Transport section">
        {([
          ['buses', `Buses (${buses.length})`],
          ['schedules', `Schedules (${schedules.length})`],
          ['trips', `Trips (${trips.length})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'btn btn-p btn-sm' : 'btn btn-o btn-sm'}
            onClick={() => setTab(key)}
            role="tab"
            aria-selected={tab === key}
          >
            {label}
          </button>
        ))}
      </div>

      {routes.length === 0 && (
        <div className="note n-blue">
          <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
          <p>
            A bus runs on one of your stations-based routes — the same ones your parcel
            runs use. <Link href={'/parcel-org/settings/routes' as Route}>Add a route</Link>{' '}
            (Nairobi → Homabay via Kisii, say) before scheduling a bus on it.
          </p>
        </div>
      )}

      {tab === 'buses' && <BusesTab buses={buses} />}
      {tab === 'schedules' && <SchedulesTab schedules={schedules} buses={buses} routes={routes} />}
      {tab === 'trips' && <TripsTab trips={trips} buses={buses} routes={routes} />}
    </div>
  );
}

// ─────────────────────────────── Buses ────────────────────────────

function BusesTab({ buses }: { buses: OrgBus[] }) {
  const [editing, setEditing] = useState<OrgBus | 'new' | null>(null);

  if (editing !== null) {
    return <BusEditor bus={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />;
  }

  return (
    <>
      <div className="porgroutes-bar">
        <button type="button" className="btn btn-p btn-sm" onClick={() => setEditing('new')}>
          <Icon name="plus" size={15} />New bus
        </button>
      </div>
      {buses.length === 0 ? (
        <p className="porgroutes-empty">No buses yet. Add your first one to start scheduling trips.</p>
      ) : (
        <ul className="porgroutes-list">
          {buses.map((b) => (
            <li key={b.id}>
              <div className="porgroutes-id">
                <span className="porgroutes-name">
                  {b.name}
                  <span className="mono porgroutes-code">{b.plateNumber}</span>
                  {b.status === 'INACTIVE' && <span className="pill p-warn">Inactive</span>}
                </span>
                <span className="sub">
                  {b.totalSeats} seats{b.seatLayout ? ` · ${b.seatLayout}` : ''}
                  {b.amenities.length > 0 ? ` · ${b.amenities.join(', ')}` : ''}
                </span>
              </div>
              <button type="button" className="btn btn-o btn-sm" onClick={() => setEditing(b)}>Edit</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function BusEditor({ bus, onDone }: { bus: OrgBus | null; onDone: () => void }) {
  const [name, setName] = useState(bus?.name ?? '');
  const [plateNumber, setPlateNumber] = useState(bus?.plateNumber ?? '');
  const [totalSeats, setTotalSeats] = useState(bus ? String(bus.totalSeats) : '44');
  const [seatLayout, setSeatLayout] = useState(bus?.seatLayout ?? '2+2');
  const [amenities, setAmenities] = useState(bus?.amenities.join(', ') ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>(bus?.status ?? 'ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await saveOrgBus({
        id: bus?.id,
        name, plateNumber,
        totalSeats: Number(totalSeats),
        seatLayout: seatLayout || null,
        amenities: amenities.split(',').map((a) => a.trim()).filter(Boolean),
        status,
      });
      if (res.ok) onDone(); else setError(res.error);
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await deleteOrgBus(bus!.id);
      if (res.ok) onDone(); else setError(res.error);
    });
  }

  return (
    <div className="porgroutes-editor">
      <h2>{bus ? 'Edit bus' : 'New bus'}</h2>
      <div className="porgroutes-fields">
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Coach 1" />
        </label>
        <label>
          <span>Number plate</span>
          <input className="mono" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value.toUpperCase())} placeholder="KDA 123X" />
        </label>
        <label>
          <span>Total seats</span>
          <input type="number" min={1} max={120} value={totalSeats} onChange={(e) => setTotalSeats(e.target.value)} />
        </label>
        <label>
          <span>Seat layout</span>
          <input value={seatLayout} onChange={(e) => setSeatLayout(e.target.value)} placeholder="2+2" />
          <em className="sub">Shown on the seat picker. Optional.</em>
        </label>
        <label>
          <span>Amenities</span>
          <input value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder="WiFi, Charging, Reclining" />
          <em className="sub">Comma-separated. Optional.</em>
        </label>
        {bus && (
          <label className="porgroutes-check">
            <input type="checkbox" checked={status === 'ACTIVE'} onChange={(e) => setStatus(e.target.checked ? 'ACTIVE' : 'INACTIVE')} />
            <span>Active — uncheck to retire it without deleting</span>
          </label>
        )}
      </div>
      {error && <p className="porg-export-note" role="status"><Icon name="alert-triangle" size={15} />{error}</p>}
      <div className="porgroutes-actions">
        <button type="button" className="btn btn-p btn-sm" onClick={save} disabled={pending || !name.trim() || !plateNumber.trim() || !totalSeats}>
          {pending ? 'Saving…' : 'Save bus'}
        </button>
        <button type="button" className="btn btn-o btn-sm" onClick={onDone} disabled={pending}>Cancel</button>
        {bus && <button type="button" className="btn btn-o btn-sm porgroutes-del" onClick={remove} disabled={pending}>Delete</button>}
      </div>
    </div>
  );
}

// ─────────────────────────────── Schedules ─────────────────────────

function SchedulesTab({
  schedules, buses, routes,
}: { schedules: OrgBusSchedule[]; buses: OrgBus[]; routes: OrgBusRoute[] }) {
  const [editing, setEditing] = useState<OrgBusSchedule | 'new' | null>(null);
  const activeBuses = buses.filter((b) => b.status === 'ACTIVE');
  const activeRoutes = routes.filter((r) => r.active);

  if (editing !== null) {
    return (
      <ScheduleEditor
        schedule={editing === 'new' ? null : editing}
        buses={activeBuses}
        routes={activeRoutes}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    <>
      <div className="porgroutes-bar">
        <button
          type="button"
          className="btn btn-p btn-sm"
          onClick={() => setEditing('new')}
          disabled={activeBuses.length === 0 || activeRoutes.length === 0}
        >
          <Icon name="plus" size={15} />New schedule
        </button>
        {(activeBuses.length === 0 || activeRoutes.length === 0) && (
          <span className="sub">Add an active bus and route first.</span>
        )}
      </div>
      {schedules.length === 0 ? (
        <p className="porgroutes-empty">
          No schedules yet. A schedule sets a fare and capacity for a bus running a
          route, and generates bookable trips automatically.
        </p>
      ) : (
        <ul className="porgroutes-list">
          {schedules.map((s) => (
            <li key={s.id}>
              <div className="porgroutes-id">
                <span className="porgroutes-name">
                  {s.originName} → {s.destinationName}
                  {!s.active && <span className="pill p-warn">Paused</span>}
                </span>
                <span className="sub">
                  {s.busName} · departs {s.departTime} · KES {s.priceKes.toLocaleString('en-KE')}
                </span>
                <span className="sub">
                  {s.daysOfWeek.length === 7 ? 'Every day' : s.daysOfWeek.sort().map((d) => DAY_LABELS[d]).join(', ')}
                </span>
              </div>
              <button type="button" className="btn btn-o btn-sm" onClick={() => setEditing(s)}>Edit</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ScheduleEditor({
  schedule, buses, routes, onDone,
}: {
  schedule: OrgBusSchedule | null;
  buses: OrgBus[];
  routes: OrgBusRoute[];
  onDone: () => void;
}) {
  const [busId, setBusId] = useState(schedule?.busId ?? buses[0]?.id ?? '');
  const [routeId, setRouteId] = useState(schedule?.routeId ?? routes[0]?.id ?? '');
  const [departTime, setDepartTime] = useState(schedule?.departTime ?? '06:00');
  const [days, setDays] = useState<number[]>(schedule?.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]);
  const [priceKes, setPriceKes] = useState(schedule ? String(schedule.priceKes) : '');
  const [active, setActive] = useState(schedule?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveOrgBusSchedule({
        id: schedule?.id, busId, routeId, departTime, daysOfWeek: days,
        priceKes: Number(priceKes), active,
      });
      if (res.ok) onDone(); else setError(res.error);
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await deleteOrgBusSchedule(schedule!.id);
      if (res.ok) onDone(); else setError(res.error);
    });
  }

  return (
    <div className="porgroutes-editor">
      <h2>{schedule ? 'Edit schedule' : 'New schedule'}</h2>
      <div className="porgroutes-fields">
        <label>
          <span>Bus</span>
          <select value={busId} onChange={(e) => setBusId(e.target.value)}>
            {buses.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.plateNumber})</option>)}
          </select>
        </label>
        <label>
          <span>Route</span>
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.originName} → {r.destinationName}</option>)}
          </select>
        </label>
        <label>
          <span>Departure time</span>
          <input type="time" value={departTime} onChange={(e) => setDepartTime(e.target.value)} />
        </label>
        <label>
          <span>Fare (KES)</span>
          <input type="number" min={1} value={priceKes} onChange={(e) => setPriceKes(e.target.value)} placeholder="1200" />
        </label>
        <label className="porgroutes-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Running — uncheck to pause it without deleting</span>
        </label>
      </div>
      <h3>Runs on</h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {DAY_LABELS.map((label, d) => (
          <button
            key={d}
            type="button"
            className={days.includes(d) ? 'btn btn-p btn-sm' : 'btn btn-o btn-sm'}
            onClick={() => toggleDay(d)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="porg-export-note" role="status"><Icon name="alert-triangle" size={15} />{error}</p>}
      <div className="porgroutes-actions">
        <button
          type="button"
          className="btn btn-p btn-sm"
          onClick={save}
          disabled={pending || !busId || !routeId || !departTime || !priceKes || days.length === 0}
        >
          {pending ? 'Saving…' : 'Save schedule'}
        </button>
        <button type="button" className="btn btn-o btn-sm" onClick={onDone} disabled={pending}>Cancel</button>
        {schedule && <button type="button" className="btn btn-o btn-sm porgroutes-del" onClick={remove} disabled={pending}>Delete</button>}
      </div>
      {days.length === 0 && <p className="sub">Pick at least one day this schedule runs.</p>}
    </div>
  );
}

// ─────────────────────────────── Trips ─────────────────────────────

function TripsTab({
  trips, buses, routes,
}: { trips: OrgBusTrip[]; buses: OrgBus[]; routes: OrgBusRoute[] }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function cancel(id: string) {
    setError(null);
    start(async () => {
      const res = await cancelOrgBusTrip(id);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <>
      <div className="porgroutes-bar">
        <button type="button" className="btn btn-p btn-sm" onClick={() => setAdding((v) => !v)}>
          <Icon name="plus" size={15} />{adding ? 'Close' : 'Add one-off trip'}
        </button>
        <span className="sub">
          Upcoming trips from your schedules appear here automatically, up to 14 days out.
        </span>
      </div>

      {adding && (
        <OneOffTripForm buses={buses} routes={routes} onDone={() => setAdding(false)} />
      )}

      {error && <p className="porg-export-note" role="status"><Icon name="alert-triangle" size={15} />{error}</p>}

      {trips.length === 0 ? (
        <p className="porgroutes-empty">No upcoming trips yet — add a schedule, or an one-off trip above.</p>
      ) : (
        <ul className="porgroutes-list">
          {trips.map((t) => (
            <li key={t.id}>
              <div className="porgroutes-id">
                <span className="porgroutes-name">
                  {t.originName} → {t.destinationName}
                  <span className="mono porgroutes-code">{t.plateNumber}</span>
                </span>
                <span className="sub">
                  {new Date(t.departAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}
                  {' · KES '}{t.priceKes.toLocaleString('en-KE')}
                  {' · '}{t.seatsAvailable}/{t.seatsTotal} seats left
                </span>
              </div>
              <button type="button" className="btn btn-o btn-sm" onClick={() => cancel(t.id)} disabled={pending}>
                Cancel trip
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function OneOffTripForm({
  buses, routes, onDone,
}: { buses: OrgBus[]; routes: OrgBusRoute[]; onDone: () => void }) {
  const activeBuses = buses.filter((b) => b.status === 'ACTIVE');
  const activeRoutes = routes.filter((r) => r.active);
  const [busId, setBusId] = useState(activeBuses[0]?.id ?? '');
  const [routeId, setRouteId] = useState(activeRoutes[0]?.id ?? '');
  const [departAt, setDepartAt] = useState('');
  const [priceKes, setPriceKes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    if (!departAt) { setError('Pick a departure date and time.'); return; }
    start(async () => {
      const res = await createOrgBusTrip({
        busId, routeId, priceKes: Number(priceKes),
        departAt: new Date(departAt).toISOString(),
      });
      if (res.ok) onDone(); else setError(res.error);
    });
  }

  return (
    <div className="porgroutes-editor">
      <h3>One-off trip</h3>
      <div className="porgroutes-fields">
        <label>
          <span>Bus</span>
          <select value={busId} onChange={(e) => setBusId(e.target.value)}>
            {activeBuses.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.plateNumber})</option>)}
          </select>
        </label>
        <label>
          <span>Route</span>
          <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            {activeRoutes.map((r) => <option key={r.id} value={r.id}>{r.originName} → {r.destinationName}</option>)}
          </select>
        </label>
        <label>
          <span>Departure</span>
          <input type="datetime-local" value={departAt} onChange={(e) => setDepartAt(e.target.value)} />
        </label>
        <label>
          <span>Fare (KES)</span>
          <input type="number" min={1} value={priceKes} onChange={(e) => setPriceKes(e.target.value)} />
        </label>
      </div>
      {error && <p className="porg-export-note" role="status"><Icon name="alert-triangle" size={15} />{error}</p>}
      <div className="porgroutes-actions">
        <button type="button" className="btn btn-p btn-sm" onClick={save} disabled={pending || !busId || !routeId || !priceKes}>
          {pending ? 'Adding…' : 'Add trip'}
        </button>
        <button type="button" className="btn btn-o btn-sm" onClick={onDone} disabled={pending}>Cancel</button>
      </div>
    </div>
  );
}
