'use client';
import { toCentsOrZero } from '@esoqo/domain';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import {
  actionBookParcel,
  type ParcelPricingView, type ParcelZoneView,
  type ParcelAgentView, type WalkInStationView,
} from './actions';

/** The 5 brackets from the standard rate card — id is the wire value
 *  core-go expects, label is what the sender sees. Mirrors
 *  mobile/esoqo_app's parcel_models.dart parcelTypes exactly, so the
 *  same booking picks read identically across app and web. */
const PARCEL_TYPES = [
  ['ENVELOPE_DOCUMENT', 'Envelope / Document'],
  ['SMALL', 'Small parcel'],
  ['MEDIUM', 'Medium parcel'],
  ['LARGE', 'Large parcel'],
  ['HEAVY_OVERSIZE', 'Heavy / Oversize'],
] as const;

/**
 * Booking a parcel — no price shown or charged anywhere on this page.
 *
 * Every booking lands as PAY_AT_COUNTER (see dbx.BookParcelInput's own
 * comment): the sender enters what's being sent and where, we book it
 * and hand back a tracking code, and the fee itself is settled in
 * person — with the agent at a station for a walk-in drop-off, or with
 * the courier on pickup otherwise. This form used to quote a live
 * price, run a bargain engine and take an M-Pesa payment inline; all
 * of that is gone until pricing online is actually sorted, not merely
 * hidden — there is no quote request anywhere in this file.
 */
type Stage = 'details' | 'contact' | 'success';

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
};

