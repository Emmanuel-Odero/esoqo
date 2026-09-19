'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { ParcelOrgStationRow } from '@/lib/parcel-org-session';
import { saveOrgStation } from '../actions';

const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6,
};

/**
 * The station register. Each row now opens a station's own page — its
 * location on a map and the team posted to it — rather than only being
 * editable here. Creating and editing a location stays on this screen.
 */
export function StationsManager({ initial }: { initial: ParcelOrgStationRow[] }) {
  const [stations, setStations] = useState(initial);
  const [editing, setEditing] = useState<ParcelOrgStationRow | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>Station</th><th>Phone</th><th>Team</th><th>Capacity</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/parcel-org/stations/${s.id}` as Route} style={{ fontWeight: 700 }}>
                    {s.name}
                  </Link>
                  <span className="sub" style={{ display: 'block' }}>{s.locationHint}</span>
                </td>
                <td className="mono">{s.msisdn}</td>
                <td>
                  {s.memberCount > 0
                    ? `${s.memberCount} member${s.memberCount === 1 ? '' : 's'}`
                    : <span className="sub">Nobody posted</span>}
                </td>
                <td>{s.capacity}</td>
                <td>
                  <span className={`pill ${s.active ? 'p-ok' : 'p-mute'}`}>{s.active ? 'Active' : 'Suspended'}</span>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Link className="btn btn-o btn-sm" href={`/parcel-org/stations/${s.id}` as Route}>
                    Manage
                  </Link>
                  <button className="btn btn-o btn-sm" style={{ marginLeft: 6 }}
                    onClick={() => { setEditing(s); setAdding(false); }}>Edit</button>
                </td>
              </tr>
            ))}
            {stations.length === 0 && (
              <tr><td colSpan={6} className="sub" style={{ textAlign: 'center', padding: 24 }}>No stations yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
        {(adding || editing) ? (
          <StationForm
            initial={editing ?? undefined}
            onDone={(station) => {
              setStations((rows) => (editing ? rows.map((row) => (row.id === station.id ? station : row)) : [...rows, station]));
              setEditing(null); setAdding(false);
            }}
            onCancel={() => { setEditing(null); setAdding(false); }}
          />
        ) : (
          <button className="btn btn-p btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />Add station
          </button>
        )}
      </div>
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
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        {([['Name', name, setName], ['Phone', msisdn, setMsisdn], ['Location', locationHint, setLocationHint], ['Hours', openingHours, setOpeningHours]] as const).map(([label, value, setter]) => (
          <label key={label} className="sub" style={{ flex: 1, minWidth: 180 }}>{label}
            <input style={inputStyle} value={value} onChange={(e) => setter(e.target.value)} />
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 10 }}>
        <label className="sub">Latitude<input style={inputStyle} className="mono" value={lat} inputMode="decimal" onChange={(e) => setLat(e.target.value)} /></label>
        <label className="sub">Longitude<input style={inputStyle} className="mono" value={lng} inputMode="decimal" onChange={(e) => setLng(e.target.value)} /></label>
        <label className="sub">Capacity<input style={inputStyle} className="mono" value={capacity} inputMode="numeric" onChange={(e) => setCapacity(e.target.value)} /></label>
      </div>
      <label className="sub"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-p btn-sm" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save station'}
        </button>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
