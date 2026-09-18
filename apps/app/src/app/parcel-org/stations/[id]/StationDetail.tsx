'use client';

import dynamic from 'next/dynamic';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { ParcelOrgStaffRow, ParcelOrgStationRow } from '@/lib/parcel-org-session';
import { assignStationMember, setStationManager } from '../../actions';

const StationMap = dynamic(() => import('./StationMap').then((m) => m.StationMap), {
  ssr: false,
  loading: () => <div className="card" style={{ height: 300 }} />,
});

/**
 * One station: where it is, who runs it, and who is posted to it.
 *
 * "Members" are the company's own roster (parcel_org_staff) posted to
 * this location via stationId — a station is not a second identity, it
 * is a place the team works from. Naming a manager marks which member is
 * accountable for it; it does not change what that member can do.
 */
export function StationDetail({
  station, members, roster, canManage,
}: {
  station: ParcelOrgStationRow;
  members: ParcelOrgStaffRow[];
  roster: ParcelOrgStaffRow[];
  canManage: boolean;
}) {
  const [managerId, setManagerId] = useState(station.managerStaffId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const memberIds = new Set(members.map((m) => m.id));
  const available = roster.filter((r) => !memberIds.has(r.id));

  function saveManager(value: string) {
    setManagerId(value);
    setError(null); setNotice(null);
    startTransition(async () => {
      const result = await setStationManager(station.id, value || null);
      if (!result.ok) { setError(result.error); return; }
      setNotice(value ? 'Station manager updated.' : 'Station manager cleared.');
    });
  }

  function setMember(staffId: string, assigned: boolean) {
    setError(null); setNotice(null);
    startTransition(async () => {
      const result = await assignStationMember(station.id, staffId, assigned);
      if (!result.ok) setError(result.error);
      else setNotice(assigned ? 'Added to the station.' : 'Removed from the station.');
    });
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>{station.name}</h1>
          <p>
            {station.locationHint}
            {station.openingHours ? ` · ${station.openingHours}` : ''}
          </p>
        </div>
        <div className="actions">
          <span className={`pill ${station.active ? 'p-ok' : 'p-mute'}`}>
            {station.active ? 'Active' : 'Suspended'}
          </span>
          <a className="btn btn-o btn-sm" href={`tel:${station.msisdn}`}>
            <Icon name="phone" size={14} />{station.msisdn}
          </a>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <StationMap lat={station.lat} lng={station.lng} label={station.name} />
      </div>

      {notice && <div className="chain ok" style={{ marginBottom: 14 }}><Icon name="check-circle" size={16} /><span>{notice}</span></div>}
      {error && <div className="chain bad" style={{ marginBottom: 14 }}><Icon name="alert-circle" size={16} /><span>{error}</span></div>}

      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: '1rem' }}>Station manager</h2>
        {canManage ? (
          <>
            <select
              className="mono"
              style={{ padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, minWidth: 260 }}
              value={managerId}
              disabled={pending}
              onChange={(e) => saveManager(e.target.value)}
            >
              <option value="">No manager named</option>
              {roster.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.role})</option>)}
            </select>
            <p className="sub" style={{ margin: '8px 0 0', fontSize: '.8rem' }}>
              The person accountable for this station. Naming a manager doesn’t change their
              permissions — post them below to put them on this station’s team.
            </p>
          </>
        ) : (
          <p className="sub" style={{ margin: 0 }}>
            {members.find((m) => m.id === station.managerStaffId)?.name ?? 'No manager named yet.'}
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 18px 6px' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Team at this station</h2>
          <p className="sub" style={{ margin: '4px 0 0', fontSize: '.82rem' }}>
            {members.length === 0 ? 'Nobody posted here yet.' : `${members.length} member${members.length === 1 ? '' : 's'}.`}
          </p>
        </div>

        {members.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Member</th><th>Role</th><th>Sign-in</th><th /></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      {m.id === station.managerStaffId && <span className="pill p-info" style={{ marginLeft: 8 }}>Manager</span>}
                    </td>
                    <td className="sub">{m.role}</td>
                    <td className="mono sub">{m.esoqoId ?? m.msisdn ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {canManage && (
                        <button className="btn btn-o btn-sm" disabled={pending} onClick={() => setMember(m.id, false)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage && available.length > 0 && (
          <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '.85rem', fontWeight: 700, color: 'var(--tx-2)' }}>
              Add someone from your team
            </h3>
            <div style={{ display: 'grid', gap: 6 }}>
              {available.map((s) => (
                <div key={s.id} className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span>
                    <strong>{s.name}</strong>{' '}
                    <span className="sub">{s.role}{s.active ? '' : ' · suspended'}</span>
                  </span>
                  <button className="btn btn-p btn-sm" disabled={pending} onClick={() => setMember(s.id, true)}>
                    <Icon name="plus" size={13} />Post here
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
