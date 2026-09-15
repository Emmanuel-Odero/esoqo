'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { addCashier } from './actions';

export function CashierForm({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<'CASHIER' | 'MANAGER'>('CASHIER');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button type="button" className="btn btn-p btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />Add cashier
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addCashier(storeId, { name, pin, role });
      if (!result.ok) { setError(result.error); return; }
      setName(''); setPin(''); setRole('CASHIER'); setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="fld" style={{ flex: 2, minWidth: 160, marginBottom: 0 }}>
          <label className="lab" htmlFor="cshname">Name</label>
          <input className="inp" id="cshname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wanjiku" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 100, marginBottom: 0 }}>
          <label className="lab" htmlFor="cshpin">PIN (4–6 digits)</label>
          <input className="inp mono" id="cshpin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
        </div>
        <div className="fld" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
          <label className="lab" htmlFor="cshrole">Role</label>
          <select className="inp" id="cshrole" value={role} onChange={(e) => setRole(e.target.value as 'CASHIER' | 'MANAGER')}>
            <option value="CASHIER">Cashier</option>
            <option value="MANAGER">Manager</option>
          </select>
        </div>
        <button type="button" className="btn btn-p" onClick={submit} disabled={pending || !name.trim() || pin.length < 4}>
          {pending ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className="btn btn-o" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="hint">The cashier uses this PIN to check in at the terminal — it doesn't sign them into the dashboard.</p>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
