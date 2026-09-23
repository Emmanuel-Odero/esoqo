'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  actionAddTeamRosterMember, actionUpdateTeamRosterMember, actionRenameCourierTeam,
  actionAddCourierFleet, actionAssignParcelsToFleet, actionCompleteCourierTrip,
  actionBoardParcelOntoTrip, actionCheckTripDispatched,
  type CourierTeamMemberRow, type CourierFleetRow, type LeftBehindParcelRow,
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
            <input value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="07XX XXX XXX" style={FIELD} />
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

  // Scan-to-board: the codes just assigned are exactly the pile a
  // handler is about to walk out and load — checked off one at a time
  // as each is actually scanned onto the vehicle, plus a manual entry
  // for a code assigned in an earlier batch. boarded is reset whenever
  // a fresh assign lands a new pile to check.
  const [boarded, setBoarded] = useState<Set<string>>(new Set());
  const [boardInput, setBoardInput] = useState('');
  const [boardingCode, setBoardingCode] = useState<string | null>(null);
  const [dispatching, startDispatching] = useTransition();
  const [dispatchResult, setDispatchResult] = useState<{ boardedCount: number; leftBehind: LeftBehindParcelRow[] } | null>(null);

  function assign() {
    const list = codes.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (list.length === 0) { setError('Enter at least one parcel code.'); return; }
    setError(null);
    setAssignedResult(null);
    startTransition(async () => {
      const result = await actionAssignParcelsToFleet(fleet.ID, list);
      if (!result.ok) { setError(result.error); return; }
      setAssignedResult(result.assigned);
      setBoarded(new Set());
      setDispatchResult(null);
      setCodes('');
      router.refresh();
    });
  }

  function board(code: string) {
    if (!fleet.OpenTripID || boarded.has(code)) return;
    setError(null);
    setBoardingCode(code);
    startTransition(async () => {
      const result = await actionBoardParcelOntoTrip(fleet.OpenTripID!, code);
      setBoardingCode(null);
      if (!result.ok) { setError(result.error); return; }
      setBoarded((prev) => new Set(prev).add(code));
      setBoardInput('');
    });
  }

  function checkDispatched() {
    if (!fleet.OpenTripID) return;
    setError(null);
    startDispatching(async () => {
      const result = await actionCheckTripDispatched(fleet.OpenTripID!);
      if (!result.ok) { setError(result.error); return; }
      setDispatchResult({ boardedCount: result.boardedCount, leftBehind: result.leftBehind });
      announce(
        result.leftBehind.length > 0
          ? `${result.leftBehind.length} parcel${result.leftBehind.length === 1 ? '' : 's'} left behind — the manager's been texted`
          : `Fleet ${fleet.FleetNumber} departed clean — team notified`,
        'assertive',
      );
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
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-o btn-sm" onClick={() => setAssigning((v) => !v)}>
            {assigning ? 'Close' : 'Assign parcels'}
          </button>
          {/* The run sheet the driver signs before leaving. Offered
              whenever there is a loaded trip, and next to "assign"
              because printing it is the last step of loading. */}
          {fleet.OpenTripID && (fleet.AssignedOpen > 0) && (
            <Link className="btn btn-o btn-sm" href={`/parcels/trips/${fleet.OpenTripID}/manifest` as Route}>
              <Icon name="print" size={13} />Run sheet
            </Link>
          )}
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
            style={{ ...FIELD, width: '100%', fontFamily: 'var(--font-mono)' }} />
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

      {/* Scan-to-board: check each assigned code off as it's actually
          loaded, then "Done checking" diffs assigned against boarded —
          see dbx.CheckTripDispatched. Only shown once there's something
          assigned to check against. */}
      {canManage && fleet.OpenTripID && assignedResult && assignedResult.length > 0 && !dispatchResult && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <strong style={{ display: 'block', marginBottom: 6, fontSize: '.85rem' }}>
            Board onto the vehicle ({boarded.size}/{assignedResult.length})
          </strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {assignedResult.map((code) => {
              const done = boarded.has(code);
              return (
                <button key={code} type="button" className={`btn btn-sm ${done ? 'btn-p' : 'btn-o'}`}
                  disabled={done || boardingCode === code} onClick={() => board(code)}>
                  {done ? '✓ ' : ''}{code}
                </button>
              );
            })}
          </div>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            <input className="mono" value={boardInput} placeholder="Scan/type a code from an earlier batch"
              onChange={(e) => setBoardInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && boardInput.trim() && board(boardInput.trim())}
              style={{ ...FIELD, flex: 1, marginTop: 0 }} />
            <button className="btn btn-o btn-sm" disabled={!boardInput.trim()} onClick={() => board(boardInput.trim())}>
              Board
            </button>
          </div>
          <button className="btn btn-p btn-sm" onClick={checkDispatched} disabled={dispatching}>
            {dispatching ? 'Checking…' : 'Done checking — dispatch'}
          </button>
        </div>
      )}

      {dispatchResult && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          {dispatchResult.leftBehind.length === 0 ? (
            <p className="sub" style={{ margin: 0, color: 'var(--green)' }}>
              All {dispatchResult.boardedCount} parcel{dispatchResult.boardedCount === 1 ? '' : 's'} boarded and dispatched — team notified.
            </p>
          ) : (
            <>
              <p className="sub" style={{ margin: '0 0 6px', color: 'var(--amber)' }}>
                {dispatchResult.leftBehind.length} left behind — the manager's been texted.
              </p>
              <table className="tbl">
                <thead><tr><th>Code</th><th>Destination</th></tr></thead>
                <tbody>
                  {dispatchResult.leftBehind.map((lb) => (
                    <tr key={lb.code}><td className="mono">{lb.code}</td><td>{lb.destinationLabel}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center', margin: '8px 0 0' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}
