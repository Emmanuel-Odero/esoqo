'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { Icon, ParcelCapabilityPicker, RIDER_BASELINE } from '@esoqo/ui';
import type { ParcelOrgStaffRow } from '@/lib/parcel-org-session';
import { listOrgStations, saveOrgStaff } from '../../actions';
import { RoleField, PARCEL_STAFF_ROLES } from './RoleField';
import type { ParcelOrgStationRow } from '@/lib/parcel-org-session';

const isCustomRole = (role: string) => !PARCEL_STAFF_ROLES.includes(role);

/**
 * The company's own roster of PIN logins.
 *
 * Roles are the three a courier company actually has, and the labels
 * say what each one can do rather than naming the capability bundle —
 * a depot manager issuing a PIN is choosing a job, not a permission set.
 */
const ROLES: [value: string, label: string, hint: string][] = [
  ['RIDER', 'Rider', 'Carries parcels and closes them at the door'],
  ['DISPATCHER', 'Dispatcher', 'Also assigns parcels to riders'],
  ['MANAGER', 'Manager', 'Also manages the team and sees earnings'],
];

export function OrgStaffManager({ staff }: { staff: ParcelOrgStaffRow[] }) {
  const [adding, setAdding] = useState(false);
  const [stations, setStations] = useState<ParcelOrgStationRow[]>([]);
  // Load the station picker once, after mount — firing a state update
  // from render (useState initializer) warned in the console and could
  // re-fire on unrelated re-renders.
  useEffect(() => {
    let cancelled = false;
    void listOrgStations().then((rows) => { if (!cancelled) setStations(rows); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>Name</th><th>Role</th><th>Sign-in ID / phone</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {staff.map((s) => <StaffRow key={s.id} staff={s} stations={stations} />)}
            {staff.length === 0 && (
              <tr>
                <td colSpan={5} className="sub" style={{ textAlign: 'center', padding: 24 }}>
                  Nobody yet. Add your first rider below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
        {adding ? (
            <StaffForm stations={stations} submitLabel="Add to the team" onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
        ) : (
          <button className="btn btn-o btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />Add someone
          </button>
        )}
      </div>
    </div>
  );
}

function StaffRow({ staff, stations }: { staff: ParcelOrgStaffRow; stations: ParcelOrgStationRow[] }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <tr>
        <td colSpan={5} style={{ padding: 16 }}>
          <StaffForm
            initial={staff} stations={stations}
            submitLabel="Save changes"
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </td>
      </tr>
    );
  }
  const role = ROLES.find(([v]) => v === staff.role);
  return (
    <tr>
      <td>
        <strong>{staff.name}</strong>
        {staff.isContact && (
          <span className="pill p-ok" style={{ marginLeft: 8, fontSize: '.68rem' }}>Contact</span>
        )}
      </td>
      <td>
        {role?.[1] ?? staff.role}
        <span className="sub" style={{ display: 'block' }}>{role?.[2]}</span>
      </td>
      <td>
        <span className="mono" style={{ display: 'block' }}>{staff.esoqoId ?? staff.partyId ?? '—'}</span>
        {staff.msisdn && <span className="mono sub" style={{ display: 'block' }}>{staff.msisdn}</span>}
      </td>
      <td>
        <span className={`pill ${staff.active ? 'p-ok' : 'p-warn'}`}>
          {staff.active ? 'Can sign in' : 'Suspended'}
        </span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <button className="btn btn-o btn-sm" onClick={() => setEditing(true)}>Edit</button>
      </td>
    </tr>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: '100%',
};

function StaffForm({
  initial, stations, submitLabel, onDone, onCancel,
}: {
  initial?: ParcelOrgStaffRow; stations: ParcelOrgStationRow[]; submitLabel: string; onDone: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? 'RIDER');
  const [capabilities, setCapabilities] = useState<string[]>(initial?.capabilities ?? []);
  const [pin, setPin] = useState('');
  const [msisdn, setMsisdn] = useState(initial?.msisdn ?? '');
  const [partyId, setPartyId] = useState(initial?.partyId ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [isContact, setIsContact] = useState(initial?.isContact ?? false);
  const [stationId, setStationId] = useState(initial?.stationId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { name: useId(), role: useId(), pin: useId(), msisdn: useId(), party: useId(), active: useId(), contact: useId() };

  function pickRole(next: string) {
    setRole(next);
    // A fresh custom role starts from the RIDER floor rather than
    // nothing, so a manager can only add access on top of the safe
    // default, never accidentally hand out less.
    if (isCustomRole(next)) setCapabilities((c) => (c.length ? c : [...RIDER_BASELINE]));
  }

  function save() {
    setError(null);
    if (isCustomRole(role) && !role.trim()) {
      setError('Type the custom role name');
      return;
    }
    if (!initial && pin.length < 4) {
      setError('Set a PIN of at least 4 digits');
      return;
    }
    startTransition(async () => {
      const result = await saveOrgStaff({
        id: initial?.id, name: name.trim(), role, pin, msisdn: msisdn.trim() || null,
        partyId: partyId.trim() || null, active, isContact, stationId: stationId || null,
        // Preset -> [] clears any stale custom set; custom -> the picked
        // permissions. See saveOrgStaff's own comment.
        capabilities: isCustomRole(role) ? capabilities : [],
      });
      if (result.ok) onDone();
      else setError(result.error);
    });
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div>
          <label className="sub" htmlFor={ids.name} style={{ display: 'block', marginBottom: 4 }}>Name</label>
          <input id={ids.name} style={inputStyle} value={name} placeholder="e.g. Wanjiku"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <RoleField value={role} onChange={pickRole} />
          <span className="sub" style={{ fontSize: '.78rem' }}>
            {ROLES.find(([v]) => v === role)?.[2] ?? 'Custom role — pick its permissions below.'}
          </span>
        </div>
        <div>
          <label className="sub" htmlFor={ids.pin} style={{ display: 'block', marginBottom: 4 }}>
            {initial ? 'New PIN (leave blank to keep)' : 'PIN'}
          </label>
          <input id={ids.pin} className="mono" style={inputStyle} type="password" inputMode="numeric"
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.msisdn} style={{ display: 'block', marginBottom: 4 }}>
            Phone (optional)
          </label>
          <input id={ids.msisdn} className="mono" style={inputStyle} placeholder="+2547..."
            value={msisdn} onChange={(e) => setMsisdn(e.target.value)} />
          <span className="sub" style={{ fontSize: '.78rem' }}>
            Give one and they get an Esoqo account they can sign in with at /signin, not just here.
          </span>
        </div>
      </div>

      {isCustomRole(role) && (
        <ParcelCapabilityPicker value={capabilities} onChange={setCapabilities} disabled={pending} />
      )}

      <div>
        <label className="sub" htmlFor={ids.party} style={{ display: 'block', marginBottom: 4 }}>
          Esoqo party id (riders only)
        </label>
        <input id={ids.party} className="mono" style={inputStyle} value={partyId}
          placeholder="Needed to take custody of a parcel"
          onChange={(e) => setPartyId(e.target.value)} />
        {/* Custody is always attributed to a real person, never to a
            login row — a handoff chain pointing at "staff row 7" would
            be worthless in a dispute. Office roles don't need one. */}
        <span className="sub" style={{ fontSize: '.78rem' }}>
          A rider needs this to scan parcels into their own hands. Dispatchers and managers don’t.
        </span>
      </div>

      <div>
        <label className="sub" htmlFor={ids.active} style={{ display: 'block', marginBottom: 4 }}>Assigned station</label>
        <select style={inputStyle} value={stationId} onChange={(e) => setStationId(e.target.value)}>
          <option value="">All company operations</option>
          {stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
        </select>
      </div>

      <label className="sub" htmlFor={ids.active} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input id={ids.active} type="checkbox" checked={active}
          onChange={(e) => setActive(e.target.checked)} />
        Can sign in
      </label>

      <label className="sub" htmlFor={ids.contact} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input id={ids.contact} type="checkbox" checked={isContact}
          onChange={(e) => setIsContact(e.target.checked)} />
        Contact person
        <span style={{ fontSize: '.78rem', color: 'var(--muted, inherit)' }}>
          — shown to senders as someone who can be reached
        </span>
      </label>

      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-p btn-sm" disabled={pending || !name.trim()} onClick={save}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
