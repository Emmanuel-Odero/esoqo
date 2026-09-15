'use client';

import { displayKES, toCentsOrZero, toWire } from '@esoqo/domain';
import { useId, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import {
  actionPayCourier, actionSetCourierTariff,
  type CourierOwed, type CourierTariff,
} from '../actions';

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: '100%',
};

export function PayoutConsole({
  tariff, couriers, canEdit, canPay,
}: {
  tariff: CourierTariff; couriers: CourierOwed[];
  canEdit: boolean; canPay: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <CouriersPanel couriers={couriers} canPay={canPay} />
      <TariffPanel tariff={tariff} canEdit={canEdit} />
    </div>
  );
}

function CouriersPanel({ couriers, canPay }: { couriers: CourierOwed[]; canPay: boolean }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Courier</th><th>Deliveries</th><th className="num">Owed</th>
              {canPay && <th />}
            </tr>
          </thead>
          <tbody>
            {couriers.map((c) => <CourierRow key={c.courierPartyId} courier={c} canPay={canPay} />)}
            {couriers.length === 0 && (
              <tr>
                <td colSpan={canPay ? 4 : 3} className="sub" style={{ textAlign: 'center', padding: 24 }}>
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

/**
 * Paying one courier.
 *
 * The amount is typed rather than pre-filled with what's owed. That's
 * the same reasoning the COD remittance form follows: the record keeps
 * both what was sent and what was owed precisely because they can
 * legitimately differ — a part payment, a rounding to note
 * denominations, a deduction agreed offline — and pre-filling the
 * expected figure is how somebody confirms a number they never checked.
 */
function CourierRow({ courier, canPay }: { courier: CourierOwed; canPay: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ shortfallKes: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { amount: useId(), ref: useId() };

  function pay() {
    setError(null);
    startTransition(async () => {
      // Exact decimal string — the server's money.Amount binding takes
      // either shape, so what an admin typed is what gets posted.
      const res = await actionPayCourier(courier.courierPartyId, toWire(toCentsOrZero(amount)), reference.trim());
      if (!res.ok) { setError(res.error); return; }
      setDone({ shortfallKes: res.shortfallKes });
      setOpen(false);
    });
  }

  return (
    <>
      <tr>
        <td>
          <strong>{courier.name}</strong>
          {courier.msisdn && <span className="sub mono" style={{ display: 'block' }}>{courier.msisdn}</span>}
        </td>
        <td>{courier.parcelCount}</td>
        <td className="num mono">KES {displayKES(courier.owedKes)}</td>
        {canPay && (
          <td style={{ textAlign: 'right' }}>
            <button className="btn btn-p btn-sm" onClick={() => setOpen(!open)}>
              {open ? 'Cancel' : 'Pay'}
            </button>
            {done && (
              <span className="sub" style={{ display: 'block' }}>
                {toCentsOrZero(done.shortfallKes) > 0
                  ? `Paid — KES ${displayKES(done.shortfallKes)} short of the accrual.`
                  : 'Paid in full.'}
              </span>
            )}
          </td>
        )}
      </tr>
      {open && canPay && (
        <tr>
          <td colSpan={4} style={{ padding: 16, background: 'var(--bg-1, rgba(0,0,0,.02))' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
              <div>
                <label className="sub" htmlFor={ids.amount} style={{ display: 'block', marginBottom: 4 }}>
                  Amount sent (KES)
                </label>
                <input id={ids.amount} className="mono" style={inputStyle} value={amount}
                  placeholder={`Owed: ${displayKES(courier.owedKes)}`}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
              </div>
              <div>
                <label className="sub" htmlFor={ids.ref} style={{ display: 'block', marginBottom: 4 }}>
                  Reference
                </label>
                <input id={ids.ref} style={inputStyle} value={reference}
                  placeholder="M-Pesa code, or how it was paid"
                  onChange={(e) => setReference(e.target.value)} />
              </div>
              <button className="btn btn-p btn-sm" disabled={pending || !amount} onClick={pay}>
                {pending ? 'Recording…' : 'Record payout'}
              </button>
            </div>
            <p className="sub" style={{ margin: '8px 0 0', fontSize: '.78rem' }}>
              This clears every unpaid delivery for this courier and texts them the amount.
            </p>
            {error && (
              <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
                <Icon name="alert-circle" size={14} />{error}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function TariffPanel({ tariff, canEdit }: { tariff: CourierTariff; canEdit: boolean }) {
  const [perDeliveryKes, setPerDeliveryKes] = useState(String(tariff.perDeliveryKes));
  const [pctOfPrice, setPctOfPrice] = useState(String(tariff.pctOfPrice));
  const [maxPerDeliveryKes, setMaxPerDeliveryKes] = useState(String(tariff.maxPerDeliveryKes));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { per: useId(), pct: useId(), max: useId() };

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await actionSetCourierTariff({
        perDeliveryKes: toWire(toCentsOrZero(perDeliveryKes)),
        pctOfPrice: Number(pctOfPrice),
        maxPerDeliveryKes: toWire(toCentsOrZero(maxPerDeliveryKes)),
      });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>What a courier earns</h3>
      <p className="sub" style={{ margin: '0 0 16px', fontSize: '.85rem' }}>
        The two components stack. Set either to zero for a flat rate only, or a commission only.
        Changing this never alters what an already-delivered parcel accrued.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div>
          <label className="sub" htmlFor={ids.per} style={{ display: 'block', marginBottom: 4 }}>
            Flat, per delivery (KES)
          </label>
          <input id={ids.per} className="mono" style={inputStyle} disabled={!canEdit}
            value={perDeliveryKes} onChange={(e) => setPerDeliveryKes(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.pct} style={{ display: 'block', marginBottom: 4 }}>
            Share of the delivery fee (%)
          </label>
          <input id={ids.pct} className="mono" style={inputStyle} disabled={!canEdit}
            value={pctOfPrice} onChange={(e) => setPctOfPrice(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.max} style={{ display: 'block', marginBottom: 4 }}>
            Ceiling per delivery (KES)
          </label>
          <input id={ids.max} className="mono" style={inputStyle} disabled={!canEdit}
            value={maxPerDeliveryKes} onChange={(e) => setMaxPerDeliveryKes(e.target.value.replace(/[^\d.]/g, ''))} />
          {/* Stated plainly because it is a safety net, not a policy:
              its job is to make a mistyped percentage cost a margin
              rather than a fortune. */}
          <span className="sub" style={{ fontSize: '.78rem' }}>
            A guard against a mistyped rate. A courier is never paid more than the sender paid.
          </span>
        </div>
        {canEdit && (
          <button className="btn btn-o btn-sm" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : 'Save rate'}
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
