'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { displayKES } from '@esoqo/domain';
import { useAnnounce } from '@esoqo/a11y';
import { actionCreateVoucher, actionLoadVoucher, actionPayBusinessFromVoucher } from './actions';

type Voucher = {
  id: string; label: string; purpose: string; status: string;
  shortCode: string; qrPayload: string; balancePoints: number;
  balanceKes: string;
};

/** GENERAL is the one purpose core-go never restricts spending on (see
 *  SpendVoucher in dbx/voucher.go) — it's the account's own "spend
 *  anywhere, anytime" card. Named "Voucher" here rather than "General",
 *  which read as one option among four with no hint it was different in
 *  kind from the other three, not just in name. */
const PURPOSE_LABEL: Record<string, string> = {
  GENERAL: 'Voucher', FARE: 'Fare only', RENT: 'Rent only', SHOPPING: 'Shopping only',
};
const LOCKED_PURPOSES = ['FARE', 'RENT', 'SHOPPING'];

/**
 * The "cards" in the wallet — the default spend-anywhere Voucher(s)
 * first, then purpose-locked vouchers, then loyalty. Same data and
 * actions the old /me/vouchers page had (real core-go balances, real
 * M-Pesa top-up, and now real voucher-to-voucher transfers); this is
 * the refinement pass, not new plumbing.
 */
export function CardsClient({ initial, loyalty }: {
  initial: Voucher[];
  loyalty: { totalPoints?: number; kesEquiv?: number };
}) {
  const [showNew, setShowNew] = useState(false);
  const sorted = [...initial].sort((a, b) => (a.purpose === 'GENERAL' ? -1 : b.purpose === 'GENERAL' ? 1 : 0));

  return (
    <section className="mcard mcard--premium">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ marginBottom: 6 }}><Icon name="tag" size={18} />Your cards</h2>
          <p className="mcard-lede" style={{ margin: 0 }}>
            Voucher = cash you&apos;ve set aside, spendable anywhere. Locked cards (fare, rent, shopping) only spend on that one thing.
          </p>
        </div>
        <span className="badge b-mute" style={{ flex: 'none' }}>{sorted.length} voucher{sorted.length === 1 ? '' : 's'} · {loyalty.totalPoints ?? 0} pts</span>
      </div>

      <div className="cards-grid">
        <div className="wcard loyalty" aria-label="Loyalty balance">
          <div>
            <span className="wcard-sub">Loyalty · 10% back</span>
            <div className="wcard-label">Every confirmed spend earns</div>
          </div>
          <div>
            <div className="wcard-bal">{loyalty.totalPoints ?? 0} pts</div>
            <div className="wcard-code">≈ KES {loyalty.kesEquiv ?? 0} · use as M-Pesa</div>
          </div>
        </div>

        {sorted.map((v) => <VoucherCard key={v.id} v={v} others={initial.filter((o) => o.id !== v.id)} />)}

        <button type="button" className="wcard wcard-new" onClick={() => setShowNew(true)} aria-label="Create new card">
          <Icon name="plus-circle" size={22} />
          <span style={{ fontWeight: 700, fontSize: '.92rem' }}>{initial.length === 0 ? 'Get your first voucher' : 'New card'}</span>
          <small style={{ fontSize: '.76rem', opacity: .7 }}>{initial.length === 0 ? 'Spend anywhere, anytime' : 'Voucher or locked'}</small>
        </button>
      </div>

      {showNew && <NewVoucherForm hasExisting={initial.length > 0} onDone={() => setShowNew(false)} />}
    </section>
  );
}

// A locked FARE/RENT card is refused server-side for a business payment
// (see SpendVoucher's purpose check in core-go) — only offer the action
// where it can actually succeed, rather than let someone hit "Pay
// business" and learn the refusal after typing an amount.
const PAYABLE_TO_BUSINESS = ['GENERAL', 'SHOPPING'];

function VoucherCard({ v, others }: { v: Voucher; others: Voucher[] }) {
  const [mode, setMode] = useState<'closed' | 'topup' | 'pay'>('closed');
  const isDefault = v.purpose === 'GENERAL';
  const canPayBusiness = PAYABLE_TO_BUSINESS.includes(v.purpose);
  return (
    <div className={`wcard voucher ${isDefault ? 'is-default' : ''}`}>
      <div>
        <span className="wcard-sub">{PURPOSE_LABEL[v.purpose] ?? v.purpose}</span>
        <div className="wcard-label">{v.label}</div>
      </div>
      <div>
        <div className="wcard-bal">KES {displayKES(v.balanceKes)}</div>
        <div className="wcard-code">{v.shortCode} · {v.balancePoints} pts</div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="wcard-topup" onClick={() => setMode((m) => (m === 'topup' ? 'closed' : 'topup'))}>
          {mode === 'topup' ? 'Close' : 'Top up'}
        </button>
        {canPayBusiness && (
          <button type="button" className="wcard-topup" onClick={() => setMode((m) => (m === 'pay' ? 'closed' : 'pay'))}>
            {mode === 'pay' ? 'Close' : 'Pay business'}
          </button>
        )}
      </div>
      {mode === 'topup' && <VoucherTopUp id={v.id} others={others} />}
      {mode === 'pay' && <VoucherPayBusiness id={v.id} />}
    </div>
  );
}

