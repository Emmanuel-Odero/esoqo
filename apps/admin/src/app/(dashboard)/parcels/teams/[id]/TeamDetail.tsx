'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import {
  actionAddTeamRosterMember, actionUpdateTeamRosterMember, actionRenameCourierTeam,
  actionAddCourierFleet, actionAssignParcelsToFleet, actionCompleteCourierTrip,
  type CourierTeamMemberRow, type CourierFleetRow,
} from '../../actions';
import { RoleField } from '../RoleField';

const VEHICLE_TYPES = ['BODA', 'BICYCLE', 'TUKTUK', 'VAN', 'TRUCK', 'ON_FOOT'];
const FIELD: React.CSSProperties = { display: 'block', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2 };

export function TeamDetail({
  teamId, name, members, fleets, canManage,
}: { teamId: string; name: string; members: CourierTeamMemberRow[]; fleets: CourierFleetRow[]; canManage: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
      {canManage && <TeamNameCard teamId={teamId} name={name} />}

      <section className="card" style={{ padding: 16 }}>
        <strong style={{ display: 'block', marginBottom: 10 }}>Roster</strong>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Phone</th><th>Role</th>{canManage && <th />}</tr></thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.PartyID} teamId={teamId} member={m} canManage={canManage} />
            ))}
            {members.length === 0 && <tr><td colSpan={canManage ? 4 : 3} className="sub">No one on this team yet.</td></tr>}
          </tbody>
        </table>
        {canManage && <AddMemberForm teamId={teamId} />}
      </section>

      <section className="card" style={{ padding: 16 }}>
        <strong style={{ display: 'block', marginBottom: 10 }}>Fleets</strong>
        {fleets.length === 0 && <p className="sub" style={{ margin: '0 0 10px' }}>No fleets yet.</p>}
        {fleets.map((f) => <FleetCard key={f.ID} fleet={f} canManage={canManage} />)}
        {canManage && <AddFleetForm teamId={teamId} />}
      </section>
    </div>
  );
}

