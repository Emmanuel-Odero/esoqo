'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { extractParcelCode } from '@esoqo/domain';
import {
  actionAttachParcelLabelInfo, actionConfirmParcelIntake, actionCounterBookParcel,
  actionGetParcelLabelInfo, actionSearchCounterParties,
  type CounterBookingInput, type CounterParty,
  type ParcelLabelInfoInput, type ParcelPricingOption,
} from '../actions';
import {
  flushQueue, listQueued, offlineSupported, queueBooking, type QueuedBooking,
} from './offline-queue';

/**
 * The Counter — taking a parcel in over a desk.
 *
 * The console could do everything to a parcel except create one. Every
 * booking in the system came through the customer-facing web flow, so a
 * clerk with a walk-in customer and a box on the desk had no screen at
 * all.
 *
 * One view, not a wizard. Counter work is measured in seconds per
 * customer and every route transition is a stall — which is also why
 * the scan field holds focus from mount and a handheld scanner (which
 * is just a keyboard that types fast and hits Enter) submits it without
 * anyone touching the mouse.
 *
 * The deeper idea: "attach info to a label" and "book a parcel" were
 * two features with two vocabularies for one physical act — a handler
 * labelling a suitcase at a bus stage and a clerk booking a paid
 * shipment are the same job, interrupted at different points. So this
 * is one form with two exits. Stopping early is a valid outcome, not an
 * abandoned draft, and whatever was filled in survives to be resumed by
 * whoever picks the box up next.
 */

const ITEM_TYPES = [
  'Luggage / Suitcase', 'Backpack', 'Box / Carton', 'Envelope / Document',
  'Electronics', 'Furniture',
];

