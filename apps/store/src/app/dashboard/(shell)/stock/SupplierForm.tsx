'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { addSupplier } from './actions';

export function SupplierForm({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button type="button" className="btn btn-o btn-sm" style={{ width: '100%' }} onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />Add supplier
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addSupplier(storeId, { name, phone, notes });
      if (!result.ok) { setError(result.error); return; }
      setName(''); setPhone(''); setNotes(''); setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="card">
      <div className="fld">
        <label className="lab" htmlFor="supname">Name</label>
        <input className="inp" id="supname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kamau — milk supplier" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="supphone">Phone (optional)</label>
        <input className="inp mono" id="supphone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2547XXXXXXXX" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="supnotes">Notes (optional)</label>
        <input className="inp" id="supnotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivers Tue/Fri mornings" />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={14} />{error}</p>}
      <div className="row" style={{ marginTop: 4 }}>
        <button type="button" className="btn btn-p btn-sm" onClick={submit} disabled={pending || !name.trim()}>
          {pending ? 'Adding…' : 'Add supplier'}
        </button>
        <button type="button" className="btn btn-o btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
