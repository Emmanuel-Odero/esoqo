'use client';
import {
  ZERO_CENTS, displayKES, formatKES, percentOfCents, subCents, toCentsOrZero, toWire,
  type Cents,
} from '@esoqo/domain';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import {
  actionBookParcel, actionSetParcelPrice, actionPayParcel, actionCheckParcelStatus,
  actionQuoteParcelPrice, actionListCoverageTiers, actionBookParcelCod,
  type ParcelPricingView, type ParcelZoneView, type BargainReasonView,
  type ParcelAgentView, type CoverageTierView, type CodPolicyView, type WalkInStationView,
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
 * Booking a parcel, priced before anything is written.
 *
 * The order of these stages is the point. This form used to create a
 * DRAFT_PENDING_PAYMENT row the moment you asked what something cost —
 * a button labelled "Get a price" that wrote to the database — which is
 * where the admin console's stale-draft KPI and its nightly sweeper
 * came from. Now `quote` is a pure read that re-runs as the sender
 * edits, `details` collects the people, and exactly one commit at the
 * end books, prices and charges.
 *
 * That also fixes the thing underneath it: the sender no longer types
 * eight PII fields before finding out whether they can afford this.
 */
type Stage = 'quote' | 'details' | 'waiting' | 'success';

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.95rem',
};

