'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { displayKES } from '@esoqo/domain';
import { useAnnounce } from '@esoqo/a11y';
import { actionCreateVoucher, actionLoadVoucher } from './actions';

type Voucher = {
  id: string; label: string; purpose: string; status: string;
  shortCode: string; qrPayload: string; balancePoints: number;
  balanceKes: string;
};

const PURPOSE_LABEL: Record<string, string> = {
  FARE: 'Fare', RENT: 'Rent', SHOPPING: 'Shopping', GENERAL: 'General',
};

/**
 * The "cards" in the wallet — purpose-locked vouchers and the loyalty
 * balance, each its own tile rather than a plain list row. Same data
 * and actions the old /me/vouchers page had (real core-go balances,
 * real M-Pesa top-up); this is the refinement pass, not new plumbing.
 */
export function CardsClient({ initial, loyalty }: {
  initial: Voucher[];
  loyalty: { totalPoints?: number; kesEquiv?: number };
}) {
  const [showNew, setShowNew] = useState(false);

  return (
    <section className="mcard">
      <h2><Icon name="tag" size={18} />Your cards</h2>
      <p className="mcard-lede">Loyalty points and purpose-locked vouchers — kept separate from cash on purpose.</p>

      <div className="cards-grid">
        <div className="wcard loyalty">
          <div>
            <span className="wcard-sub">Loyalty</span>
            <div className="wcard-label">10% back on every confirmed spend</div>
          </div>
          <div>
            <div className="wcard-bal">{loyalty.totalPoints ?? 0} pts</div>
            <div className="wcard-code">≈ KES {loyalty.kesEquiv ?? 0}</div>
          </div>
        </div>

        {initial.map((v) => <VoucherCard key={v.id} v={v} />)}

        <button type="button" className="wcard wcard-new" onClick={() => setShowNew(true)}>
          <Icon name="plus-circle" size={22} />
          <span>New voucher</span>
        </button>
      </div>

      {showNew && <NewVoucherForm onDone={() => setShowNew(false)} />}
    </section>
  );
}

function VoucherCard({ v }: { v: Voucher }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wcard voucher">
      <div>
        <span className="wcard-sub">{PURPOSE_LABEL[v.purpose] ?? v.purpose}</span>
        <div className="wcard-label">{v.label}</div>
      </div>
      <div>
        <div className="wcard-bal">KES {displayKES(v.balanceKes)}</div>
        <div className="wcard-code">{v.shortCode} · {v.balancePoints} pts</div>
      </div>
      <button type="button" className="wcard-topup" onClick={() => setOpen((o) => !o)}>
        {open ? 'Close' : 'Top up'}
      </button>
      {open && <VoucherTopUp id={v.id} />}
    </div>
  );
}

function VoucherTopUp({ id }: { id: string }) {
  const [amount, setAmount] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const announce = useAnnounce();
  return (
    <div className="wcard-topup-form" onClick={(e) => e.stopPropagation()}>
      <input className="inp" value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount KES" inputMode="decimal" />
      <button type="button" className="btn btn-sm" disabled={pending || !amount} onClick={() => start(async () => {
        const r = await actionLoadVoucher(id, { amountKes: Number(amount), method: 'MPESA_STK' });
        const text = r.ok ? 'STK sent — enter PIN.' : r.error;
        setMsg(text);
        announce(text, r.ok ? 'polite' : 'assertive');
      })}>
        Send
      </button>
      {msg && <p className="wcard-msg">{msg}</p>}
    </div>
  );
}

function NewVoucherForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState('FARE');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateVoucher({
        label, purpose, amountKes: Number(amount), recipientMsisdn: recipient, loadMethod: 'MPESA_STK',
      });
      if (r.ok) {
        announce('Voucher created.', 'polite');
        onDone();
      } else {
        setError(r.error);
        announce(r.error, 'assertive');
      }
    });
  }

  return (
    <div className="mcard" style={{ marginTop: 14, background: 'var(--paper)' }}>
      <h2 style={{ fontSize: '.95rem' }}>New voucher</h2>
      <div className="fld"><label className="lab">Label</label>
        <input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="School run" /></div>
      <div className="fld"><label className="lab">Purpose (locked once created)</label>
        <select className="inp" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          <option>FARE</option><option>RENT</option><option>SHOPPING</option><option>GENERAL</option>
        </select></div>
      <div className="fld"><label className="lab">Load with (KES)</label>
        <input className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="200" inputMode="decimal" /></div>
      <div className="fld"><label className="lab">Gift to (optional phone)</label>
        <input className="inp" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="07XX XXX XXX" /></div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-p btn-sm" disabled={pending || !label.trim() || !amount.trim()} onClick={submit}>
          {pending ? 'Creating…' : 'Create voucher'}
        </button>
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