export function CounterForm({
  initialCode, pricing, volumetricDivisor,
}: {
  initialCode?: string; pricing: ParcelPricingOption[]; volumetricDivisor: number;
}) {
  const [code, setCode] = useState(initialCode ?? '');
  const [loadedCode, setLoadedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; kind: 'booked' | 'held' | 'queued' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [intakeConfirmed, setIntakeConfirmed] = useState(false);
  const [confirmingIntake, setConfirmingIntake] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [senderName, setSenderName] = useState('');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverMsisdn, setReceiverMsisdn] = useState('');
  const [originLabel, setOriginLabel] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [itemType, setItemType] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [lengthCm, setLengthCm] = useState('');
  const [widthCm, setWidthCm] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [declaredValue, setDeclaredValue] = useState('');
  const [parcelType, setParcelType] = useState('');
  const [contentsDeclared, setContentsDeclared] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);
  const announce = useAnnounce();

  useEffect(() => { if (!initialCode) scanRef.current?.focus(); }, [initialCode]);

  const load = useCallback(async (raw: string) => {
    const target = extractParcelCode(raw);
    if (!target) return;
    // Strict PKG-only: a company self-print never verifies. Catch it
    // here for instant guidance (the server refuses it too, with
    // FOREIGN_LABEL) — the next step is a fresh Esoqo label, keeping
    // their number as the parcel's external reference if needed.
    if (!target.toUpperCase().startsWith('PKG-')) {
      setError(
        `“${raw.trim()}” looks like a label printed outside Esoqo. Only Esoqo PKG-… labels scan now — ` +
        `print a fresh label from Labels and book against that instead.`,
      );
      setLoadedCode(null);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await actionGetParcelLabelInfo(target);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setLoadedCode(null);
      return;
    }
    setCode(target);
    setLoadedCode(target);
    const info = result.info;
    if (!info) {
      setNotice(`${target} is a blank label. Fill it in below.`);
      return;
    }
    // Resuming: whatever the field already recorded is pre-filled, so a
    // clerk finishes the job rather than re-asking questions the
    // customer already answered at a bus stage.
    setNotice(`${target} already has field notes — carried over below.`);
    setItemDescription(info.itemDescription ?? '');
    setDestinationLabel(info.destination ?? '');
    setSenderName(info.senderName ?? '');
    setSenderMsisdn(info.senderMsisdn ?? '');
    setItemType(info.itemType ?? '');
    setLengthCm(info.lengthCm != null ? String(info.lengthCm) : '');
    setWidthCm(info.widthCm != null ? String(info.widthCm) : '');
    setHeightCm(info.heightCm != null ? String(info.heightCm) : '');
    announce(`Loaded ${target}`, 'polite');
  }, [announce]);

  useEffect(() => { if (initialCode) void load(initialCode); }, [initialCode, load]);

  const actual = Number(weightKg) || 0;
  const volumetric = volumetricKg(Number(lengthCm), Number(widthCm), Number(heightCm), volumetricDivisor);
  const chargeable = Math.max(actual, volumetric);
  const bulkRules = volumetric > 0 && volumetric > actual;
  const bracket = bracketFor(pricing, chargeable);

  // The bracket the measurements imply wins over a stale manual pick —
  // but only once there is something to imply it from.
  const effectiveType = parcelType || bracket?.parcelType || '';

  function numOrUndef(v: string): number | undefined {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
  }

  function labelInfo(): ParcelLabelInfoInput {
    return {
      itemDescription: itemDescription.trim(),
      destination: destinationLabel.trim() || undefined,
      senderName: senderName.trim() || undefined,
      senderMsisdn: senderMsisdn.trim() || undefined,
      itemType: itemType.trim() || undefined,
      lengthCm: numOrUndef(lengthCm),
      widthCm: numOrUndef(widthCm),
      heightCm: numOrUndef(heightCm),
    };
  }

  function holdAsLabel() {
    if (!loadedCode) { setError('Scan or enter a label code first.'); return; }
    if (!itemDescription.trim()) { setError('Say what the item is, at minimum.'); return; }
    setError(null);
    setBusy(true);
    void actionAttachParcelLabelInfo(loadedCode, labelInfo()).then((res) => {
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      setDone({ code: loadedCode, kind: 'held' });
      announce(`Saved ${loadedCode}`, 'assertive');
    });
  }

  function book() {
    const missing: string[] = [];
    if (!senderName.trim()) missing.push('sender name');
    if (!senderMsisdn.trim()) missing.push('sender phone');
    if (!receiverName.trim()) missing.push('receiver name');
    if (!receiverMsisdn.trim()) missing.push('receiver phone');
    if (!originLabel.trim()) missing.push('origin');
    if (!destinationLabel.trim()) missing.push('destination');
    if (!effectiveType) missing.push('weight bracket');
    if (missing.length > 0) {
      setError(`Still needed: ${missing.join(', ')}.`);
      return;
    }
    setError(null);
    setBusy(true);
    const input: CounterBookingInput = {
      senderName: senderName.trim(), senderMsisdn: senderMsisdn.trim(),
      receiverName: receiverName.trim(), receiverMsisdn: receiverMsisdn.trim(),
      originLabel: originLabel.trim(), destinationLabel: destinationLabel.trim(),
      parcelType: effectiveType,
      weightKg: numOrUndef(weightKg),
      lengthCm: numOrUndef(lengthCm), widthCm: numOrUndef(widthCm), heightCm: numOrUndef(heightCm),
      declaredValueKes: numOrUndef(declaredValue),
      contentsDeclared,
      existingCode: loadedCode ?? undefined,
      notes: itemDescription.trim() || undefined,
    };
    void actionCounterBookParcel(input).then((res) => {
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      setDone({ code: res.code, kind: 'booked' });
      setIntakeConfirmed(false);
      setConfirmError(null);
      announce(`Booked ${res.code}`, 'assertive');
    }).catch(async () => {
      // The network went away mid-submit. A counter cannot answer that
      // with "try again" — there is a customer and a box — so the
      // booking is held locally and sent when the connection returns.
      //
      // Only possible against a scanned label: the pre-printed code is
      // what makes a later replay safe, because core-go spends it
      // atomically and refuses the second attempt. See offline-queue.
      setBusy(false);
      if (!loadedCode || !offlineSupported()) {
        setError('No connection, and this booking has no scanned label to hold it against. Try again once you are back online.');
        return;
      }
      try {
        await queueBooking(input);
        setDone({ code: loadedCode, kind: 'queued' });
        announce(`${loadedCode} held offline`, 'assertive');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not hold that booking offline.');
      }
    });
  }

  if (done) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <Icon name="check-circle" size={34} />
        <p style={{ margin: '10px 0 2px', fontWeight: 700, fontSize: '1.1rem' }}>
          {done.kind === 'booked' ? 'Booked'
            : done.kind === 'queued' ? 'Held offline'
            : 'Saved to the label'} — <span className="mono">{done.code}</span>
        </p>
        <p className="sub" style={{ margin: 0 }}>
          {done.kind === 'booked'
            ? intakeConfirmed
              ? 'Confirmed — sender and receiver have been texted.'
              : 'Booked. Nobody has been texted yet — confirm the box is actually here to notify sender and receiver.'
            : done.kind === 'queued'
              ? 'No connection. This will be sent automatically the moment you are back online — the label is already on the box, so nothing is lost.'
              : 'No booking yet — anyone who scans this code now sees what it is.'}
        </p>
        {done.kind === 'booked' && !intakeConfirmed && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-p btn-sm"
              disabled={confirmingIntake}
              onClick={() => {
                setConfirmingIntake(true);
                setConfirmError(null);
                void actionConfirmParcelIntake(done.code).then((res) => {
                  setConfirmingIntake(false);
                  if (!res.ok) { setConfirmError(res.error); return; }
                  setIntakeConfirmed(true);
                  announce('Confirmed received — sender and receiver texted', 'assertive');
                });
              }}
            >
              {confirmingIntake ? 'Confirming…' : 'Confirm the box is here'}
            </button>
            {confirmError && <p className="sub" style={{ color: 'var(--red)', margin: '6px 0 0' }}>{confirmError}</p>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          {/* The counter's real loop is one customer after another, so
              the prominent action is "next", not "go look at what you
              just did". */}
          <Link className="btn btn-p btn-sm" href={'/parcels/counter' as Route}>Next customer</Link>
          <Link className="btn btn-o btn-sm" href={`/parcels?q=${encodeURIComponent(done.code)}` as Route}>
            Open parcel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <PendingSync />
      {/* ── Scan ─────────────────────────────────────────────── */}
      <form onSubmit={(e) => { e.preventDefault(); void load(code); }} style={{ marginBottom: 16 }}>
        <label className="sub" style={{ display: 'block' }}>Label code
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <input
              ref={scanRef} className="mono" value={code}
              onChange={(e) => { setCode(e.target.value); setLoadedCode(null); }}
              placeholder="Scan the label, or type PKG-XXXXXX"
              autoComplete="off" spellCheck={false}
              style={{ flex: 1, padding: '10px 12px', fontSize: '1.05rem', border: '1.5px solid var(--line)', borderRadius: 8 }}
            />
            <button className="btn btn-o btn-sm" type="submit" disabled={loading}>
              {loading ? 'Checking…' : 'Load'}
            </button>
          </div>
        </label>
        <p className="sub" style={{ margin: '6px 0 0', fontSize: '.8rem' }}>
          A pre-printed label ties this booking to the sticker already on the box. Leave it blank
          to mint a fresh code at the end instead.
        </p>
      </form>

      {notice && <div className="chain" style={{ marginBottom: 12 }}><Icon name="info" size={16} /><span>{notice}</span></div>}

      <Section title="Who">
        <Row>
          <PartyField
            label="Sender" name={senderName} msisdn={senderMsisdn}
            onName={setSenderName} onMsisdn={setSenderMsisdn}
          />
        </Row>
        <Row>
          <PartyField
            label="Receiver" name={receiverName} msisdn={receiverMsisdn}
            onName={setReceiverName} onMsisdn={setReceiverMsisdn}
          />
        </Row>
        <Row>
          <Field label="From" value={originLabel} onChange={setOriginLabel} placeholder="e.g. Kisumu" />
          <Field label="To" value={destinationLabel} onChange={setDestinationLabel} placeholder="e.g. Westlands, Nairobi" />
        </Row>
      </Section>

      <Section title="What">
        <Row>
          <label className="sub" style={{ flex: 1 }}>Item type
            <select value={itemType} onChange={(e) => setItemType(e.target.value)} style={INPUT}>
              <option value="">—</option>
              {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Field label="Description" value={itemDescription} onChange={setItemDescription} placeholder="e.g. flat-pack shelf unit" />
        </Row>
      </Section>

      <Section title="Measure">
        <Row>
          <Field label="Weight (kg)" value={weightKg} onChange={setWeightKg} placeholder="0.0" type="number" />
          <Field label="Length (cm)" value={lengthCm} onChange={setLengthCm} placeholder="0" type="number" />
          <Field label="Width (cm)" value={widthCm} onChange={setWidthCm} placeholder="0" type="number" />
          <Field label="Height (cm)" value={heightCm} onChange={setHeightCm} placeholder="0" type="number" />
        </Row>
        {/* Shown, never silent. A clerk who can see *why* the price
            moved can explain it to the person holding the box; one who
            only sees a bigger number will assume the system is wrong
            and argue with it. */}
        {volumetric > 0 && (
          <p className="sub" style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            {bulkRules && <Icon name="alert-triangle" size={14} />}
            Volumetric {volumetric}kg
            {bulkRules
              ? ` — bulkier than it is heavy, so it is charged as ${chargeable}kg, not ${actual || 0}kg.`
              : ` — less than its actual ${actual}kg, so weight decides the price.`}
          </p>
        )}
        <Row>
          <label className="sub" style={{ flex: 1 }}>Weight bracket
            <select value={effectiveType} onChange={(e) => setParcelType(e.target.value)} style={INPUT}>
              <option value="">—</option>
              {pricing.map((p) => (
                <option key={p.parcelType} value={p.parcelType}>
                  {p.weightLabel} ({p.minWeightKg}–{p.maxWeightKg}kg)
                </option>
              ))}
            </select>
          </label>
          <Field label="Declared value (KES)" value={declaredValue} onChange={setDeclaredValue} placeholder="0" type="number" />
        </Row>
        {bracket && !parcelType && chargeable > 0 && (
          <p className="sub" style={{ margin: '6px 0 0' }}>
            {chargeable}kg puts this in <strong>{bracket.weightLabel}</strong> — change it above if that is wrong.
          </p>
        )}
      </Section>

      {/* A positive affirmation, recorded against the clerk who made
          it — see the intake migration on why this is a person and a
          time rather than a boolean. */}
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '4px 0 16px' }}>
        <input type="checkbox" checked={contentsDeclared} onChange={(e) => setContentsDeclared(e.target.checked)}
          style={{ marginTop: 3 }} />
        <span className="sub">
          I asked the sender about prohibited items and they confirmed there are none.
          This is recorded against your account.
        </span>
      </label>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <button className="btn btn-p btn-sm" disabled={busy} onClick={book}>
          {busy ? 'Working…' : 'Book parcel'}
        </button>
        {/* The early exit. Only offered when there's a label to hold it
            against — without a code there is nowhere for a partial
            record to live. */}
        {loadedCode && (
          <button className="btn btn-o btn-sm" disabled={busy} onClick={holdAsLabel}>
            Save to label only
          </button>
        )}
        <span className="sub" style={{ fontSize: '.8rem' }}>
          Booking creates a draft — price and payment come next, as they always have.
        </span>
      </div>
      {error && (
        /printed outside Esoqo|Only Esoqo PKG/i.test(error) ? (
          <div role="alert" className="chain bad" style={{ marginTop: 10 }}>
            <span>{error}</span>
            <a className="btn btn-o btn-sm" href="/parcels/labels" style={{ marginLeft: 8 }}>
              Print a fresh label
            </a>
          </div>
        ) : (
          <p role="alert" style={{ color: 'var(--red)', margin: '10px 0 0' }}>{error}</p>
        )
      )}
    </div>
  );
}