function TeamNameCard({ teamId, name }: { teamId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    if (!value.trim()) { setError('Team name is required.'); return; }
    setError(null);
    startTransition(async () => {
      const result = await actionRenameCourierTeam(teamId, value.trim());
      if (!result.ok) { setError(result.error); return; }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{name}</strong>
        <button className="btn btn-o btn-sm" onClick={() => { setValue(name); setEditing(true); }}>Rename team</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input value={value} onChange={(e) => setValue(e.target.value)} style={{ ...FIELD, flex: 1, minWidth: 200 }} />
      <button className="btn btn-p btn-sm" onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      <button className="btn btn-o btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', width: '100%', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}

function MemberRow({ teamId, member, canManage }: { teamId: string; member: CourierTeamMemberRow; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.Name);
  const [msisdn, setMsisdn] = useState(member.Msisdn ?? '');
  const [role, setRole] = useState(member.Role);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const announce = useAnnounce();

  function submit() {
    if (!name.trim() || !msisdn.trim()) { setError('Name and phone number are required.'); return; }
    setError(null);
    startTransition(async () => {
      const result = await actionUpdateTeamRosterMember(teamId, member.PartyID, { name: name.trim(), msisdn: msisdn.trim(), role });
      if (!result.ok) { setError(result.error); return; }
      announce(`${name.trim()}'s details updated — they've been texted`, 'assertive');
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <tr>
        <td>{member.Name}</td>
        <td className="mono sub">{member.Msisdn ?? '—'}</td>
        <td><span className={`pill ${member.Role === 'MANAGER' ? 'p-info' : ''}`}>{member.Role}</span></td>
        {canManage && (
          <td><button className="btn btn-o btn-sm" onClick={() => setEditing(true)}>Edit</button></td>
        )}
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={canManage ? 4 : 3}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', padding: '8px 0' }}>
          <label className="sub">Name
            <input value={name} onChange={(e) => setName(e.target.value)} style={FIELD} />
          </label>
          <label className="sub">Phone
            <input value={msisdn} onChange={(e) => setMsisdn(e.target.value)} style={FIELD} />
          </label>
          <RoleField value={role} onChange={setRole} />
          <button className="btn btn-p btn-sm" onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-o btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          {error && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', width: '100%', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
      </td>
    </tr>
  );
}

function AddMemberForm({ teamId }: { teamId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [msisdn, setMsisdn] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const announce = useAnnounce();

  function submit() {
    if (!name.trim() || !msisdn.trim()) { setError('Name and phone number are required.'); return; }
    setError(null);
    startTransition(async () => {
      const result = await actionAddTeamRosterMember(teamId, { name: name.trim(), msisdn: msisdn.trim(), role });
      if (!result.ok) { setError(result.error); return; }
      announce(`${name.trim()} added to the team`, 'assertive');
      setName(''); setMsisdn(''); setRole('MEMBER'); setOpen(false);
      router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn btn-o btn-sm" onClick={() => setOpen((v) => !v)}>
        {open ? 'Close' : 'Add member'}
      </button>
      {open && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', maxWidth: 620 }}>
          <label className="sub">Name
            <input value={name} onChange={(e) => setName(e.target.value)} style={FIELD} />
          </label>
          <label className="sub">Phone
            <input value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="+2547XXXXXXXX" style={FIELD} />
          </label>
          <RoleField value={role} onChange={setRole} />
          <button className="btn btn-p btn-sm" onClick={submit} disabled={pending}>{pending ? 'Adding…' : 'Add'}</button>
          {error && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', width: '100%', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AddFleetForm({ teamId }: { teamId: string }) {
  const [open, setOpen] = useState(false);
  const [fleetNumber, setFleetNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('BODA');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    if (!fleetNumber.trim()) { setError('A fleet number is required.'); return; }
    setError(null);
    startTransition(async () => {
      const result = await actionAddCourierFleet(teamId, { fleetNumber: fleetNumber.trim(), vehicleType });
      if (!result.ok) { setError(result.error); return; }
      setFleetNumber(''); setOpen(false);
      router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn btn-o btn-sm" onClick={() => setOpen((v) => !v)}>
        {open ? 'Close' : 'Add fleet'}
      </button>
      {open && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="sub">Fleet number
            <input value={fleetNumber} onChange={(e) => setFleetNumber(e.target.value)} placeholder="e.g. FLEET-014" style={FIELD} />
          </label>
          <label className="sub">Vehicle
            <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} style={FIELD}>
              {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <button className="btn btn-p btn-sm" onClick={submit} disabled={pending}>{pending ? 'Adding…' : 'Add'}</button>
          {error && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', width: '100%', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FleetCard({ fleet, canManage }: { fleet: CourierFleetRow; canManage: boolean }) {
  const [assigning, setAssigning] = useState(false);
  const [codes, setCodes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [assignedResult, setAssignedResult] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [completing, startCompleting] = useTransition();
  const router = useRouter();
  const announce = useAnnounce();

  function assign() {
    const list = codes.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (list.length === 0) { setError('Enter at least one parcel code.'); return; }
    setError(null);
    setAssignedResult(null);
    startTransition(async () => {
      const result = await actionAssignParcelsToFleet(fleet.ID, list);
      if (!result.ok) { setError(result.error); return; }
      setAssignedResult(result.assigned);
      setCodes('');
      router.refresh();
    });
  }

  function complete() {
    if (!fleet.OpenTripID) return;
    startCompleting(async () => {
      const result = await actionCompleteCourierTrip(fleet.OpenTripID!);
      if (!result.ok) { setError(result.error); return; }
      announce(`Trip complete for fleet ${fleet.FleetNumber} — team notified`, 'assertive');
      router.refresh();
    });
  }

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong className="mono">{fleet.FleetNumber}</strong>
          <span className="sub" style={{ marginLeft: 8 }}>{fleet.VehicleType.replace(/_/g, ' ')}</span>
        </div>
        <span className="sub">
          {fleet.OpenTripID ? `${fleet.AssignedOpen} parcel${fleet.AssignedOpen === 1 ? '' : 's'} on current trip` : 'No open trip'}
        </span>
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-o btn-sm" onClick={() => setAssigning((v) => !v)}>
            {assigning ? 'Close' : 'Assign parcels'}
          </button>
          {fleet.OpenTripID && (fleet.AssignedOpen > 0) && (
            <button className="btn btn-p btn-sm" onClick={complete} disabled={completing}>
              {completing ? 'Completing…' : 'Mark trip complete'}
            </button>
          )}
        </div>
      )}

      {assigning && (
        <div style={{ marginTop: 10 }}>
          <textarea value={codes} onChange={(e) => setCodes(e.target.value)} rows={3}
            placeholder="PKG-XXXXXX, PKG-YYYYYY — one per line or comma-separated"
            style={{ ...FIELD, width: '100%', fontFamily: 'monospace' }} />
          <button className="btn btn-p btn-sm" style={{ marginTop: 8 }} onClick={assign} disabled={pending}>
            {pending ? 'Assigning…' : 'Assign to this fleet'}
          </button>
        </div>
      )}
      {assignedResult && (
        <p className="sub" style={{ margin: '8px 0 0', color: 'var(--green)' }}>
          Assigned {assignedResult.length} parcel{assignedResult.length === 1 ? '' : 's'}
          {assignedResult.length > 0 && `: ${assignedResult.join(', ')}`}.
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center', margin: '8px 0 0' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}