export function SendParcelForm(
  { pricing, zones, agents, stations }:
  {
    pricing: ParcelPricingView[]; zones: ParcelZoneView[];
    agents: ParcelAgentView[]; stations: WalkInStationView[];
  },
) {
  // ── What's being sent, and where ────────────────────────────────────
  const [parcelType, setParcelType] = useState<string>(PARCEL_TYPES[0][0]);
  const [weightKg, setWeightKg] = useState('');
  const [fragile, setFragile] = useState(false);
  const [originLabel, setOriginLabel] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [originZoneId, setOriginZoneId] = useState('');
  const [destinationZoneId, setDestinationZoneId] = useState('');

  // ── How it reaches a courier's hands in the first place ─────────────
  // SCHEDULED_PICKUP is the only path that existed before walk-in
  // stations did, so it stays the default — a sender who says nothing
  // gets exactly the flow they'd have gotten before this shipped.
  const [originMethod, setOriginMethod] = useState<'SCHEDULED_PICKUP' | 'SELF_DROPOFF'>('SCHEDULED_PICKUP');
  const [dropoffStationId, setDropoffStationId] = useState('');
  const chosenStation = useMemo(
    () => stations.find((s) => s.id === dropoffStationId) ?? null,
    [stations, dropoffStationId],
  );
  const isSelfDropoff = originMethod === 'SELF_DROPOFF';

  // ── How it gets there ───────────────────────────────────────────────
  const [deliveryMode, setDeliveryMode] = useState<'DOORSTEP' | 'AGENT'>('DOORSTEP');
  const [destinationAgentId, setDestinationAgentId] = useState('');
  const chosenAgent = useMemo(
    () => agents.find((a) => a.id === destinationAgentId) ?? null,
    [agents, destinationAgentId],
  );

  // ── Who ─────────────────────────────────────────────────────────────
  const [senderName, setSenderName] = useState('');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverMsisdn, setReceiverMsisdn] = useState('');
  const [notes, setNotes] = useState('');

  const [stage, setStage] = useState<Stage>('details');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const [serviceTicketNumber, setServiceTicketNumber] = useState<string | null>(null);
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);

  // Typing a weight auto-picks the matching bracket, same as the mobile
  // booking form — leaving it blank falls back to the type picked by hand.
  // `pricing` is used only for this weight-to-bracket match and the
  // weightLabel shown next to each type below — no KES figure from it
  // is ever rendered on this page.
  useEffect(() => {
    const w = Number(weightKg);
    if (!weightKg || Number.isNaN(w)) return;
    const match = pricing.find((p) => w >= p.minWeightKg && w <= p.maxWeightKg);
    if (match) setParcelType(match.parcelType);
  }, [weightKg, pricing]);

  function goToContact() {
    const errs: Record<string, string> = {};
    if (!originLabel.trim()) errs.origin = 'Where is it being collected from?';
    if (!destinationLabel.trim()) errs.destination = 'Where is it going?';
    if (deliveryMode === 'AGENT' && !destinationAgentId) errs.agent = 'Choose a pickup point';
    if (originMethod === 'SELF_DROPOFF' && !dropoffStationId) errs.station = 'Choose which station you’re dropping this off at';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setStage('contact');
  }

  /** The one and only write. No price is quoted or charged — the fee is
   *  settled in person, so this books the parcel and stops. */
  function submitBooking() {
    const errs: Record<string, string> = {};
    if (!senderName.trim()) errs.senderName = 'We need your name';
    if (!senderMsisdn.trim()) errs.senderMsisdn = 'We need your phone number';
    if (!receiverName.trim()) errs.receiverName = "We need the receiver's name";
    if (!receiverMsisdn.trim()) errs.receiverMsisdn = "We need the receiver's phone number";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setError(null);
    start(async () => {
      const booked = await actionBookParcel({
        senderName, senderMsisdn, receiverName, receiverMsisdn,
        originLabel, destinationLabel, parcelType,
        weightKg: weightKg ? Number(weightKg) : undefined, fragile, notes,
        originZoneId: originZoneId || undefined,
        destinationZoneId: destinationZoneId || undefined,
        destinationAgentId: deliveryMode === 'AGENT' ? (destinationAgentId || undefined) : undefined,
        originMethod,
        parcelOrgId: isSelfDropoff ? dropoffStationId : undefined,
        // No price is quoted or charged online for any booking here —
        // see dbx.BookParcelInput.PayAtCounter's own comment. A walk-in
        // drop-off settles at the station, a scheduled pickup settles
        // with the courier.
        payAtCounter: true,
      });
      if (!booked.ok) { setError(booked.error); return; }
      setServiceTicketNumber(booked.serviceTicketNumber);
      setDeliveryCode(booked.deliveryCode);
      setStage('success');
    });
  }

  // ── Terminal stage ──────────────────────────────────────────────────

  if (stage === 'success') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-g" style={{ margin: '0 auto 14px' }}><Icon name="check-circle" size={22} /></span>
        <h3 style={{ marginBottom: 6 }}>{isSelfDropoff ? 'Drop-off submitted' : 'Booking confirmed'}</h3>
        {isSelfDropoff ? (
          // The row already exists as a real, BOOKED parcel the moment
          // this call returns (dbx.BookParcel — PayAtCounter skips
          // straight past DRAFT_PENDING_PAYMENT), and it's already on
          // the company's own Front Desk worklist (GET
          // /v1/parcel-orgs/me/parcels?status=BOOKED&originMethod=
          // SELF_DROPOFF — see FrontDeskClient's "Waiting at your desk"
          // table), keyed by the real tracking code. But this screen
          // never learns that code (see core-go's
          // Parcel.serviceTicketNumber schema comment) — nobody has
          // proven they have the box in hand yet, so the ticket number
          // is what the sender hands the clerk instead. The real code,
          // the SMS pair and the receiver's own delivery code all wait
          // for the clerk's actual "box in hand" scan.
          <>
            <p className="sub" style={{ margin: '0 0 14px' }}>
              {`We've told ${chosenStation?.name ?? 'the station'} to expect you.`}
            </p>
            <div style={{ textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <p className="sub" style={{ margin: '0 0 4px', fontSize: '.8rem' }}>Your service ticket</p>
              <p className="mono" style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, letterSpacing: '.06em' }}>{serviceTicketNumber}</p>
              <p className="sub" style={{ margin: '8px 0 0', fontSize: '.82rem' }}>
                {`Give this to the clerk at ${chosenStation?.name ?? 'the station'} — it's already waiting on their desk list, ready for them to check the box in.`}
              </p>
            </div>
            <div style={{ textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: 14 }}>
              <p className="sub" style={{ margin: 0, fontSize: '.85rem' }}>
                {`Nothing to pay online — settle the fee at ${chosenStation?.name ?? 'the station'} when you drop this off. We'll text you your real tracking link, and ${receiverName} their delivery code, the moment the clerk confirms they have it in hand.`}
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="sub" style={{ margin: '0 0 18px' }}>
              Service ticket <span className="mono" style={{ fontWeight: 700 }}>{serviceTicketNumber}</span>
            </p>
            <div style={{ textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <p className="sub" style={{ margin: '0 0 4px', fontSize: '.8rem' }}>Delivery code — for your receiver</p>
              <p className="mono" style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, letterSpacing: '.06em' }}>{deliveryCode}</p>
              <p className="sub" style={{ margin: '8px 0 0', fontSize: '.82rem' }}>
                {`We text this to ${receiverName} once a courier picks it up — they give it to the courier to receive the parcel. You can also pass it on yourself if you'd rather.`}
              </p>
            </div>
            <p className="sub" style={{ fontSize: '.85rem', marginBottom: 14 }}>
              Nothing to pay online — settle the fee with the courier when they collect it.
            </p>
            {chosenAgent && (
              <p className="sub" style={{ fontSize: '.85rem', marginBottom: 14 }}>
                {receiverName} collects it from <strong>{chosenAgent.name}</strong> — {chosenAgent.locationHint}.
                We&apos;ll text them the moment it lands there.
              </p>
            )}
            {/* No /t/<code> link here — the real tracking code doesn't
                exist to this screen at all yet (see this block's own
                comment above). We text it the moment a courier picks
                this up; until then the service ticket number above is
                the only thing to hold onto. */}
            <p className="sub" style={{ fontSize: '.85rem' }}>
              We&apos;ll text you your real tracking link the moment a courier picks this up.
            </p>
          </>
        )}
      </div>
    );
  }

  // ── Stage 2: who ────────────────────────────────────────────────────

  if (stage === 'contact') {
    return (
      <div className="card">
        <button type="button" className="btn btn-o btn-sm" style={{ marginBottom: 16 }}
          onClick={() => setStage('details')}>
          <Icon name="arrow-left" size={14} />Back
        </button>

        <p className="sub" style={{ margin: '0 0 16px', fontSize: '.85rem' }}>
          {isSelfDropoff
            ? <>Dropping off at <strong>{chosenStation?.name}</strong> — {chosenStation?.locationHint}. The fee is settled there, not here.</>
            : 'The fee is settled with the courier who collects it, not here.'}
        </p>

        <h3 style={{ margin: '20px 0 16px' }}>Your details</h3>
        <FormRow>
          <Field id="sd-name" label="Your name" value={senderName} onChange={setSenderName} error={fieldErrors.senderName} />
          <Field id="sd-msisdn" label="Your phone" value={senderMsisdn} error={fieldErrors.senderMsisdn}
            onChange={setSenderMsisdn} placeholder="+2547XXXXXXXX" />
        </FormRow>

        <h3 style={{ margin: '20px 0 16px' }}>Receiver&apos;s details</h3>
        <FormRow>
          <Field id="rc-name" label="Receiver's name" value={receiverName} onChange={setReceiverName} error={fieldErrors.receiverName} />
          <Field id="rc-msisdn" label="Receiver's phone" value={receiverMsisdn} onChange={setReceiverMsisdn}
            placeholder="+2547XXXXXXXX" error={fieldErrors.receiverMsisdn} />
        </FormRow>
        <p className="sub" style={{ margin: '4px 0 0', fontSize: '.78rem' }}>
          We text the receiver their delivery code and a tracking link — so make sure this number is right.
        </p>

        <div style={{ marginTop: 16 }}>
          <label className="sub" htmlFor="notes" style={{ display: 'block', marginBottom: 6 }}>
            Notes for the courier (optional)
          </label>
          <textarea id="notes" style={{ ...fieldStyle, minHeight: 70, resize: 'vertical' }}
            value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Call on arrival, gate 3" />
        </div>

        {error && <ErrorLine message={error} />}

        <button type="button" className="btn btn-p" style={{ width: '100%', marginTop: 18 }}
          disabled={pending} onClick={submitBooking}>
          {pending ? 'Submitting…' : isSelfDropoff ? 'Submit — pay at the counter' : 'Confirm booking'}
        </button>
        <p className="sub" style={{ margin: '8px 0 0', fontSize: '.78rem', textAlign: 'center' }}>
          {isSelfDropoff
            ? 'Nothing to pay online — settle the fee at the counter when you drop this off.'
            : 'Nothing to pay online — settle the fee with the courier when they collect it.'}
        </p>
      </div>
    );
  }

  // ── Stage 1: what and where ──────────────────────────────────────────

  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>What are you sending?</h3>
      <p className="sub" style={{ margin: '0 0 16px', fontSize: '.85rem' }}>
        The fee is settled in person, with the agent or courier — we just need the shipping details.
      </p>

      <FormRow>
        <div>
          <label className="sub" htmlFor="ptype" style={{ display: 'block', marginBottom: 6 }}>Type</label>
          <select id="ptype" style={fieldStyle} value={parcelType} onChange={(e) => setParcelType(e.target.value)}>
            {PARCEL_TYPES.map(([id, label]) => {
              const band = pricing.find((p) => p.parcelType === id);
              return (
                <option key={id} value={id}>
                  {label}{band ? ` — ${band.weightLabel}` : ''}
                </option>
              );
            })}
          </select>
        </div>
        <Field id="weight" label="Weight in kg (optional)" value={weightKg}
          onChange={(v) => setWeightKg(v.replace(/[^\d.]/g, ''))} placeholder="e.g. 2.5" />
      </FormRow>
      <label className="sub" htmlFor="fragile" style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 0' }}>
        <input id="fragile" type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
        Fragile — handle with care
      </label>

      <h3 style={{ margin: '22px 0 16px' }}>Where it&apos;s going</h3>
      <FormRow>
        <Field id="origin" label="From" value={originLabel} onChange={setOriginLabel}
          placeholder="e.g. Nyayo House, Nairobi" error={fieldErrors.origin} />
        <Field id="dest" label="To" value={destinationLabel} onChange={setDestinationLabel}
          placeholder="e.g. Kisumu bus stage" error={fieldErrors.destination} />
      </FormRow>
      {zones.length > 0 && (
        <>
          <FormRow>
            <ZoneField id="origin-zone" label="Nearest hub to pickup" value={originZoneId} onChange={setOriginZoneId} zones={zones} />
            <ZoneField id="dest-zone" label="Nearest hub to delivery" value={destinationZoneId} onChange={setDestinationZoneId} zones={zones} />
          </FormRow>
          <p className="sub" style={{ margin: '4px 0 0', fontSize: '.78rem' }}>
            Helps us route this through the nearest hub on each side.
          </p>
        </>
      )}

      {/* Origin-side leg: a scheduled pickup is the only path that
          existed before walk-in stations did, so it stays first and
          selected by default. Only offered at all when at least one
          company has actually opted in to taking walk-ins. */}
      {stations.length > 0 && (
        <>
          <h3 style={{ margin: '22px 0 12px' }}>How will we get this from you?</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <ChoiceCard
              selected={originMethod === 'SCHEDULED_PICKUP'}
              onClick={() => { setOriginMethod('SCHEDULED_PICKUP'); setDropoffStationId(''); }}
              title="Schedule a pickup"
              subtitle="A courier collects it from the address above."
            />
            <ChoiceCard
              selected={originMethod === 'SELF_DROPOFF'}
              onClick={() => setOriginMethod('SELF_DROPOFF')}
              title="I'll drop it off myself"
              subtitle="Hand it over in person at a station — no waiting for a rider."
            />
          </div>
          {originMethod === 'SELF_DROPOFF' && (
            <div style={{ marginTop: 12 }}>
              <label className="sub" htmlFor="station" style={{ display: 'block', marginBottom: 6 }}>Station</label>
              <select id="station" style={fieldStyle} value={dropoffStationId}
                onChange={(e) => setDropoffStationId(e.target.value)}>
                <option value="">Choose where you're standing…</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} — {s.locationHint}</option>
                ))}
              </select>
              {fieldErrors.station && <ErrorLine message={fieldErrors.station} />}
              {chosenStation?.openingHours && (
                <p className="sub" style={{ margin: '6px 0 0', fontSize: '.8rem' }}>
                  Open {chosenStation.openingHours}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* The cheap leg, offered as a real choice rather than buried —
          no percentage or price shown, since nothing on this page is
          priced; just what each option actually means for the receiver. */}
      {agents.length > 0 && (
        <>
          <h3 style={{ margin: '22px 0 12px' }}>How should it be delivered?</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <ChoiceCard
              selected={deliveryMode === 'DOORSTEP'}
              onClick={() => { setDeliveryMode('DOORSTEP'); setDestinationAgentId(''); }}
              title="To the door"
              subtitle="A courier brings it to the address above."
            />
            <ChoiceCard
              selected={deliveryMode === 'AGENT'}
              onClick={() => setDeliveryMode('AGENT')}
              title="Collect from a pickup point"
              subtitle="The receiver picks it up from a nearby shop instead."
            />
          </div>
          {deliveryMode === 'AGENT' && (
            <div style={{ marginTop: 12 }}>
              <label className="sub" htmlFor="agent" style={{ display: 'block', marginBottom: 6 }}>Pickup point</label>
              <select id="agent" style={fieldStyle} value={destinationAgentId}
                onChange={(e) => setDestinationAgentId(e.target.value)}>
                <option value="">Choose a shop…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.locationHint}
                    {toCentsOrZero(a.holdingFeeKes) > 0 ? ' (a holding fee applies on collection)' : ''}
                  </option>
                ))}
              </select>
              {fieldErrors.agent && <ErrorLine message={fieldErrors.agent} />}
              {chosenAgent?.openingHours && (
                <p className="sub" style={{ margin: '6px 0 0', fontSize: '.8rem' }}>
                  Open {chosenAgent.openingHours}
                </p>
              )}
            </div>
          )}
        </>
      )}

      <p className="sub" style={{ margin: '22px 0 0', fontSize: '.85rem', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        Nothing to pay here — the fee is worked out and settled in person, with the agent or courier.
      </p>

      {error && <ErrorLine message={error} />}

      <button type="button" className="btn btn-p" style={{ width: '100%', marginTop: 16 }}
        disabled={isSelfDropoff && !dropoffStationId} onClick={goToContact}>
        Continue
      </button>
    </div>
  );
}

function FormRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>{children}</div>;
}

/** Per-field errors rather than one "fill in every field above" line —
 *  a sender should never have to hunt for which box is the problem. */
function Field(
  { id, label, value, onChange, placeholder, error }:
  { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; error?: string },
) {
  return (
    <div>
      <label className="sub" htmlFor={id} style={{ display: 'block', marginBottom: 6 }}>{label}</label>
      <input id={id} value={value} placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        style={{ ...fieldStyle, borderColor: error ? 'var(--red, #b42318)' : 'var(--line)' }}
        onChange={(e) => onChange(e.target.value)} />
      {error && (
        <p id={`${id}-err`} style={{ color: 'var(--red, #b42318)', fontSize: '.78rem', margin: '4px 0 0' }}>{error}</p>
      )}
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

/** One selectable option card — delivery mode, origin method. Same
 *  shape in both places so a choice always looks like a choice. */
function ChoiceCard(
  { title, subtitle, selected, onClick }:
  { title: string; subtitle: string; selected: boolean; onClick: () => void },
) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} style={{
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
    </button>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p role="alert" style={{
      color: 'var(--red, #b42318)', display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 0', fontSize: '.85rem',
    }}>
      <Icon name="alert-circle" size={15} />{message}
    </p>
  );
}
