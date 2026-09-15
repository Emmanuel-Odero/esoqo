'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionAddCashier, actionSetCashierActive } from '../../actions';

interface CashierRow { id: string; name: string; role: string; active: boolean }

export function CashiersPanel({ storeId, cashiers }: { storeId: string; cashiers: CashierRow[] }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<'CASHIER' | 'MANAGER'>('CASHIER');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionAddCashier(storeId, { name, pin, role });
      if (r.ok) {
        setName(''); setPin('');
        announce('Cashier added.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  function toggle(cashierId: string, active: boolean) {
    start(async () => {
      const r = await actionSetCashierActive(storeId, cashierId, active);
      if (!r.ok) announce(r.error, 'assertive');
    });
  }

  return (
    <div className="card" style={{ marginTop: 22 }}>
      <h2><Icon name="users" size={18} />Till staff</h2>
      <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
        Add someone on the owner&rsquo;s behalf while onboarding — a PIN scoped to this store only,
        not their Esoqo account. CASHIER can only ring up sales; MANAGER also handles stock, products
        and orders, never store settings. Hand the PIN over in person or by phone.
      </p>

      <div className="grid2" style={{ gap: 14, marginBottom: 14 }}>
        <div className="fld">
          <label className="lab" htmlFor="cp-name">Name</label>
          <input className="inp" id="cp-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="cp-pin">PIN (4–6 digits)</label>
          <input className="inp mono" id="cp-pin" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
        <div className="fld">
          <label className="lab" htmlFor="cp-role">Role</label>
          <select className="inp" id="cp-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="CASHIER">Cashier — ring up sales only</option>
            <option value="MANAGER">Manager — stock, products, orders</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="pill p-bad" style={{ marginBottom: 12, padding: '10px 13px', whiteSpace: 'normal' }} role="alert">
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}

      <button className="btn btn-p btn-sm" style={{ marginBottom: 18 }} disabled={pending || !name.trim() || !pin.trim()}
        onClick={submit}>
        <Icon name="plus" size={14} />{pending ? 'Adding…' : 'Add cashier'}
      </button>

      {cashiers.length === 0 ? (
        <p className="empty">No till staff yet.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {cashiers.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td>
                <td>{c.role}</td>
                <td>{c.active ? <span className="pill p-ok">Active</span> : <span className="pill p-bad">Suspended</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-o btn-sm" disabled={pending} onClick={() => toggle(c.id, !c.active)}>
                    <Icon name={c.active ? 'ban' : 'check'} size={14} />{c.active ? 'Suspend' : 'Reinstate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
