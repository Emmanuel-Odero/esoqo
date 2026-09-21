'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { ParcelOrgStationRow } from '@/lib/parcel-org-session';
import { saveOrgStation } from '../../actions';

/**
 * The station register. Each row opens a station's own page — its
 * location on a map and the team posted to it — rather than only being
 * editable here. Creating and editing a location stays on this screen.
 *
 * Rows, not a table: six columns (station, phone, team, capacity,
 * status, actions) could not fit a phone and scrolled sideways, which
 * hid the status — the one column that says whether a station is
 * taking parcels at all.
 */
export function StationsManager({ initial }: { initial: ParcelOrgStationRow[] }) {
  const [stations, setStations] = useState(initial);
  const [editing, setEditing] = useState<ParcelOrgStationRow | null>(null);
  const [adding, setAdding] = useState(false);

  const form = (adding || editing) ? (
    <StationForm
      initial={editing ?? undefined}
      onDone={(station) => {
        setStations((rows) => (editing ? rows.map((row) => (row.id === station.id ? station : row)) : [...rows, station]));
        setEditing(null); setAdding(false);
      }}
      onCancel={() => { setEditing(null); setAdding(false); }}
    />
  ) : null;

  return (
    <div className="porg-stations">
      {!form && (
        <div className="ptoolbar">
          <button className="btn btn-p" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />Add station
          </button>
        </div>
      )}

      {form}

      {stations.length === 0 && !form ? (
        <div className="ppanel">
          <div className="pempty">
            <span className="pempty-icon"><Icon name="pin" size={20} /></span>
            <strong>No stations yet</strong>
            <p>
              A station is a place receivers collect from, and the thing routes are
              built out of. Add the first one above.
            </p>
          </div>
        </div>
      ) : (
        <ul className="plist">
          {stations.map((s) => (
            <li key={s.id}>
              <div className="plist-main">
                <span className="plist-title">
                  <Link href={`/parcel-org/settings/stations/${s.id}` as Route}>{s.name}</Link>
                  <span className={`pill ${s.active ? 'p-ok' : 'p-mute'}`}>
                    {s.active ? 'Active' : 'Suspended'}
                  </span>
                </span>
                <span className="plist-sub">
                  {s.locationHint || 'No location note'}
                  {s.msisdn && <> · <span className="mono">{s.msisdn}</span></>}
                </span>
                <span className="plist-sub">
                  {s.memberCount > 0
                    ? `${s.memberCount} member${s.memberCount === 1 ? '' : 's'} posted`
                    : 'Nobody posted'}
                  {' · holds '}{s.capacity}
                </span>
              </div>
              <div className="plist-actions">
                <Link className="btn btn-o btn-sm" href={`/parcel-org/settings/stations/${s.id}` as Route}>
                  <Icon name="map" size={14} />Manage
                </Link>
                <button className="btn btn-o btn-sm"
                  onClick={() => { setEditing(s); setAdding(false); }}>Edit</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StationForm({
  initial, onDone, onCancel,
}: { initial?: ParcelOrgStationRow; onDone: (station: ParcelOrgStationRow) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [msisdn, setMsisdn] = useState(initial?.msisdn ?? '');
  const [locationHint, setLocationHint] = useState(initial?.locationHint ?? '');
  const [openingHours, setOpeningHours] = useState(initial?.openingHours ?? '');
  const [lat, setLat] = useState(String(initial?.lat ?? ''));
  const [lng, setLng] = useState(String(initial?.lng ?? ''));
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 50));
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveOrgStation({
        id: initial?.id, name, msisdn, locationHint, openingHours,
        lat: Number(lat), lng: Number(lng), capacity: Number(capacity), active,
      });
      if (!result.ok) { setError(result.error); return; }
      onDone({
        id: initial?.id ?? crypto.randomUUID(),
        name, msisdn, locationHint, openingHours: openingHours || null,
        lat: Number(lat), lng: Number(lng), capacity: Number(capacity), active,
        managerStaffId: initial?.managerStaffId ?? null,
        memberCount: initial?.memberCount ?? 0,
      });
    });
  }

  return (
    <section className="ppanel porg-station-form">
      <div className="ppanel-head">
        <div>
          <h2>{initial ? `Edit ${initial.name}` : 'Add a station'}</h2>
          <p>
            Where receivers collect, and the places a route is built out of. The
            coordinates put it on the dispatch map.
          </p>
        </div>
      </div>
      <div className="ppanel-body">
        <div className="pgrid">
          {([['Name', name, setName], ['Phone', msisdn, setMsisdn], ['Location', locationHint, setLocationHint], ['Hours', openingHours, setOpeningHours]] as const).map(([label, value, setter]) => (
            <label key={label} className="pfield"><span>{label}</span>
              <input value={value} onChange={(e) => setter(e.target.value)} />
            </label>
          ))}
          <label className="pfield"><span>Latitude</span>
            <input className="mono" value={lat} inputMode="decimal" onChange={(e) => setLat(e.target.value)} />
          </label>
          <label className="pfield"><span>Longitude</span>
            <input className="mono" value={lng} inputMode="decimal" onChange={(e) => setLng(e.target.value)} />
          </label>
          <label className="pfield"><span>Capacity</span>
            <input className="mono" value={capacity} inputMode="numeric" onChange={(e) => setCapacity(e.target.value)} />
          </label>
        </div>

        <label className="pfield-check" style={{ marginTop: 'var(--sp-4)' }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Active — taking parcels. Uncheck to suspend without deleting.</span>
        </label>

        {error && (
          <p role="alert" className="pnote pnote-bad" style={{ marginTop: 'var(--sp-4)' }}>
            <Icon name="alert-circle" size={16} /><span>{error}</span>
          </p>
        )}

        <div className="ptoolbar" style={{ marginTop: 'var(--sp-5)', marginBottom: 0 }}>
          <button className="btn btn-p" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : 'Save station'}
          </button>
          <button className="btn btn-o" disabled={pending} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </section>
  );
}
