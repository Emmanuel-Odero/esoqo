'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import type { GoBill } from '@/lib/ticketing';
import { actionCreateBill, actionMarkBillPaid, actionArchiveBill } from './actions';

const CATEGORIES = ['Rent', 'Electricity', 'Water', 'Internet', 'School fees', 'Loan', 'Other'];

export function BillsClient({ initial }: { initial: GoBill[] }) {
  const [showNew, setShowNew] = useState(false);
  const sorted = [...initial].sort((a, b) => a.DaysUntilDue - b.DaysUntilDue);

  return (
    <section className="mcard">
      <h2><Icon name="calendar" size={18} />Bills</h2>
      <p className="mcard-lede">
        Track what you owe and when — Esoqo reminds you, it doesn&rsquo;t pay the biller for you.
      </p>

      {sorted.length === 0 && !showNew && (
        <div className="mempty">
          <span className="ico"><Icon name="calendar" size={22} /></span>
          <p style={{ margin: 0 }}>No bills tracked yet.</p>
        </div>
      )}

      {sorted.length > 0 && (
        <ul className="papers">
          {sorted.map((b) => <BillRow key={b.ID} b={b} />)}
        </ul>
      )}

      {showNew
        ? <NewBillForm onDone={() => setShowNew(false)} />
        : (
          <button type="button" className="btn btn-o" style={{ marginTop: 12 }} onClick={() => setShowNew(true)}>
            <Icon name="plus" size={15} />Add a bill
          </button>
        )}
    </section>
  );
}

function BillRow({ b }: { b: GoBill }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  // Prompted, not guessed: AmountKES is the expected figure, but what
  // actually got paid (a variable electricity bill, a partial payment)
  // can differ, and core-go rejects a zero/missing amount outright.
  const [payingAmount, setPayingAmount] = useState<string | null>(null);
  const announce = useAnnounce();
  const due = new Date(b.NextDueAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
  const status = b.Overdue
    ? { cls: 'b-bad', text: `${-b.DaysUntilDue} ${-b.DaysUntilDue === 1 ? 'day' : 'days'} overdue` }
    : b.DueSoon
      ? { cls: 'b-warn', text: `Due ${due}` }
      : { cls: 'b-mute', text: `Due ${due}` };

  function startMarkPaid() {
    setPayingAmount(b.AmountKES ?? '');
  }

  function confirmMarkPaid() {
    setMsg(null);
    const amount = Number(payingAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setMsg('Enter what you actually paid.'); return; }
    start(async () => {
      const r = await actionMarkBillPaid(b.ID, amount);
      if (!r.ok) { setMsg(r.error); announce(r.error, 'assertive'); }
      else { setPayingAmount(null); announce(`${b.Label} marked paid.`, 'polite'); }
    });
  }

  function remove() {
    setMsg(null);
    start(async () => {
      const r = await actionArchiveBill(b.ID);
      if (!r.ok) { setMsg(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <li className="paper">
      <span className={`ps ${b.Overdue ? 'gap' : b.DueSoon ? 'soon' : 'ok'}`} aria-hidden="true">
        <Icon name={b.Overdue ? 'alert-circle' : 'calendar'} size={16} />
      </span>
      <span className="pt">
        <span className="t">{b.Label}</span>
        <span className="s">
          {b.Category}{b.AmountKES ? ` · KES ${Number(b.AmountKES).toLocaleString('en-KE')}` : ''} · {b.Cycle.toLowerCase()}
          {b.TargetKES && ` · KES ${Number(b.RaisedKES).toLocaleString('en-KE')} of ${Number(b.TargetKES).toLocaleString('en-KE')} raised`}
        </span>
        {payingAmount !== null && (
          <div className="row" style={{ marginTop: 8 }}>
            <input className="inp" style={{ maxWidth: 140 }} value={payingAmount} inputMode="decimal"
              onChange={(e) => setPayingAmount(e.target.value)} placeholder="Amount paid (KES)" autoFocus />
            <button type="button" className="btn btn-p btn-sm" disabled={pending} onClick={confirmMarkPaid}>Confirm</button>
            <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => setPayingAmount(null)}>Cancel</button>
          </div>
        )}
        {msg && <span className="s" style={{ color: 'var(--red)' }}>{msg}</span>}
      </span>
      <span className={`badge ${status.cls}`}>{status.text}</span>
      <div className="row" style={{ marginLeft: 8 }}>
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={startMarkPaid}>Mark paid</button>
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={remove}>Remove</button>
      </div>
    </li>
  );
}

function NewBillForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0] ?? 'Rent');
  const [amount, setAmount] = useState('');
  const [cycle, setCycle] = useState('MONTHLY');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    if (!dueDate) { setError('Pick a due date.'); return; }
    start(async () => {
      const r = await actionCreateBill({
        label,
        category,
        cycle,
        nextDueAt: new Date(dueDate).toISOString(),
        amountKes: amount ? Number(amount) : undefined,
      });
      if (r.ok) { announce('Bill added.', 'polite'); onDone(); }
      else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="mcard" style={{ marginTop: 14, background: 'var(--paper)' }}>
      <h2 style={{ fontSize: '.95rem' }}>New bill</h2>
      <div className="fld"><label className="lab">Name</label>
        <input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Landlord rent" /></div>
      <div className="fld"><label className="lab">Category</label>
        <select className="inp" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select></div>
      <div className="fld"><label className="lab">Amount (KES, optional)</label>
        <input className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="3500" inputMode="decimal" /></div>
      <div className="fld"><label className="lab">Repeats</label>
        <select className="inp" value={cycle} onChange={(e) => setCycle(e.target.value)}>
          <option value="MONTHLY">Monthly</option>
          <option value="WEEKLY">Weekly</option>
          <option value="ONE_TIME">One time</option>
        </select></div>
      <div className="fld"><label className="lab">Next due date</label>
        <input className="inp" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-p btn-sm" disabled={pending || !label.trim() || !dueDate} onClick={submit}>
          {pending ? 'Saving…' : 'Add bill'}
        </button>
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
