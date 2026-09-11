'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import {
  actionCreateParcelZone, actionUpdateParcelZone, actionSetDistanceRate,
  type ParcelZone, type ParcelDistanceRate,
} from '../actions';

export function ZonesEditor({
  zones, distanceRate, canEdit,
}: { zones: ParcelZone[]; distanceRate: ParcelDistanceRate | null; canEdit: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DistanceRatePanel rate={distanceRate} canEdit={canEdit} />
      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr><th>Name</th><th>Lat</th><th>Lng</th><th>Active</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {zones.map((z) => <ZoneRow key={z.id} zone={z} canEdit={canEdit} />)}
            {zones.length === 0 && (
              <tr><td colSpan={canEdit ? 5 : 4} className="sub" style={{ textAlign: 'center', padding: 24 }}>No zones yet.</td></tr>
            )}
          </tbody>
        </table>
        {canEdit && (
          <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
            <NewZoneForm />
          </div>
        )}
      </div>
    </div>
  );
}

function DistanceRatePanel({ rate, canEdit }: { rate: ParcelDistanceRate | null; canEdit: boolean }) {
  const [perKmKes, setPerKmKes] = useState(rate ? String(rate.perKmKes) : '');
  const [minChargeableKm, setMinChargeableKm] = useState(rate ? String(rate.minChargeableKm) : '1');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await actionSetDistanceRate(Number(perKmKes), Number(minChargeableKm));
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="card" style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label className="sub">Rate per km (KES)
        <input className="mono" disabled={!canEdit} value={perKmKes} onChange={(e) => setPerKmKes(e.target.value)}
          style={{ display: 'block', width: 110, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
      </label>
      <label className="sub">Minimum chargeable km
        <input className="mono" disabled={!canEdit} value={minChargeableKm} onChange={(e) => setMinChargeableKm(e.target.value)}
          style={{ display: 'block', width: 110, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
      </label>
      {canEdit && (
        <button className="btn btn-o btn-sm" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save rate'}</button>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}

function ZoneRow({ zone, canEdit }: { zone: ParcelZone; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(zone.name);
  const [lat, setLat] = useState(String(zone.lat));
  const [lng, setLng] = useState(String(zone.lng));
  const [active, setActive] = useState(zone.active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await actionUpdateParcelZone(zone.id, name, Number(lat), Number(lng), active);
      if (!result.ok) setError(result.error);
      else setEditing(false);
    });
  }

  if (!editing) {
    return (
      <tr>
        <td>{zone.name}</td>
        <td className="mono sub">{zone.lat}</td>
        <td className="mono sub">{zone.lng}</td>
        <td><span className={`pill ${zone.active ? 'p-ok' : 'p-bad'}`}>{zone.active ? 'Active' : 'Inactive'}</span></td>
        {canEdit && <td><button className="btn btn-o btn-sm" onClick={() => setEditing(true)}>Edit</button></td>}
      </tr>
    );
  }

  return (
    <tr>
      <td><input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '4px 6px', border: '1.5px solid var(--line)', borderRadius: 6 }} /></td>
      <td><input className="mono" value={lat} onChange={(e) => setLat(e.target.value)} style={{ width: 90, padding: '4px 6px', border: '1.5px solid var(--line)', borderRadius: 6 }} /></td>
      <td><input className="mono" value={lng} onChange={(e) => setLng(e.target.value)} style={{ width: 90, padding: '4px 6px', border: '1.5px solid var(--line)', borderRadius: 6 }} /></td>
      <td>
        <label className="sub"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      </td>
      <td style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-p btn-sm" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-o btn-sm" onClick={() => setEditing(false)}>Cancel</button>
        {error && <span style={{ color: 'var(--red)', fontSize: '.8rem' }}>{error}</span>}
      </td>
    </tr>
  );
}

function NewZoneForm() {
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim() || !lat || !lng) {
      setError('Name, latitude and longitude are all required');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await actionCreateParcelZone(name.trim(), Number(lat), Number(lng));
      if (!result.ok) setError(result.error);
      else { setName(''); setLat(''); setLng(''); }
    });
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label className="sub">Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Westlands"
          style={{ display: 'block', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
      </label>
      <label className="sub">Lat
        <input className="mono" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-1.2637"
          style={{ display: 'block', width: 100, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
      </label>
      <label className="sub">Lng
        <input className="mono" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="36.8027"
          style={{ display: 'block', width: 100, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
      </label>
      <button className="btn btn-p btn-sm" disabled={pending} onClick={submit}>{pending ? 'Adding…' : 'Add zone'}</button>
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}
