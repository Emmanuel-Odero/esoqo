'use client';

import { displayKES, formatKES, subCents, toCentsOrZero, toWire } from '@esoqo/domain';
import { useId, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import {
  actionRemitCod, actionSetCodPolicy, actionSettleSellerCod,
  type CodPolicy, type SellerOwedCod,
} from '../actions';

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: '100%',
};

export function CodConsole({
  policy, sellers, canEdit, canHandleMoney,
}: {
  policy: CodPolicy; sellers: SellerOwedCod[];
  canEdit: boolean; canHandleMoney: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: 22 }}>
      {canHandleMoney && <RemitPanel />}
      <SellersPanel sellers={sellers} canHandleMoney={canHandleMoney} />
      <PolicyPanel policy={policy} canEdit={canEdit} />
    </div>
  );
}

/**
 * Counting a rider in.
 *
 * The counted amount is typed, never defaulted to what's expected — the
 * whole point of this record is that the notes on the table and the
 * system's expectation can disagree, and pre-filling the expected
 * figure is how somebody confirms a number they never actually counted.
 */
function RemitPanel() {
  const [riderPartyId, setRiderPartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ expectedKes: string; shortfallKes: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { rider: useId(), amount: useId(), note: useId() };

  function submit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await actionRemitCod(riderPartyId.trim(), Number(amount), note.trim());
      if (!res.ok) { setError(res.error); return; }
      setResult({ expectedKes: res.expectedKes, shortfallKes: res.shortfallKes });
      setRiderPartyId(''); setAmount(''); setNote('');
    });
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>Count a rider&apos;s cash in</h3>
      <p className="sub" style={{ margin: '0 0 16px', fontSize: '.85rem' }}>
        This closes out every parcel that rider is holding money for, and moves the cash onto
        Esoqo&apos;s books.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div>
          <label className="sub" htmlFor={ids.rider} style={{ display: 'block', marginBottom: 4 }}>
            Rider&apos;s Esoqo party id
          </label>
          <input id={ids.rider} className="mono" style={inputStyle} value={riderPartyId}
            onChange={(e) => setRiderPartyId(e.target.value)} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.amount} style={{ display: 'block', marginBottom: 4 }}>
            Amount counted (KES)
          </label>
          <input id={ids.amount} className="mono" style={inputStyle} value={amount}
            placeholder="What you actually counted"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.note} style={{ display: 'block', marginBottom: 4 }}>
            Note (optional)
          </label>
          <input id={ids.note} style={inputStyle} value={note}
            onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn btn-p btn-sm"
          disabled={pending || !riderPartyId.trim() || !amount}
          onClick={submit}>
          {pending ? 'Recording…' : 'Record hand-over'}
        </button>
      </div>

      {result && (
        <div className="chain" style={{
          marginTop: 14,
          background: toCentsOrZero(result.shortfallKes) > 0 ? 'var(--amber-t)' : 'var(--green-t, rgba(0,128,0,.08))',
          border: `1px solid ${toCentsOrZero(result.shortfallKes) > 0 ? '#E8D2A0' : '#B7D9BC'}`,
          color: toCentsOrZero(result.shortfallKes) > 0 ? 'var(--amber)' : 'var(--green, #1a7f37)',
        }}>
          <Icon name={toCentsOrZero(result.shortfallKes) > 0 ? 'alert-triangle' : 'check-circle'} size={18} />
          <span>
            Expected KES {displayKES(result.expectedKes)}.
            {toCentsOrZero(result.shortfallKes) > 0
              ? ` That's KES ${displayKES(result.shortfallKes)} short — the record keeps both figures.`
              : ' Counted in full.'}
          </span>
        </div>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center', marginTop: 12 }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}

function SellersPanel({
  sellers, canHandleMoney,
}: { sellers: SellerOwedCod[]; canHandleMoney: boolean }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '16px 16px 0' }}>
        <h3 style={{ margin: 0 }}>Sellers waiting to be paid</h3>
        <p className="sub" style={{ margin: '4px 0 12px', fontSize: '.85rem' }}>
          Only money a rider has actually handed in can be paid out — the rest is still in
          somebody&apos;s pocket.
        </p>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Seller</th><th>Parcels</th>
              <th className="num">Owed</th><th className="num">Ready now</th>
              {canHandleMoney && <th />}
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => <SellerRow key={s.senderPartyId} seller={s} canHandleMoney={canHandleMoney} />)}
            {sellers.length === 0 && (
              <tr>
                <td colSpan={canHandleMoney ? 5 : 4} className="sub" style={{ textAlign: 'center', padding: 24 }}>
                  Nobody is owed anything right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SellerRow({ seller, canHandleMoney }: { seller: SellerOwedCod; canHandleMoney: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Exact cents, so the comparison below needs no epsilon: the old
  // `inPocket > 0.004` was a float-drift workaround.
  const inPocket = subCents(toCentsOrZero(seller.goodsKes), toCentsOrZero(seller.readyKes));

  function settle() {
    setError(null);
    startTransition(async () => {
      const res = await actionSettleSellerCod(seller.senderPartyId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <tr>
      <td>
        <strong>{seller.senderName}</strong>
        <span className="sub mono" style={{ display: 'block' }}>{seller.senderMsisdn}</span>
      </td>
      <td>{seller.parcelCount}</td>
      <td className="num mono">KES {displayKES(seller.goodsKes)}</td>
      <td className="num mono">
        KES {displayKES(seller.readyKes)}
        {inPocket > 0 && (
          <span className="sub" style={{ display: 'block' }}>
            KES {formatKES(inPocket)} still with a rider
          </span>
        )}
      </td>
      {canHandleMoney && (
        <td style={{ textAlign: 'right' }}>
          <button className="btn btn-p btn-sm"
            disabled={pending || toCentsOrZero(seller.readyKes) <= 0}
            title={toCentsOrZero(seller.readyKes) <= 0 ? 'Nothing has been handed in for this seller yet' : undefined}
            onClick={settle}>
            {pending ? 'Settling…' : 'Settle'}
          </button>
          {error && (
            <span role="alert" className="sub" style={{ color: 'var(--red)', display: 'block' }}>
              <Icon name="alert-circle" size={12} />{error}
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

/**
 * The one global switch.
 *
 * COD is the only flow where Esoqo holds somebody else's money, so it
 * is deliberately one policy an admin can see all of rather than a
 * per-company matrix nobody can audit at a glance.
 */
function PolicyPanel({ policy, canEdit }: { policy: CodPolicy; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [maxAmountKes, setMaxAmountKes] = useState(String(policy.maxAmountKes));
  const [handlingFeePct, setHandlingFeePct] = useState(String(policy.handlingFeePct));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { enabled: useId(), max: useId(), fee: useId() };

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await actionSetCodPolicy({
        enabled, maxAmountKes: toWire(toCentsOrZero(maxAmountKes)), handlingFeePct: Number(handlingFeePct),
      });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 16 }}>Settings</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, alignItems: 'end' }}>
        <label className="sub" htmlFor={ids.enabled} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id={ids.enabled} type="checkbox" disabled={!canEdit}
            checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Offer cash on delivery
        </label>
        <div>
          <label className="sub" htmlFor={ids.max} style={{ display: 'block', marginBottom: 4 }}>
            Most per parcel (KES)
          </label>
          <input id={ids.max} className="mono" style={inputStyle} disabled={!canEdit}
            value={maxAmountKes} onChange={(e) => setMaxAmountKes(e.target.value.replace(/[^\d.]/g, ''))} />
          <span className="sub" style={{ fontSize: '.78rem' }}>
            What a rider can be robbed of, and what Esoqo is liable for.
          </span>
        </div>
        <div>
          <label className="sub" htmlFor={ids.fee} style={{ display: 'block', marginBottom: 4 }}>
            Handling fee (%)
          </label>
          <input id={ids.fee} className="mono" style={inputStyle} disabled={!canEdit}
            value={handlingFeePct} onChange={(e) => setHandlingFeePct(e.target.value.replace(/[^\d.]/g, ''))} />
          <span className="sub" style={{ fontSize: '.78rem' }}>
            Held back from the seller&apos;s goods money. Separate from the delivery fee.
          </span>
        </div>
        {canEdit && (
          <button className="btn btn-o btn-sm" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : 'Save settings'}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center', marginTop: 12 }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}
