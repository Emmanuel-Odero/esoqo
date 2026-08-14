'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { actionCreateStaff, actionSetStaffActive } from './actions';

interface StaffRow { id: string; name: string; role: string; active: boolean }

export function StaffForm({ orgId, staff }: { orgId: string; staff: StaffRow[] }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MANAGER' | 'SCANNER'>('SCANNER');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateStaff(orgId, { name, pin, role });
      if (r.ok) {
        setName(''); setPin('');
        announce('Staff member added.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function toggle(staffId: string, active: boolean) {
    start(async () => {
      const r = await actionSetStaffActive(orgId, staffId, active);
      if (!r.ok) announce(r.error, 'assertive');
    });
  }

  return (
    <>
      <div className="mcard" style={{ marginBottom: 16 }}>
        <h2><Icon name="users" size={18} />Add staff</h2>
        <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
          A PIN scoped to this organiser only — not their Esoko account PIN. SCANNER can only check
          tickets in; MANAGER runs listings and bookings; ADMIN also manages staff and settings.
        </p>
        <div className="fld">
          <label className="lab" htmlFor="st-name">Name</label>
          <input className="inp" id="st-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="st-pin">PIN (4–6 digits)</label>
          <input className="inp mono" id="st-pin" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="st-role">Role</label>
          <select className="inp" id="st-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="SCANNER">Scanner — gate check-in only</option>
            <option value="MANAGER">Manager — listings, schedules, bookings</option>
            <option value="ADMIN">Admin — everything, including staff</option>
          </select>
        </div>
        {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
        <button type="button" className="btn btn-p" disabled={pending || !name.trim() || !pin.trim()} onClick={submit}>
          {pending ? 'Adding…' : 'Add staff member'}
        </button>
      </div>

      <div className="mcard">
        <h2><Icon name="users" size={18} />Staff</h2>
        {staff.length === 0 ? <p style={{ margin: 0, color: 'var(--tx-2)' }}>None yet.</p> : (
          staff.map((s) => (
            <div className="mrow" key={s.id}>
              <span className="k">{s.name}</span>
              <span className="v">
                {s.role.toLowerCase()} · {s.active ? 'active' : 'suspended'}
                {' — '}
                <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => toggle(s.id, !s.active)}>
                  {s.active ? 'Suspend' : 'Reactivate'}
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