export function SendParcelForm(
  { pricing, zones, agents, codPolicy, stations }:
  {
    pricing: ParcelPricingView[]; zones: ParcelZoneView[];
    agents: ParcelAgentView[]; codPolicy: CodPolicyView;
    stations: WalkInStationView[];
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
  // Pilot behaviour: a walk-in drop-off never sees a price or pays
  // online here — the fee is settled in person at the counter, and the
  // only thing this flow still owes the sender digitally is a tracking
  // code and, later, an SMS once the station actually has the parcel in
  // hand (see /parcel-org/receive). Every price/cover/COD/M-Pesa block
  // below is gated on this being false.
  const isSelfDropoff = originMethod === 'SELF_DROPOFF';

  // ── How it gets there ───────────────────────────────────────────────
  const [deliveryMode, setDeliveryMode] = useState<'DOORSTEP' | 'AGENT'>('DOORSTEP');
  const [destinationAgentId, setDestinationAgentId] = useState('');

  // ── Cover ───────────────────────────────────────────────────────────
  const [declaredValue, setDeclaredValue] = useState('');
  const [coverageTierId, setCoverageTierId] = useState('');
  const [tiers, setTiers] = useState<CoverageTierView[]>([]);

  // ── Who ─────────────────────────────────────────────────────────────
  const [senderName, setSenderName] = useState('');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverMsisdn, setReceiverMsisdn] = useState('');
  const [notes, setNotes] = useState('');
  const [payMsisdn, setPayMsisdn] = useState('');

  // ── Cash on delivery ────────────────────────────────────────────────
  // Off by default. A seller who wants it is making a deliberate choice
  // about who holds their money; nobody should end up on COD by not
  // reading a pre-ticked box.
  const [useCod, setUseCod] = useState(false);
  const [codAmount, setCodAmount] = useState('');
  const codAmountNum = Number(codAmount) || 0;

  const [stage, setStage] = useState<Stage>('quote');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const [quote, setQuote] = useState<(ParcelPricingView & { distanceKm?: number }) | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [selectedReason, setSelectedReason] = useState<BargainReasonView | null>(null);

  const [code, setCode] = useState<string | null>(null);
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);
  const [finalPriceKes, setFinalPriceKes] = useState<number | null>(null);

  const declaredValueNum = Number(declaredValue) || 0;
  const chosenAgent = useMemo(
    () => agents.find((a) => a.id === destinationAgentId) ?? null,
    [agents, destinationAgentId],
  );

  // Typing a weight auto-picks the matching bracket, same as the mobile
  // booking form — leaving it blank falls back to the type picked by hand.
  useEffect(() => {
    const w = Number(weightKg);
    if (!weightKg || Number.isNaN(w)) return;
    const match = pricing.find((p) => w >= p.minWeightKg && w <= p.maxWeightKg);
    if (match) setParcelType(match.parcelType);
  }, [weightKg, pricing]);

  // Cover options are re-quoted whenever the declared value changes —
  // the server owns the fee formula (see handleListCoverageTiers), so
  // the fee shown beside each tier is the fee that will actually be
  // charged rather than a number this component worked out itself.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const fetched = await actionListCoverageTiers(declaredValueNum);
      if (!cancelled) setTiers(fetched);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [declaredValueNum]);

  // The live quote. Debounced because it re-runs on every edit to a
  // zone, agent, type or declared value; `seq` guards against a slow
  // earlier request landing after a fast later one and showing a price
  // for inputs the sender has already moved on from.
  const seq = useRef(0);
  const refreshQuote = useCallback(() => {
    const mine = ++seq.current;
    setQuoteLoading(true);
    void (async () => {
      const res = await actionQuoteParcelPrice({
        parcelType,
        originZoneId: originZoneId || undefined,
        destinationZoneId: destinationZoneId || undefined,
        destinationAgentId: deliveryMode === 'AGENT' ? (destinationAgentId || undefined) : undefined,
        declaredValueKes: declaredValueNum || undefined,
        coverageTierId: coverageTierId || undefined,
      });
      if (mine !== seq.current) return;
      setQuoteLoading(false);
      if (res.ok) {
        setQuote(res.data);
        setError(null);
      } else {
        setQuote(null);
        setError(res.error);
      }
    })();
  }, [parcelType, originZoneId, destinationZoneId, deliveryMode, destinationAgentId, declaredValueNum, coverageTierId]);

  useEffect(() => {
    const t = setTimeout(refreshQuote, 250);
    return () => clearTimeout(t);
  }, [refreshQuote]);

  // Poll while a real Daraja callback is in flight — console/sandbox
  // auto-confirm never reaches 'waiting' at all. Same shape as ticket
  // checkout's poll.
  useEffect(() => {
    if (stage !== 'waiting' || !code) return;
    const t = setInterval(async () => {
      const res = await actionCheckParcelStatus(code);
      if (res && res.status !== 'DRAFT_PENDING_PAYMENT') setStage('success');
    }, 4000);
    return () => clearInterval(t);
  }, [stage, code]);

  // Exact cents. `base.minKes * (1 - pct / 100)` is the same expression
  // that drifted on the Go and Dart sides — 51 at 5% gives
  // 48.449999999999996, not 48.45 — and this is the price the sender is
  // then charged. Deriving the discount and subtracting it keeps the
  // result on a cent.
  function priceForReason(base: ParcelPricingView, reason: BargainReasonView): Cents {
    let pct = base.bargainMinPct + reason.extraDiscountPct;
    if (pct > base.bargainMaxPct) pct = base.bargainMaxPct;
    const min = toCentsOrZero(base.minKes);
    return subCents(min, percentOfCents(min, pct));
  }

  const payableKes: Cents = quote
    ? (selectedReason ? priceForReason(quote, selectedReason) : toCentsOrZero(quote.minKes))
    : ZERO_CENTS;

  function goToDetails() {
    const errs: Record<string, string> = {};
    if (!originLabel.trim()) errs.origin = 'Where is it being collected from?';
    if (!destinationLabel.trim()) errs.destination = 'Where is it going?';
    if (deliveryMode === 'AGENT' && !destinationAgentId) errs.agent = 'Choose a pickup point';
    if (originMethod === 'SELF_DROPOFF' && !dropoffStationId) errs.station = 'Choose which station you’re dropping this off at';
    if (declaredValueNum > 0 && !coverageTierId) errs.cover = 'Pick a cover level, or clear the value';
    if (coverageTierId && declaredValueNum <= 0) errs.value = 'Say what the contents are worth';
    if (useCod && codAmountNum <= 0) errs.cod = 'Say what your buyer owes for the goods';
    // Compared in cents on both sides: a COD amount exactly equal to the
    // cap must be accepted, and a float comparison against the policy
    // ceiling is the kind of thing that rejects it by a hair.
    if (useCod && toCentsOrZero(codAmount) > toCentsOrZero(codPolicy.maxAmountKes)) {
      errs.cod = `The most we'll collect on one parcel is KES ${displayKES(codPolicy.maxAmountKes)}`;
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setPayMsisdn(senderMsisdn);
    setStage('details');
  }

  /**
   * The one and only write. Books, prices and charges in sequence — so
   * a sender who changes their mind at the quote stage leaves nothing
   * behind, which is the entire reason this form was restructured.
   */
  function bookAndPay() {
    const errs: Record<string, string> = {};
    if (!senderName.trim()) errs.senderName = 'We need your name';
    if (!senderMsisdn.trim()) errs.senderMsisdn = 'We need your phone number';
    if (!receiverName.trim()) errs.receiverName = "We need the receiver's name";
    if (!receiverMsisdn.trim()) errs.receiverMsisdn = "We need the receiver's phone number";
    if (!isSelfDropoff && !useCod && !payMsisdn.trim()) errs.payMsisdn = 'Which number is paying?';
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0 || (!isSelfDropoff && !quote)) return;

    setError(null);
    start(async () => {
      const booked = await actionBookParcel({
        senderName, senderMsisdn, receiverName, receiverMsisdn,
        originLabel, destinationLabel, parcelType,
        weightKg: weightKg ? Number(weightKg) : undefined, fragile, notes,
        originZoneId: originZoneId || undefined,
        destinationZoneId: destinationZoneId || undefined,
        destinationAgentId: deliveryMode === 'AGENT' ? (destinationAgentId || undefined) : undefined,
        declaredValueKes: isSelfDropoff ? undefined : (declaredValueNum || undefined),
        coverageTierId: isSelfDropoff ? undefined : (coverageTierId || undefined),
        originMethod,
        parcelOrgId: isSelfDropoff ? dropoffStationId : undefined,
        payAtCounter: isSelfDropoff,
      });
      if (!booked.ok) { setError(booked.error); return; }
      setCode(booked.code);
      setDeliveryCode(booked.deliveryCode);

      // Pilot walk-in: no price to set, nothing to charge — the fee is
      // settled in person at the counter, and the booking already
      // landed as BOOKED (see dbx.BookParcelInput.PayAtCounter).
      if (isSelfDropoff) {
        setStage('success');
        return;
      }

      // Sent as an exact decimal string; core-go's money.Amount binding
      // takes either shape.
      const priced = await actionSetParcelPrice(booked.code, toWire(payableKes), selectedReason?.reason);
      if (!priced.ok) { setError(priced.error); return; }

      setFinalPriceKes(payableKes);

      // COD skips payment entirely — the money arrives at the door, so
      // there is no STK push to start and nothing to poll for.
      if (useCod) {
        const cod = await actionBookParcelCod(booked.code, codAmountNum);
        if (!cod.ok) { setError(cod.error); return; }
        setStage('success');
        return;
      }

      const paid = await actionPayParcel(booked.code, payMsisdn);
      if (!paid.ok) { setError(paid.error); return; }
      setStage(paid.status === 'BOOKED' ? 'success' : 'waiting');
    });
  }

  // ── Terminal stages ─────────────────────────────────────────────────

  if (stage === 'success') {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="icbox icbox-g" style={{ margin: '0 auto 14px' }}><Icon name="check-circle" size={22} /></span>
        <h3 style={{ marginBottom: 6 }}>{isSelfDropoff ? 'Drop-off submitted' : useCod ? 'Booking confirmed' : 'Payment received'}</h3>
        {isSelfDropoff ? (
          // Deliberately no code shown here, and none sent — a tracking
          // number and a delivery code are only issued once the station
          // actually has the box in hand and says so (see the front
          // desk's "Confirm receipt"), not the moment someone merely
          // says they're bringing one in. Until then this is a request,
          // not yet a trackable parcel.
          <>
            <p className="sub" style={{ margin: '0 0 14px' }}>
              {`We've told ${chosenStation?.name ?? 'the station'} to expect you.`}
            </p>
            <div style={{ textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: 14 }}>
              <p className="sub" style={{ margin: 0, fontSize: '.85rem' }}>
                {`Nothing to pay online — settle the fee at ${chosenStation?.name ?? 'the station'} when you drop this off. Your tracking code and ${receiverName}'s delivery code are issued the moment the station confirms they have it in hand, not before — you'll both get a text then.`}
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="sub" style={{ margin: '0 0 18px' }}>
              Parcel <span className="mono" style={{ fontWeight: 700 }}>{code}</span>
              {finalPriceKes != null && <> · KES {Math.round(finalPriceKes).toLocaleString('en-KE')}</>}
            </p>
            <div style={{ textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <p className="sub" style={{ margin: '0 0 4px', fontSize: '.8rem' }}>Delivery code — for your receiver</p>
              <p className="mono" style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, letterSpacing: '.06em' }}>{deliveryCode}</p>
              <p className="sub" style={{ margin: '8px 0 0', fontSize: '.82rem' }}>
                {`We text this to ${receiverName} once a courier picks it up — they give it to the courier to receive the parcel. You can also pass it on yourself if you'd rather.`}
              </p>
            </div>
            {chosenAgent && (
              <p className="sub" style={{ fontSize: '.85rem', marginBottom: 14 }}>
                {receiverName} collects it from <strong>{chosenAgent.name}</strong> — {chosenAgent.locationHint}.
                We&apos;ll text them the moment it lands there.
              </p>
            )}
            {/* A plain anchor, not next/link: this is the same short
                tracking URL the SMS carries, and it is as likely to be
                copied or shared as it is to be clicked in place. */}
            <p className="sub" style={{ fontSize: '.85rem' }}>
              Follow it any time at <a href={`/t/${code}`}>/t/{code}</a> — we text you that link too.
            </p>
          </>
        )}
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

  // ── Stage 2: who ────────────────────────────────────────────────────

  if (stage === 'details') {
    return (
      <div className="card">
        <button type="button" className="btn btn-o btn-sm" style={{ marginBottom: 16 }}
          onClick={() => setStage('quote')}>
          <Icon name="arrow-left" size={14} />Back
        </button>

        {/* No price to show or confirm here for a walk-in drop-off — see
            isSelfDropoff's own comment. The counter prices and collects
            the fee in person once the parcel is actually in hand. */}
        {isSelfDropoff ? (
          <p className="sub" style={{ margin: '0 0 16px', fontSize: '.85rem' }}>
            Dropping off at <strong>{chosenStation?.name}</strong> — {chosenStation?.locationHint}.
            The fee is settled there, not here.
          </p>
        ) : (
          <PriceSummary
            payableKes={payableKes} quote={quote} agent={chosenAgent}
            selectedReason={selectedReason} compact
          />
        )}

        <h3 style={{ margin: '20px 0 16px' }}>Your details</h3>
        <FormRow>
          <Field id="sd-name" label="Your name" value={senderName} onChange={setSenderName} error={fieldErrors.senderName} />
          <Field id="sd-msisdn" label="Your phone" value={senderMsisdn} error={fieldErrors.senderMsisdn}
            onChange={(v) => { setSenderMsisdn(v); if (!payMsisdn) setPayMsisdn(v); }} placeholder="+2547XXXXXXXX" />
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

        {/* Nothing to pay now on a COD booking, or on a walk-in drop-off
            — asking for an M-Pesa number here would suggest otherwise
            in either case. */}
        {!useCod && !isSelfDropoff && (
          <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <Field id="pay-msisdn" label="M-Pesa number to pay from" value={payMsisdn}
              onChange={setPayMsisdn} placeholder="+2547XXXXXXXX" error={fieldErrors.payMsisdn} />
          </div>
        )}

        {error && <ErrorLine message={error} />}

        <button type="button" className="btn btn-p" style={{ width: '100%', marginTop: 18 }}
          disabled={pending || (!isSelfDropoff && !quote)} onClick={bookAndPay}>
          {pending
            ? 'Starting…'
            : isSelfDropoff
              ? 'Submit — pay at the counter'
              : useCod
                ? 'Confirm booking'
                : `Pay KES ${formatKES(payableKes)} with M-Pesa`}
        </button>
        <p className="sub" style={{ margin: '8px 0 0', fontSize: '.78rem', textAlign: 'center' }}>
          {isSelfDropoff
            ? "Nothing to pay online — settle the fee at the counter when you drop this off."
            : useCod
              ? 'Nothing to pay now — your buyer pays the rider on delivery.'
              : 'Nothing is booked until this payment goes through.'}
        </p>
      </div>
    );
  }

  // ── Stage 1: what, where, how much ──────────────────────────────────

  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>What are you sending?</h3>
      <p className="sub" style={{ margin: '0 0 16px', fontSize: '.85rem' }}>
        The price updates as you go. We only ask for names and numbers once you&apos;re happy with it.
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
            Picking hubs on both sides gives a distance-based price instead of the flat rate.
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

      {/* The cheap leg, offered as a real choice rather than buried.
          Agent collection is what makes this competitive on price, so
          the saving is stated in shillings at the point of choosing. */}
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
              subtitle={
                quote?.agentDropDiscountPct
                  ? `The receiver picks it up from a nearby shop — ${Math.round(quote.agentDropDiscountPct)}% cheaper.`
                  : 'The receiver picks it up from a nearby shop.'
              }
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
                    {toCentsOrZero(a.holdingFeeKes) > 0 ? ` (KES ${displayKES(a.holdingFeeKes)} on collection)` : ''}
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

      {/* Cover. Optional and off by default — a sender who doesn't want
          it should never have to dismiss anything, and a sender sending
          something valuable should not have to discover afterwards that
          nobody was carrying the risk. */}
      {tiers.length > 0 && !isSelfDropoff && (
        <>
          <h3 style={{ margin: '22px 0 4px' }}>Cover (optional)</h3>
          <p className="sub" style={{ margin: '0 0 12px', fontSize: '.85rem' }}>
            Tell us what the contents are worth and we&apos;ll cover them if something goes wrong.
          </p>
          <Field id="declared-value" label="What are the contents worth? (KES)" value={declaredValue}
            onChange={(v) => {
              const next = v.replace(/[^\d]/g, '');
              setDeclaredValue(next);
              if (!next) setCoverageTierId('');
            }}
            placeholder="e.g. 8000" error={fieldErrors.value} />
          {declaredValueNum > 0 && (
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              <ChoiceCard
                selected={!coverageTierId}
                onClick={() => setCoverageTierId('')}
                title="No cover"
                subtitle="Standard care, no payout if something goes wrong."
                trailing="KES 0"
              />
              {tiers.map((t) => (
                <ChoiceCard
                  key={t.id}
                  selected={coverageTierId === t.id}
                  onClick={() => setCoverageTierId(t.id)}
                  title={t.name}
                  subtitle={
                    t.capsDeclaredAmount
                      ? `Covers up to KES ${displayKES(t.coveredAmountKes)} of the KES ${declaredValueNum.toLocaleString('en-KE')} you declared`
                      : `Covers the full KES ${displayKES(t.coveredAmountKes)}`
                  }
                  trailing={toCentsOrZero(t.feeForValueKes) > 0 ? `+KES ${displayKES(t.feeForValueKes)}` : 'Free'}
                />
              ))}
              {fieldErrors.cover && <ErrorLine message={fieldErrors.cover} />}
            </div>
          )}
        </>
      )}

      {/* Cash on delivery — the arrangement social-commerce sellers
          actually run on, and the reason they pick one courier over
          another. Offered only when an admin has switched it on. */}
      {codPolicy.enabled && !isSelfDropoff && (
        <>
          <h3 style={{ margin: '22px 0 4px' }}>How do you get paid?</h3>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <ChoiceCard
              selected={!useCod}
              onClick={() => { setUseCod(false); setCodAmount(''); }}
              title="Your buyer has already paid you"
              subtitle="You pay the delivery fee now and we take it from there."
            />
            <ChoiceCard
              selected={useCod}
              onClick={() => setUseCod(true)}
              title="Collect cash from my buyer on delivery"
              subtitle="The rider collects the goods money and the delivery fee at the door. We settle the goods money to you."
            />
          </div>
          {useCod && (
            <div style={{ marginTop: 12 }}>
              <Field
                id="cod-amount"
                label="What does your buyer owe you for the goods? (KES)"
                value={codAmount}
                onChange={(v) => setCodAmount(v.replace(/[^\d]/g, ''))}
                placeholder="e.g. 2500"
                error={fieldErrors.cod}
              />
              {codAmountNum > 0 && quote && (
                <div style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
                  {/* Every number a seller needs to decide, before they
                      decide — not discovered at settlement. */}
                  <Row label="Your buyer pays the rider"
                    value={`KES ${Math.round(codAmountNum + payableKes).toLocaleString('en-KE')}`} />
                  <Row label="Delivery fee (kept by Esoqo)"
                    value={`KES ${Math.round(payableKes).toLocaleString('en-KE')}`} />
                  <Row label={`Handling fee (${codPolicy.handlingFeePct}%)`}
                    value={`KES ${Math.round(codAmountNum * codPolicy.handlingFeePct / 100).toLocaleString('en-KE')}`} />
                  <Row
                    label="You receive"
                    strong
                    value={`KES ${Math.round(codAmountNum - codAmountNum * codPolicy.handlingFeePct / 100).toLocaleString('en-KE')}`}
                  />
                  <p className="sub" style={{ margin: '8px 0 0', fontSize: '.78rem' }}>
                    We text you when your buyer pays, and again when the money is sent to you.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* The bargain engine — kept, and moved forward. No competitor in
          this market lets a sender name a price, so it belongs where
          the sender is deciding, not on a screen after they've committed. */}
      {!isSelfDropoff && quote && quote.bargainReasons.length > 0 && (
        <>
          <h3 style={{ margin: '22px 0 4px' }}>Make an offer</h3>
          <p className="sub" style={{ margin: '0 0 12px', fontSize: '.85rem' }}>
            Tell us something that makes this parcel easier to carry and pay less for it.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            <ChoiceCard
              selected={selectedReason === null}
              onClick={() => setSelectedReason(null)}
              title="Standard price"
              subtitle={`${quote.weightLabel} · usually KES ${displayKES(quote.minKes)}–${displayKES(quote.maxKes)}`}
              trailing={`KES ${displayKES(quote.minKes)}`}
            />
            {quote.bargainReasons.map((r) => (
              <ChoiceCard
                key={r.reason}
                selected={selectedReason?.reason === r.reason}
                onClick={() => setSelectedReason(r)}
                title={r.reason}
                subtitle={`${Math.round(r.extraDiscountPct)}% off the usual minimum`}
                trailing={`KES ${Math.round(priceForReason(quote, r))}`}
              />
            ))}
          </div>
        </>
      )}

      {/* No price to show for a walk-in drop-off — see isSelfDropoff's
          own comment. Nothing here is hidden from the sender; there is
          simply nothing priced yet to show them. */}
      {isSelfDropoff ? (
        <p className="sub" style={{ margin: '22px 0 0', fontSize: '.85rem', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          No price to show here — {chosenStation?.name ?? 'the station'} weighs it and takes payment
          when you drop it off.
        </p>
      ) : (
        <div style={{ marginTop: 22, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <PriceSummary
            payableKes={payableKes} quote={quote} agent={chosenAgent}
            selectedReason={selectedReason} loading={quoteLoading}
          />
        </div>
      )}

      {error && <ErrorLine message={error} />}

      <button type="button" className="btn btn-p" style={{ width: '100%', marginTop: 16 }}
        disabled={isSelfDropoff ? !dropoffStationId : (!quote || quoteLoading)} onClick={goToDetails}>
        Continue
      </button>
    </div>
  );
}

/** The running total, broken down. Shown on both stages so the number
 *  never changes shape between deciding and paying. */
function PriceSummary(
  { payableKes, quote, agent, selectedReason, loading, compact }:
  {
    payableKes: number; quote: (ParcelPricingView & { distanceKm?: number }) | null;
    agent: ParcelAgentView | null; selectedReason: BargainReasonView | null;
    loading?: boolean; compact?: boolean;
  },
) {
  if (!quote) {
    return <p className="sub" style={{ margin: 0 }}>{loading ? 'Working out a price…' : 'Fill in the details above for a price.'}</p>;
  }
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="sub">{compact ? 'You pay' : 'Total to pay now'}</span>
        <span className="mono" style={{ fontSize: compact ? '1.1rem' : '1.5rem', fontWeight: 800, opacity: loading ? 0.5 : 1 }}>
          KES {Math.round(payableKes).toLocaleString('en-KE')}
        </span>
      </div>
      <ul className="sub" style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: '.8rem', display: 'grid', gap: 3 }}>
        <li>{quote.weightLabel}</li>
        {quote.distanceKm != null && <li>{quote.distanceKm.toFixed(1)} km between the hubs you picked</li>}
        {agent && <li>Collected from {agent.name}{quote.agentDropDiscountPct ? ` — ${Math.round(quote.agentDropDiscountPct)}% off for pickup` : ''}</li>}
        {toCentsOrZero(quote.coverageFeeKes) > 0 ? <li>Includes KES {displayKES(quote.coverageFeeKes)} cover</li> : null}
        {selectedReason && <li>Your offer: {selectedReason.reason}</li>}
      </ul>
      {agent && toCentsOrZero(agent.holdingFeeKes) > 0 && (
        <p className="sub" style={{ margin: '8px 0 0', fontSize: '.78rem' }}>
          The receiver pays KES {displayKES(agent.holdingFeeKes)} to the shop on collection.
        </p>
      )}
    </div>
  );
}

/** One line of a money breakdown. Its own component because the COD
 *  panel's whole job is showing a seller every number before they
 *  commit, and a breakdown that doesn't line up reads as evasive. */
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
      <span className="sub" style={{ fontSize: '.82rem' }}>{label}</span>
      <span className="mono" style={{ fontWeight: strong ? 800 : 500, fontSize: '.85rem' }}>{value}</span>
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

/** One selectable option card — delivery mode, cover level, price
 *  offer. Same shape in all three places so a choice always looks like
 *  a choice. */
function ChoiceCard(
  { title, subtitle, trailing, selected, onClick }:
  { title: string; subtitle: string; trailing?: string; selected: boolean; onClick: () => void },
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
      {trailing && <span className="mono" style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{trailing}</span>}
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