function VoucherPayBusiness({ id }: { id: string }) {
  const [businessId, setBusinessId] = useState('');
  const [amount, setAmount] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const announce = useAnnounce();

  function submit() {
    start(async () => {
      const r = await actionPayBusinessFromVoucher(id, businessId, Number(amount));
      const text = r.ok ? `Paid ${r.businessName}.` : r.error;
      setMsg(text);
      announce(text, r.ok ? 'polite' : 'assertive');
      if (r.ok) { setBusinessId(''); setAmount(''); }
    });
  }

  return (
    <div className="wcard-topup-form" onClick={(e) => e.stopPropagation()}>
      <input className="inp" value={businessId} onChange={(e) => setBusinessId(e.target.value)}
        placeholder="Business's Esoqo ID" style={{ flex: '1 1 100%' }} />
      <input className="inp" value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount KES" inputMode="decimal" />
      <button type="button" className="btn btn-sm" disabled={pending || !amount || !businessId.trim()} onClick={submit}>
        Pay
      </button>
      {msg && <p className="wcard-msg">{msg}</p>}
    </div>
  );
}

function VoucherTopUp({ id, others }: { id: string; others: Voucher[] }) {
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('MPESA_STK');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const announce = useAnnounce();

  function submit() {
    start(async () => {
      const isVoucher = source.startsWith('voucher:');
      const r = await actionLoadVoucher(id, {
        amountKes: Number(amount),
        method: isVoucher ? 'VOUCHER' : source,
        fromVoucherId: isVoucher ? source.slice('voucher:'.length) : undefined,
      });
      const text = r.ok
        ? (isVoucher ? 'Moved.' : source === 'LOYALTY' ? 'Loaded from your loyalty points.' : 'STK sent — enter PIN.')
        : r.error;
      setMsg(text);
      announce(text, r.ok ? 'polite' : 'assertive');
    });
  }

  return (
    <div className="wcard-topup-form" onClick={(e) => e.stopPropagation()}>
      <select className="inp" value={source} onChange={(e) => setSource(e.target.value)} style={{ flex: '1 1 100%' }}>
        <option value="MPESA_STK">From M-Pesa</option>
        <option value="LOYALTY">From loyalty points</option>
        {others.map((o) => (
          <option key={o.id} value={`voucher:${o.id}`}>From {o.label} (KES {displayKES(o.balanceKes)})</option>
        ))}
      </select>
      <input className="inp" value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount KES" inputMode="decimal" />
      <button type="button" className="btn btn-sm" disabled={pending || !amount} onClick={submit}>
        Send
      </button>
      {msg && <p className="wcard-msg">{msg}</p>}
    </div>
  );
}

function NewVoucherForm({ hasExisting, onDone }: { hasExisting: boolean; onDone: () => void }) {
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState('GENERAL');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateVoucher({
        label: label.trim() || (purpose === 'GENERAL' ? 'Voucher' : PURPOSE_LABEL[purpose]),
        purpose, amountKes: Number(amount), recipientMsisdn: recipient, loadMethod: 'MPESA_STK',
      });
      if (r.ok) {
        announce('Created.', 'polite');
        onDone();
      } else {
        setError(r.error);
        announce(r.error, 'assertive');
      }
    });
  }

  return (
    <div className="mcard mcard--action" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: '.95rem' }}>{purpose === 'GENERAL' ? 'New voucher' : 'New purpose-locked card'}</h2>
      <div className="fld"><label className="lab">Kind</label>
        <select className="inp" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          <option value="GENERAL">Voucher — spend anywhere, any time</option>
          {LOCKED_PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
        </select>
      </div>
      <div className="fld"><label className="lab">Label (optional)</label>
        <input className="inp" value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder={purpose === 'GENERAL' ? 'Voucher' : 'School run'} /></div>
      {!hasExisting && purpose === 'GENERAL' && (
        <p className="hint" style={{ margin: '0 0 12px' }}>
          This is the card you&rsquo;ll use most — a balance you can spend on anything, any time.
        </p>
      )}
      <div className="fld"><label className="lab">Load with (KES)</label>
        <input className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="200" inputMode="decimal" /></div>
      <div className="fld"><label className="lab">Gift to (optional phone)</label>
        <input className="inp" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="07XX XXX XXX" /></div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-p btn-sm" disabled={pending || !amount.trim()} onClick={submit}>
          {pending ? 'Creating…' : 'Create'}
        </button>
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
