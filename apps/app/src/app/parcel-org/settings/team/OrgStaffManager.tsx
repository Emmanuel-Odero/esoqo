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
// Every role core-go grants capabilities for (see authsvc's
// ParcelStaffCapabilities). The station roles were missing here, so a
// roster showed raw enum values — "COLLECTION_CLERK" — to a manager
// who never chose that spelling.
const ROLES: [value: string, label: string, hint: string][] = [
  ['RIDER', 'Rider', 'Carries parcels and closes them at the door'],
  ['DISPATCHER', 'Dispatcher', 'Also assigns parcels to riders'],
  ['MANAGER', 'Manager', 'Also manages the team and sees earnings'],
  ['STATION_MANAGER', 'Station manager', 'Runs one station, its team and its parcels'],
  ['INTAKE_CLERK', 'Intake clerk', 'Receives parcels over the counter'],
  ['ARRIVAL_CLERK', 'Arrival clerk', 'Checks runs in when they land'],
  ['COLLECTION_CLERK', 'Collection clerk', 'Hands parcels to the people collecting them'],
];

/** A role with no entry above — a custom title a company invented.
 *  Rendered as typed rather than as the stored SCREAMING_CASE. */
function roleLabel(role: string): string {
  const known = ROLES.find(([v]) => v === role);
  if (known) return known[1];
  const words = role.replace(/_/g, ' ').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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
    <div className="porg-team">
      {adding ? (
        <StaffForm stations={stations} submitLabel="Add to the team" onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
      ) : (
        <div className="ptoolbar">
          <button className="btn btn-p" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />Add someone
          </button>
        </div>
      )}

      {staff.length === 0 && !adding ? (
        <div className="ppanel">
          <div className="pempty">
            <span className="pempty-icon"><Icon name="users" size={20} /></span>
            <strong>Nobody on the team yet</strong>
            <p>
              Each person signs in with their own name and PIN — never a shared
              login. Add your first rider above.
            </p>
          </div>
        </div>
      ) : (
        <ul className="plist">
          {staff.map((s) => <StaffRow key={s.id} staff={s} stations={stations} />)}
        </ul>
      )}
    </div>
  );
}

function StaffRow({ staff, stations }: { staff: ParcelOrgStaffRow; stations: ParcelOrgStationRow[] }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="is-editing">
        <StaffForm
          initial={staff} stations={stations}
          submitLabel="Save changes"
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  const hint = ROLES.find(([v]) => v === staff.role)?.[2];
  return (
    <li>
      <div className="plist-main">
        <span className="plist-title">
          {staff.name}
          <span className={`pill ${staff.active ? 'p-ok' : 'p-warn'}`}>
            {staff.active ? 'Can sign in' : 'Suspended'}
          </span>
          {staff.isContact && <span className="pill p-info">Contact</span>}
        </span>
        <span className="plist-sub">
          <strong>{roleLabel(staff.role)}</strong>
          {hint && <> — {hint}</>}
        </span>
        {/* The phone is what a manager recognises someone by. The raw
            party UUID is a database key and was being printed in full
            whenever an Esoqo handle didn't exist — noise that pushed
            the useful line off a phone screen. */}
        <span className="plist-sub mono">
          {staff.msisdn ?? 'No phone on file'}
          {staff.esoqoId && <> · {staff.esoqoId}</>}
        </span>
      </div>
      <div className="plist-actions">
        <button className="btn btn-o btn-sm" onClick={() => setEditing(true)}>Edit</button>
      </div>
    </li>
  );
}


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
    <div className="porg-staff-form">
      <div className="pgrid">
        <div className="pfield">
          <label htmlFor={ids.name}>Name</label>
          <input id={ids.name} value={name} placeholder="e.g. Wanjiku"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="pfield">
          <RoleField value={role} onChange={pickRole} />
          <span className="phint">
            {ROLES.find(([v]) => v === role)?.[2] ?? 'Custom role — pick its permissions below.'}
          </span>
        </div>
        <div className="pfield">
          <label htmlFor={ids.pin}>
            {initial ? 'New PIN (leave blank to keep)' : 'PIN'}
          </label>
          <input id={ids.pin} className="mono" type="password" inputMode="numeric"
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="pfield">
          <label htmlFor={ids.msisdn}>
            Phone (optional)
          </label>
          <input id={ids.msisdn} className="mono" placeholder="07XX XXX XXX"
            value={msisdn} onChange={(e) => setMsisdn(e.target.value)} />
          <span className="phint">
            Give one and they get an Esoqo account they can sign in with at /signin, not just here.
          </span>
        </div>
      </div>

      {isCustomRole(role) && (
        <ParcelCapabilityPicker value={capabilities} onChange={setCapabilities} disabled={pending} />
      )}

      <div className="pfield">
        <label htmlFor={ids.party}>
          Esoqo party id (riders only)
        </label>
        <input id={ids.party} className="mono" value={partyId}
          placeholder="Needed to take custody of a parcel"
          onChange={(e) => setPartyId(e.target.value)} />
        {/* Custody is always attributed to a real person, never to a
            login row — a handoff chain pointing at "staff row 7" would
            be worthless in a dispute. Office roles don't need one. */}
        <span className="phint">
          A rider needs this to scan parcels into their own hands. Dispatchers and managers don’t.
        </span>
      </div>

      <div className="pfield">
        <label htmlFor={ids.active}>Assigned station</label>
        <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
          <option value="">All company operations</option>
          {stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
        </select>
      </div>

      <label className="pfield-check" htmlFor={ids.active}>
        <input id={ids.active} type="checkbox" checked={active}
          onChange={(e) => setActive(e.target.checked)} />
        <span>Can sign in</span>
      </label>

      <label className="pfield-check" htmlFor={ids.contact}>
        <input id={ids.contact} type="checkbox" checked={isContact}
          onChange={(e) => setIsContact(e.target.checked)} />
        <span>
          Contact person
          <span className="phint"> — shown to senders as someone who can be reached</span>
        </span>
      </label>

      {error && (
        <p role="alert" className="pnote pnote-bad">
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}

      <div className="ptoolbar" style={{ marginBottom: 0 }}>
        <button className="btn btn-p" disabled={pending || !name.trim()} onClick={save}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        <button className="btn btn-o" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
