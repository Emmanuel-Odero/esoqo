'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionAddOrgStaff, actionSetOrgStaffActive } from '../actions';

interface StaffRow { id: string; name: string; role: string; active: boolean }

const ROLE_LABEL: Record<string, string> = {
  SCANNER: 'Scanner — gate check-in only',
  MANAGER: 'Manager — listings, schedules, bookings',
  ADMIN: 'Admin — everything, including staff',
};

export function OrgStaffPanel({ orgId, staff }: { orgId: string; staff: StaffRow[] }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MANAGER' | 'SCANNER'>('SCANNER');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionAddOrgStaff(orgId, { name, pin, role });
      if (r.ok) {
        setName(''); setPin('');
        announce(`${role === 'ADMIN' ? 'Admin' : role === 'MANAGER' ? 'Manager' : 'Scanner'} added.`, 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function toggle(staffId: string, active: boolean) {
    start(async () => {
      const r = await actionSetOrgStaffActive(orgId, staffId, active);
      if (!r.ok) announce(r.error, 'assertive');
    });
  }

  return (
    <>
      <div className="note n-blue" style={{ marginBottom: 16 }}>
        <div>
          <p>
            <Icon name="info" size={14} /> Staff you add here sign in on their own device with their
            name and this PIN — never their own Esoko account. Hand the PIN over in person or by
            phone, never by SMS or email.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2><Icon name="users" size={18} />Add staff</h2>
        <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
          Ticket seller, gate scanner, or a bus company&rsquo;s manager — a PIN scoped to this
          organiser only. SCANNER can only check tickets in; MANAGER runs listings, schedules and
          bookings; ADMIN also manages staff and settings.
        </p>
        <div className="fld">
          <label className="lab" htmlFor="ts-name">Name</label>
          <input className="inp" id="ts-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="ts-pin">PIN (4–6 digits)</label>
          <input className="inp mono" id="ts-pin" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="ts-role">Role</label>
          <select className="inp" id="ts-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {error && (
          <p className="pill p-bad" style={{ marginTop: 10, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
            <Icon name="alert-circle" size={14} />{error}
          </p>
        )}
        <button className="btn btn-p btn-sm" style={{ marginTop: 12 }} disabled={pending || !name.trim() || !pin.trim()}
          onClick={submit}>
          <Icon name="plus" size={14} />{pending ? 'Adding…' : 'Add staff member'}
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {staff.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="users" size={22} /></span>
            <h3>No staff yet</h3>
          </div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td>{s.role}</td>
                  <td>{s.active ? <span className="pill p-ok">Active</span> : <span className="pill p-bad">Suspended</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-o btn-sm" disabled={pending} onClick={() => toggle(s.id, !s.active)}>
                      <Icon name={s.active ? 'ban' : 'check'} size={14} />{s.active ? 'Suspend' : 'Reinstate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
