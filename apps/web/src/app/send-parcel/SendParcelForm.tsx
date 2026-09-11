'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@esoko/ui';
import {
  actionBookParcel, actionSetParcelPrice, actionPayParcel, actionCheckParcelStatus,
  actionQuoteParcelPrice, type ParcelPricingView, type ParcelZoneView, type BargainReasonView,
} from './actions';

/** The 5 brackets from the standard rate card — id is the wire value
 *  core-go expects, label is what the sender sees. Mirrors
 *  mobile/esoko_app's parcel_models.dart parcelTypes exactly, so the
 *  same booking picks read identically across app and web. */
const PARCEL_TYPES = [
  ['ENVELOPE_DOCUMENT', 'Envelope / Document'],
  ['SMALL', 'Small parcel'],
  ['MEDIUM', 'Medium parcel'],
  ['LARGE', 'Large parcel'],
  ['HEAVY_OVERSIZE', 'Heavy / Oversize'],
] as const;

type Stage = 'form' | 'price' | 'waiting' | 'success';

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
};

export function SendParcelForm({ pricing, zones }: { pricing: ParcelPricingView[]; zones: ParcelZoneView[] }) {
  const [senderName, setSenderName] = useState('');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverMsisdn, setReceiverMsisdn] = useState('');
  const [originLabel, setOriginLabel] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [originZoneId, setOriginZoneId] = useState('');
  const [destinationZoneId, setDestinationZoneId] = useState('');
  const [parcelType, setParcelType] = useState<string>(PARCEL_TYPES[0][0]);
  const [weightKg, setWeightKg] = useState('');
  const [fragile, setFragile] = useState(false);
  const [notes, setNotes] = useState('');

  const [stage, setStage] = useState<Stage>('form');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [code, setCode] = useState<string | null>(null);
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);
  const [quote, setQuote] = useState<(ParcelPricingView & { distanceKm?: number }) | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [selectedReason, setSelectedReason] = useState<BargainReasonView | null>(null);
  const [payMsisdn, setPayMsisdn] = useState('');
  const [finalPriceKes, setFinalPriceKes] = useState<number | null>(null);

  // Typing a weight auto-picks the matching bracket, same as the
  // mobile booking form — leaving it blank just falls back to
  // whichever type is picked by hand.
  useEffect(() => {
    const w = Number(weightKg);
    if (!weightKg || Number.isNaN(w)) return;
    const match = pricing.find((p) => w >= p.minWeightKg && w <= p.maxWeightKg);
    if (match) setParcelType(match.parcelType);
  }, [weightKg, pricing]);

  // Poll while a real Daraja callback is in flight — console/sandbox
  // auto-confirm mode never reaches 'waiting' at all, since
  // actionPayParcel already returns BOOKED. Same shape as ticket
  // checkout's poll.
  useEffect(() => {
    if (stage !== 'waiting' || !code) return;
    const t = setInterval(async () => {
      const res = await actionCheckParcelStatus(code);
      if (res && res.status !== 'DRAFT_PENDING_PAYMENT') setStage('success');
    }, 4000);
    return () => clearInterval(t);
  }, [stage, code]);

  function priceForReason(base: ParcelPricingView, reason: BargainReasonView): number {
    let pct = base.bargainMinPct + reason.extraDiscountPct;
    if (pct > base.bargainMaxPct) pct = base.bargainMaxPct;
    return base.minKes * (1 - pct / 100);
  }

  function submitDetails() {
    setError(null);
    start(async () => {
      const res = await actionBookParcel({
        senderName, senderMsisdn, receiverName, receiverMsisdn,
        originLabel, destinationLabel, parcelType,
        weightKg: weightKg ? Number(weightKg) : undefined, fragile, notes,
        originZoneId: originZoneId || undefined, destinationZoneId: destinationZoneId || undefined,
      });
      if (!res.ok) { setError(res.error); return; }
      setCode(res.code);
      setDeliveryCode(res.deliveryCode);
      setPayMsisdn(senderMsisdn);
      setStage('price');
      setQuoteLoading(true);
      const q = await actionQuoteParcelPrice(parcelType, originZoneId || undefined, destinationZoneId || undefined);
      setQuoteLoading(false);
      if (q.ok) setQuote(q.data);
      else setError(q.error);
    });
  }

  function confirmAndPay() {
    if (!code || !quote) return;
    const priceKes = selectedReason ? priceForReason(quote, selectedReason) : quote.minKes;
    setError(null);
    start(async () => {
      const priced = await actionSetParcelPrice(code, priceKes, selectedReason?.reason);
      if (!priced.ok) { setError(priced.error); return; }
      const paid = await actionPayParcel(code, payMsisdn);
      if (!paid.ok) { setError(paid.error); return; }
      setFinalPriceKes(priceKes);
      if (paid.status === 'BOOKED') setStage('success');
      else setStage('waiting');
    });
  }

  const originZones = useMemo(() => zones, [zones]);

  if (stage === 'success') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-g" style={{ margin: '0 auto 14px' }}><Icon name="check-circle" size={22} /></span>
        <h3 style={{ marginBottom: 6 }}>Payment received</h3>
        <p className="sub" style={{ margin: '0 0 18px' }}>
          Parcel <span className="mono" style={{ fontWeight: 700 }}>{code}</span>
          {finalPriceKes != null && <> · KES {finalPriceKes.toLocaleString('en-KE')}</>}
        </p>
        <div style={{ textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <p className="sub" style={{ margin: '0 0 4px', fontSize: '.8rem' }}>Delivery code — for your receiver</p>
          <p className="mono" style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, letterSpacing: '.06em' }}>{deliveryCode}</p>
          <p className="sub" style={{ margin: '8px 0 0', fontSize: '.82rem' }}>
            We text this to {receiverName} once a courier picks it up — they give it to the courier
            to receive the parcel. You can also pass it on yourself if you'd rather.
          </p>
        </div>
        <p className="sub" style={{ fontSize: '.85rem' }}>
          Keep the code <strong className="mono">{code}</strong> to check on this parcel any time at{' '}
          <Link href="/send-parcel/track">Track a parcel</Link>.
        </p>
      </div>
    );
  }

  if (stage === 'waiting') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="phone-call" size={22} /></span>
        <h3 style={{ marginBottom: 6 }}>Check your phone</h3>
        <p className="sub" style={{ margin: 0 }}>
          Enter your M-Pesa PIN on the prompt sent to {payMsisdn}. This page updates on its own.
        </p>
      </div>
    );
  }

  if (stage === 'price') {
    const base = quote;
    return (
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>Choose a price</h3>
        <p className="sub" style={{ margin: '0 0 16px', fontSize: '.85rem' }}>Parcel {code}</p>
        {quoteLoading || !base ? (
          <p className="sub">Loading pricing…</p>
        ) : (
          <>
            {base.distanceKm != null && (
              <p className="sub" style={{ margin: '0 0 12px', fontSize: '.82rem' }}>
                {base.distanceKm.toFixed(1)} km between the zones you picked — added to the price below.
              </p>
            )}
            <PriceOption
              title="Standard" selected={selectedReason === null} onClick={() => setSelectedReason(null)}
              subtitle={`${base.weightLabel} · usually KES ${base.minKes.toFixed(0)}–${base.maxKes.toFixed(0)}`}
              priceKes={base.minKes}
            />
            {base.bargainReasons.length > 0 && (
              <>
                <p className="sub" style={{ margin: '16px 0 8px', fontSize: '.85rem' }}>Or make an offer</p>
                {base.bargainReasons.map((r) => (
                  <div key={r.reason} style={{ marginBottom: 8 }}>
                    <PriceOption
                      title={r.reason} selected={selectedReason?.reason === r.reason} onClick={() => setSelectedReason(r)}
                      subtitle={`Negotiable — ${r.extraDiscountPct.toFixed(0)}% off the usual minimum`}
                      priceKes={priceForReason(base, r)}
                    />
                  </div>
                ))}
              </>
            )}

            <div style={{ margin: '18px 0 0' }}>
              <label className="sub" htmlFor="pay-msisdn" style={{ display: 'block', marginBottom: 6 }}>
                M-Pesa number to pay from
              </label>
              <input id="pay-msisdn" style={fieldStyle} value={payMsisdn}
                onChange={(e) => setPayMsisdn(e.target.value)} placeholder="+2547XXXXXXXX" />
            </div>

            {error && <p style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 0' }} role="alert">
              <Icon name="alert-circle" size={15} />{error}</p>}

            <button type="button" className="btn btn-p" style={{ width: '100%', marginTop: 14 }}
              disabled={pending || !payMsisdn.trim()} onClick={confirmAndPay}>
              {pending ? 'Starting…' : `Pay KES ${(selectedReason ? priceForReason(base, selectedReason) : base.minKes).toFixed(0)} with M-Pesa`}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 16 }}>Your details</h3>
      <FormRow>
        <Field id="sd-name" label="Your name" value={senderName} onChange={setSenderName} />
        <Field id="sd-msisdn" label="Your phone" value={senderMsisdn} onChange={setSenderMsisdn} placeholder="+2547XXXXXXXX" />
      </FormRow>

      <h3 style={{ margin: '20px 0 16px' }}>Receiver's details</h3>
      <FormRow>
        <Field id="rc-name" label="Receiver's name" value={receiverName} onChange={setReceiverName} />
        <Field id="rc-msisdn" label="Receiver's phone" value={receiverMsisdn} onChange={setReceiverMsisdn} placeholder="+2547XXXXXXXX" />
      </FormRow>

      <h3 style={{ margin: '20px 0 16px' }}>Where it's going</h3>
      <FormRow>
        <Field id="origin" label="From (description)" value={originLabel} onChange={setOriginLabel} placeholder="e.g. Nyayo House, Nairobi" />
        <Field id="dest" label="To (description)" value={destinationLabel} onChange={setDestinationLabel} placeholder="e.g. Kisumu bus stage" />
      </FormRow>
      {originZones.length > 0 && (
        <FormRow>
          <ZoneField id="origin-zone" label="Nearest hub to pickup (optional)" value={originZoneId} onChange={setOriginZoneId} zones={originZones} />
          <ZoneField id="dest-zone" label="Nearest hub to delivery (optional)" value={destinationZoneId} onChange={setDestinationZoneId} zones={originZones} />
        </FormRow>
      )}
      <p className="sub" style={{ margin: '4px 0 0', fontSize: '.78rem' }}>
        Picking hubs on both sides adds a distance-based price adjustment shown before you pay.
      </p>

      <h3 style={{ margin: '20px 0 16px' }}>The parcel</h3>
      <FormRow>
        <div>
          <label className="sub" htmlFor="ptype" style={{ display: 'block', marginBottom: 6 }}>Type</label>
          <select id="ptype" style={fieldStyle} value={parcelType} onChange={(e) => setParcelType(e.target.value)}>
            {PARCEL_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <Field id="weight" label="Weight in kg (optional)" value={weightKg} onChange={(v) => setWeightKg(v.replace(/[^\d.]/g, ''))} placeholder="e.g. 2.5" />
      </FormRow>
      <label className="sub" htmlFor="fragile" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 0' }}>
        <input id="fragile" type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
        Fragile — handle with care
      </label>
      <div style={{ marginTop: 12 }}>
        <label className="sub" htmlFor="notes" style={{ display: 'block', marginBottom: 6 }}>Notes for the courier (optional)</label>
        <textarea id="notes" style={{ ...fieldStyle, minHeight: 70, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, margin: '16px 0 0' }} role="alert">
        <Icon name="alert-circle" size={15} />{error}</p>}

      <button type="button" className="btn btn-p" style={{ width: '100%', marginTop: 18 }} disabled={pending} onClick={submitDetails}>
        {pending ? 'Booking…' : 'Get a price'}
      </button>
    </div>
  );
}

function FormRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>{children}</div>;
}

function Field(
  { id, label, value, onChange, placeholder }:
  { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string },
) {
  return (
    <div>
      <label className="sub" htmlFor={id} style={{ display: 'block', marginBottom: 6 }}>{label}</label>
      <input id={id} style={fieldStyle} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function ZoneField(
  { id, label, value, onChange, zones }:
  { id: string; label: string; value: string; onChange: (v: string) => void; zones: ParcelZoneView[] },
) {
  return (
    <div>
      <label className="sub" htmlFor={id} style={{ display: 'block', marginBottom: 6 }}>{label}</label>
      <select id={id} style={fieldStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not sure / skip</option>
        {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
      </select>
    </div>
  );
}

/** Same selection-card shape the mobile pricing screen uses — a
 *  check-circle/circle glyph, highlighted border on selection. Kept
 *  local since it's parcel-pricing specific. */
function PriceOption(
  { title, subtitle, priceKes, selected, onClick }:
  { title: string; subtitle: string; priceKes: number; selected: boolean; onClick: () => void },
) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
      padding: 12, borderRadius: 10, cursor: 'pointer',
      border: selected ? '1.5px solid var(--brand)' : '1px solid var(--line)',
      background: selected ? 'var(--brand-t, rgba(0,0,0,.03))' : 'var(--bg-1, transparent)',
    }}>
      {selected
        ? <Icon name="check-circle" size={18} />
        : <span aria-hidden style={{ width: 18, height: 18, borderRadius: '50%', border: '1.5px solid var(--line)', flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>
        <strong style={{ display: 'block', fontSize: '.92rem' }}>{title}</strong>
        <span className="sub" style={{ fontSize: '.78rem' }}>{subtitle}</span>
      </span>
      <span className="mono" style={{ fontWeight: 800 }}>KES {priceKes.toFixed(0)}</span>
    </button>
  );
}
