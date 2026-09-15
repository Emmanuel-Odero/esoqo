'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { payDownBalance, adjustBalance, editCustomer } from '../actions';

type Tab = 'pay' | 'adjust' | 'edit';

export function CustomerActions({ customerId, balanceKes, name, notes }: {
  customerId: string; balanceKes: number; name: string | null; notes: string | null;
}) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [nameField, setNameField] = useState(name ?? '');
  const [notesField, setNotesField] = useState(notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // One token per intent, held across retries: if a submit failed but
  // the write actually landed (a timeout on a slow till connection),
  // resending the same token dedupes instead of paying twice. Rotated
  // only once an attempt has succeeded — see reset().
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  function reset() {
    setTab(null); setAmount(''); setNote(''); setError(null);
    setRequestId(crypto.randomUUID());
  }

  function submitPay() {
    setError(null);
    startTransition(async () => {
      const result = await payDownBalance(customerId, { amountKes: Number(amount), note, requestId });
      if (!result.ok) { setError(result.error); return; }
      reset(); router.refresh();
    });
  }

  function submitAdjust() {
    setError(null);
    startTransition(async () => {
      const result = await adjustBalance(customerId, { amountKes: Number(amount), note, requestId });
      if (!result.ok) { setError(result.error); return; }
      reset(); router.refresh();
    });
  }

  function submitEdit() {
    setError(null);
    startTransition(async () => {
      const result = await editCustomer(customerId, { name: nameField, notes: notesField });
      if (!result.ok) { setError(result.error); return; }
      reset(); router.refresh();
    });
  }

  if (!tab) {
    return (
      <div className="row">
        {balanceKes > 0 && (
          <button type="button" className="btn btn-p btn-sm" onClick={() => setTab('pay')}>
            <Icon name="coins" size={14} />Record payment
          </button>
        )}
        <button type="button" className="btn btn-o btn-sm" onClick={() => setTab('adjust')}>Adjust balance</button>
        <button type="button" className="btn btn-o btn-sm" onClick={() => setTab('edit')}>Edit details</button>
      </div>
    );
  }

  return (
    <div className="card">
      {tab === 'pay' && (
        <>
          <div className="fld">
            <label className="lab" htmlFor="payamt">Amount received (KES)</label>
            <input className="inp mono" id="payamt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={String(balanceKes)} />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="paynote">Note (optional)</label>
            <input className="inp" id="paynote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Paid in cash at the counter" />
          </div>
          <div className="row">
            <button type="button" className="btn btn-p btn-sm" onClick={submitPay} disabled={pending || !amount}>{pending ? 'Recording…' : 'Record payment'}</button>
            <button type="button" className="btn btn-o btn-sm" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
      {tab === 'adjust' && (
        <>
          <div className="fld">
            <label className="lab" htmlFor="adjamt">Amount (KES) — negative reduces what they owe</label>
            <input className="inp mono" id="adjamt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="-500" />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="adjnote">Reason</label>
            <input className="inp" id="adjnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Wrote off — could not reach them" />
          </div>
          <div className="row">
            <button type="button" className="btn btn-p btn-sm" onClick={submitAdjust} disabled={pending || !amount || !note.trim()}>{pending ? 'Saving…' : 'Adjust balance'}</button>
            <button type="button" className="btn btn-o btn-sm" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
      {tab === 'edit' && (
        <>
          <div className="fld">
            <label className="lab" htmlFor="custname">Name</label>
            <input className="inp" id="custname" value={nameField} onChange={(e) => setNameField(e.target.value)} />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="custnotes">Notes</label>
            <input className="inp" id="custnotes" value={notesField} onChange={(e) => setNotesField(e.target.value)} />
          </div>
          <div className="row">
            <button type="button" className="btn btn-p btn-sm" onClick={submitEdit} disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn btn-o btn-sm" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
      {error && <p className="err" role="alert" style={{ marginTop: 10 }}><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
