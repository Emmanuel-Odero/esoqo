'use client';
import { displayKES } from '@esoqo/domain';
import { useState, useTransition } from 'react';
import { actionCreateVoucher, actionLoadVoucher } from './actions';

type Voucher = {
  id: string; label: string; purpose: string; status: string;
  shortCode: string; qrPayload: string; balancePoints: number;
  // Decimal string from core-go — see @esoqo/domain's money module.
  balanceKes: string;
};

export function VoucherClient({ initial }: { initial: Voucher[] }) {
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState('FARE');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [method, setMethod] = useState('MPESA_STK');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function create() {
    setMsg(null);
    start(async () => {
      const r = await actionCreateVoucher({ label, purpose, amountKes: Number(amount), recipientMsisdn: recipient, loadMethod: method });
      setMsg(r.ok ? `Created ${(r.data as { shortCode?: string })?.shortCode ?? ''} — complete M-Pesa if asked.` : r.error);
    });
  }

  return (
    <>
      <div className="mcard">
        <h2>New voucher</h2>
        <div className="fld"><label className="lab">Label</label>
          <input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="School run" /></div>
        <div className="fld"><label className="lab">Purpose (locked)</label>
          <select className="inp" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option>FARE</option><option>RENT</option><option>SHOPPING</option><option>GENERAL</option>
          </select></div>
        <div className="fld"><label className="lab">Amount KES</label>
          <input className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="200" /></div>
        <div className="fld"><label className="lab">Gift to (optional phone)</label>
          <input className="inp" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="07XX XXX XXX" /></div>
        <div className="fld"><label className="lab">Load with</label>
          <select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="MPESA_STK">M-Pesa</option><option value="LOYALTY">Loyalty points</option>
          </select></div>
        <button className="btn btn-p btn-block" disabled={pending} onClick={create}>{pending ? 'Creating…' : 'Create voucher'}</button>
        {msg && <div className="note" style={{ marginTop: 12 }}><div><p>{msg}</p></div></div>}
      </div>
      <div className="mcard">
        <h2>My cards</h2>
        {initial.length === 0 && <p>No vouchers yet.</p>}
        {initial.map((v) => (
          <div key={v.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
            <strong>{v.label} · {v.purpose}</strong>
            <p className="mono">{v.shortCode} · {v.balancePoints} pts ≈ KES {displayKES(v.balanceKes)} · {v.status}</p>
            <TopUp id={v.id} />
          </div>
        ))}
      </div>
    </>
  );
}

function TopUp({ id }: { id: string }) {
  const [amount, setAmount] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Top up KES" style={{ flex: 1 }} />
      <button className="btn" disabled={pending || !amount} onClick={() => start(async () => {
        const r = await actionLoadVoucher(id, { amountKes: Number(amount), method: 'MPESA_STK' });
        setMsg(r.ok ? 'STK sent — enter PIN.' : r.error);
      })}>Top up</button>
      {msg && <span>{msg}</span>}
    </div>
  );
}