/**
 * Anything taken in while the network was down, and its sync state.
 *
 * Visible rather than silent, because a clerk who queued eight parcels
 * this morning needs to know they actually left — an invisible queue is
 * indistinguishable from lost work, and the whole reason a counter can
 * accept an offline booking is that the clerk trusts it will arrive.
 *
 * Flushes on mount and on the browser's `online` event. No polling: the
 * event is what actually tells us the connection came back, and a timer
 * would just be a worse version of it.
 */
function PendingSync() {
  const [pending, setPending] = useState<QueuedBooking[]>([]);
  const [syncing, setSyncing] = useState(false);
  const announce = useAnnounce();

  const refresh = useCallback(async () => {
    setPending(await listQueued());
  }, []);

  const flush = useCallback(async () => {
    if (!offlineSupported()) return;
    const queued = await listQueued();
    if (queued.length === 0) { setPending([]); return; }
    setSyncing(true);
    const result = await flushQueue(actionCounterBookParcel);
    setSyncing(false);
    await refresh();
    if (result.synced.length > 0) {
      announce(`${result.synced.length} offline booking${result.synced.length === 1 ? '' : 's'} sent`, 'polite');
    }
  }, [announce, refresh]);

  useEffect(() => {
    void flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);

  if (pending.length === 0) return null;

  // Something that will not retry its way out — a voided pad, another
  // company's stock — needs a person, so it is separated from the
  // ordinary "waiting for signal" case.
  const blocked = pending.filter((p) => p.lastError);

  return (
    <div className="chain" style={{
      background: 'var(--amber-t)', border: '1px solid #E8D2A0',
      color: 'var(--amber)', marginBottom: 14,
    }}>
      <Icon name="wifi-off" size={16} />
      <span style={{ flex: 1 }}>
        {pending.length} booking{pending.length === 1 ? '' : 's'} taken in offline
        {syncing ? ' — sending now…' : ' — waiting for a connection.'}
        {blocked.length > 0 && (
          <span style={{ display: 'block', marginTop: 4 }}>
            {blocked.length} {blocked.length === 1 ? 'needs' : 'need'} attention:{' '}
            {blocked.map((b) => `${b.code} (${b.lastError})`).join('; ')}
          </span>
        )}
      </span>
      <button className="btn btn-o btn-sm" onClick={() => void flush()} disabled={syncing}>
        {syncing ? 'Sending…' : 'Retry now'}
      </button>
    </div>
  );
}

/**
 * Volumetric weight, mirroring dbx.VolumetricKg exactly — including
 * refusing to compute from a partial measurement.
 *
 * Duplicated in the client on purpose: the clerk needs the number to
 * move as they type, and a round trip per keystroke to be told what
 * arithmetic says is not worth the latency. The server remains the
 * authority — this only ever previews what it will decide.
 */
function volumetricKg(l: number, w: number, h: number, divisor: number): number {
  if (!(l > 0) || !(w > 0) || !(h > 0)) return 0;
  const d = divisor > 0 ? divisor : 5000;
  return Math.round(((l * w * h) / d) * 100) / 100;
}

/** The bracket a chargeable weight falls in, or undefined when nothing
 *  has been measured yet. */
function bracketFor(pricing: ParcelPricingOption[], kg: number): ParcelPricingOption | undefined {
  if (kg <= 0) return undefined;
  return pricing.find((p) => kg >= p.minWeightKg && kg <= p.maxWeightKg)
    // Heavier than every bracket — the largest is the honest fallback,
    // rather than showing nothing and letting the clerk guess.
    ?? [...pricing].sort((a, b) => b.maxWeightKg - a.maxWeightKg)[0];
}

const INPUT: React.CSSProperties = {
  display: 'block', width: '100%', padding: '6px 8px',
  border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <p className="l" style={{ fontFamily: 'var(--font-mono)', fontSize: '.63rem', letterSpacing: '.11em', textTransform: 'uppercase', color: 'var(--tx-2)', margin: '0 0 8px' }}>
        {title}
      </p>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>{children}</div>;
}

/**
 * A name-and-phone pair that remembers people.
 *
 * Three letters into the name and it offers anyone this network has
 * shipped to or from before, most-frequent first — a trader who ships
 * weekly outranks a one-off with a similar name. Picking one fills both
 * fields, which is the whole point: the bottleneck at a counter is not
 * the form, it's re-asking a regular customer for details they gave you
 * on Tuesday.
 *
 * Still free text underneath. A new customer must never be harder to
 * serve than a returning one, so the suggestions are an accelerator and
 * never a required choice.
 */
function PartyField({
  label, name, msisdn, onName, onMsisdn,
}: {
  label: string; name: string; msisdn: string;
  onName: (v: string) => void; onMsisdn: (v: string) => void;
}) {
  const [matches, setMatches] = useState<CounterParty[]>([]);
  const [showing, setShowing] = useState(false);

  async function search(value: string) {
    onName(value);
    if (value.trim().length < 3) { setMatches([]); setShowing(false); return; }
    const found = await actionSearchCounterParties(value);
    setMatches(found);
    setShowing(found.length > 0);
  }

  function choose(p: CounterParty) {
    onName(p.name);
    onMsisdn(p.msisdn);
    setShowing(false);
  }

  return (
    <>
      <label className="sub" style={{ flex: 1, minWidth: 140, position: 'relative' }}>{label}
        <input value={name} onChange={(e) => void search(e.target.value)}
          onBlur={() => window.setTimeout(() => setShowing(false), 150)}
          placeholder="Full name" autoComplete="off" style={INPUT} />
        {showing && (
          <div style={{
            position: 'absolute', zIndex: 5, left: 0, right: 0, background: '#fff',
            border: '1px solid var(--line)', borderRadius: 6, marginTop: 2,
            maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.08)',
          }}>
            {matches.map((p) => (
              <button
                key={p.msisdn} type="button"
                // onMouseDown, not onClick: blur fires first and would
                // close the list before a click ever landed.
                onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', background: 'none', border: 0, cursor: 'pointer' }}
              >
                {p.name}
                <span className="sub" style={{ display: 'block', fontSize: '.75rem' }}>
                  {p.msisdn} · {p.lastLabel}
                  {p.shipments > 1 && ` · ${p.shipments} parcels`}
                </span>
              </button>
            ))}
          </div>
        )}
      </label>
      <Field label={`${label} phone`} value={msisdn} onChange={onMsisdn} placeholder="07…" />
    </>
  );
}

function Field({
  label, value, onChange, placeholder, type,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="sub" style={{ flex: 1, minWidth: 140 }}>{label}
      <input type={type ?? 'text'} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} style={INPUT} />
    </label>
  );
}
