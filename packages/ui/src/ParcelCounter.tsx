'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { dropPointFor, PrintableLabel, PrintStyles } from './ParcelLabel';
import {
  flushQueue, listQueued, offlineSupported, queueBooking, type QueuedBooking,
} from './parcelOfflineQueue';
import type {
  CounterActions, CounterBookInput, CounterLabelInfo, CounterLinks,
  CounterParcelRef, CounterPartyOption, CounterPricingOption,
} from './ParcelCounterTypes';

/**
 * The Counter — taking a parcel in over a desk.
 *
 * One view, not a wizard, but also not one long page: the resting state
 * is just the scan bar and two quick actions, and the Who/What/Measure
 * fields live in a dialog that opens the moment there is something to
 * fill in. A clerk between customers sees a short page, not a form they
 * have to scroll past. Counter work is measured in seconds per customer
 * and every route transition is a stall — which is also why the scan
 * field holds focus from mount and a handheld scanner (which is just a
 * keyboard that types fast and hits Enter) submits it without anyone
 * touching the mouse, straight into that dialog.
 *
 * The deeper idea: "attach info to a label" and "book a parcel" were
 * two features with two vocabularies for one physical act — a handler
 * labelling a suitcase at a bus stage and a clerk booking a paid
 * shipment are the same job, interrupted at different points. So this
 * is one form with two exits. Stopping early is a valid outcome, not an
 * abandoned draft, and whatever was filled in survives to be resumed by
 * whoever picks the box up next.
 *
 * Shared by the Esoqo console and a courier company's own portal: the
 * five server wires and three exits arrive as props, so the form never
 * knows whose desk it sits on. Each portal's stock, parties, pricing
 * and session stay server-side, behind that portal's own actions.
 */

const ITEM_TYPES = [
  'Luggage / Suitcase', 'Backpack', 'Box / Carton', 'Envelope / Document',
  'Electronics', 'Furniture',
];

/** A parcel code scanned at the counter is usually mid-flight, and the
 *  clerk explaining where it is to the person standing there reads a
 *  word, not an enum. Mirrors the dashboard's status filter labels. */
const PARCEL_STATUS_LABEL: Record<string, string> = {
  BOOKED: 'booked',
  RECEIVED_AT_COUNTER: 'at the station',
  PICKED_UP: 'picked up',
  IN_TRANSIT: 'on the way',
  FAILED_DELIVERY: 'waiting on a failed delivery call',
  HELD_AT_AGENT: 'at a pickup point',
  DELIVERED: 'delivered',
  RETURNED_TO_SENDER: 'returned to sender',
};

/** What an outer scanner can ask the booking form to do. The counter
 *  page's unified scan bar classes codes itself and, for a PKG- label
 *  (stock sticker OR an existing parcel — both are PKG-), hands the
 *  bare code here: the form's own load path already resolves blank
 *  label → book, filled → resume, spent/parcel → open. */
export type CounterFormHandle = { scan: (raw: string) => void };

export const CounterForm = forwardRef<CounterFormHandle, {
  initialCode?: string; pricing: CounterPricingOption[]; volumetricDivisor: number;
  actions: CounterActions; links: CounterLinks;
  /** Screen-reader announcements. Each portal wires its own announcer;
   *  omitted means silent (the visual state still updates). */
  announce?: (message: string, priority?: 'polite' | 'assertive') => void;
  /** Company name/logo for the label printed when a booking completes —
   *  the sender is standing there with the box, so the sticker goes on
   *  now. Omitted (Esoqo labelling alone) when the portal has none. */
  orgName?: string;
  orgLogoUrl?: string;
  /** Hides the form's own label-code box. A portal that already has a
   *  unified scanner above this form (the company counter page) calls
   *  this form's scan() through its ref instead — one box on the page,
   *  not two. Defaults to showing the box. */
  scanbox?: boolean;
}>(function CounterForm({ initialCode, pricing, volumetricDivisor, actions, links, announce, orgName, orgLogoUrl, scanbox = true }, ref) {
  const say = announce ?? (() => {});
  const [code, setCode] = useState(initialCode ?? '');
  const [loadedCode, setLoadedCode] = useState<string | null>(null);
  // When the scanned code turned out to be an existing parcel rather
  // than a label. The dead-end becomes a door: the counter shows what
  // the code IS and where it leads, instead of just refusing it.
  const [parcelRef, setParcelRef] = useState<CounterParcelRef | null>(null);
  // QR signature for the label printed on booking completion, resolved
  // in the background like the front desk's receipt label so the print
  // stays genuine (see the done card below).
  const [doneSig, setDoneSig] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; kind: 'booked' | 'held' | 'queued' } | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether the Who/What/Measure dialog is open. A fresh scan of a
  // blank/held label opens it automatically; so does the "New booking"
  // quick action. Cancelling it just hides it again — whatever was
  // typed, and any loaded label, is still there to resume.
  const [composing, setComposing] = useState(false);
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

  // Counter fare collection on booking completion
  const [payMethod, setPayMethod] = useState<'CASH' | 'MPESA'>('MPESA');
  const [payAmount, setPayAmount] = useState('');
  const [payMsisdn, setPayMsisdn] = useState('');
  const [payWaiting, setPayWaiting] = useState(false);
  const [payChecking, setPayChecking] = useState(false);
  const [payCancelling, setPayCancelling] = useState(false);
  const [payProviderStatus, setPayProviderStatus] = useState<string | null>(null);
  const [paySettled, setPaySettled] = useState<{ method: string; amount: number; receipt?: string | null } | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [paySkipped, setPaySkipped] = useState(false);
  const [payManualCode, setPayManualCode] = useState('');
  const [showManualCode, setShowManualCode] = useState(false);
  const [payManualBusy, setPayManualBusy] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (scanbox !== false && !initialCode) scanRef.current?.focus(); }, [initialCode, scanbox]);

  const load = useCallback(async (raw: string) => {
    const target = extractCode(raw);
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
      setParcelRef(null);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    const result = await actions.getLabelInfo(target);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setLoadedCode(null);
      setParcelRef(null);
      return;
    }
    setCode(target);
    // The code resolved to a parcel already — one box, every purpose:
    // this is what "open the parcel, don't error" looks like. Show what
    // the code IS and where it leads, and never let it be re-booked or
    // saved to: it is already spent.
    if (result.parcel) {
      setParcelRef(result.parcel);
      setLoadedCode(null);
      setComposing(false);
      setNotice(
        `${target} is already ${PARCEL_STATUS_LABEL[result.parcel.status] ?? 'booked'}. ` +
        `Open it to track — or scan a blank label to book the next one.`,
      );
      say(`Already a parcel — ${target}`, 'polite');
      return;
    }
    setParcelRef(null);
    setLoadedCode(target);
    const info = result.info;
    if (!info) {
      setNotice(`${target} is a blank label. Fill it in below.`);
      setComposing(true);
      say(`Loaded ${target}`, 'polite');
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
    setReceiverName(info.receiverName ?? '');
    setReceiverMsisdn(info.receiverMsisdn ?? '');
    setItemType(info.itemType ?? '');
    setLengthCm(info.lengthCm != null ? String(info.lengthCm) : '');
    setWidthCm(info.widthCm != null ? String(info.widthCm) : '');
    setHeightCm(info.heightCm != null ? String(info.heightCm) : '');
    setComposing(true);
    say(`Loaded ${target}`, 'polite');
  }, [actions, say]);

  // What an outer unified scanner calls instead of its own label box:
  // behaviour is exactly "typed into the box, pressed Load".
  useImperativeHandle(ref, () => ({ scan: (raw) => void load(raw) }), [load]);

  useEffect(() => { if (initialCode) void load(initialCode); }, [initialCode, load]);

  // The counter's last job for a box just booked is the label on it —
  // the sender is standing there. Resolve the QR signature in the
  // background so that print is genuine, exactly as the front desk's
  // just-received label does it. No sig wire → prints unverified,
  // which still scans (see PrintableLabel).
  useEffect(() => {
    if (!done || done.kind !== 'booked' || !actions.getLabelSig) return;
    let alive = true;
    void actions.getLabelSig(done.code)
      .then((sig) => { if (alive) setDoneSig(sig); })
      .catch(() => {});
    return () => { alive = false; };
  }, [done, actions]);

  // STK payment prompt polling loop (queries Co-op STK enquiry via getSettlementStatus)
  useEffect(() => {
    if (!payWaiting || !done || done.kind !== 'booked' || !actions.getSettlementStatus || paySettled) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || !done.code || !actions.getSettlementStatus) return;
      try {
        const res = await actions.getSettlementStatus(done.code);
        if (cancelled) return;
        if (res.ok) {
          const s = res.status;
          if (s.providerStatus) setPayProviderStatus(s.providerStatus);
          if (s.status === 'SETTLED') {
            setPaySettled({ method: 'M-Pesa', amount: Number(payAmount) || s.priceKes, receipt: s.mpesaReceiptCode });
            setPayWaiting(false);
            say(`M-Pesa payment confirmed for ${done.code}`, 'assertive');
            return;
          }
          if (s.status === 'NOT_STARTED') {
            setPayWaiting(false);
            setPayError('The payer declined or let the prompt expire. Send it again, or take cash.');
            return;
          }
        }
      } catch {
        // Transient network drop, continue next poll
      }
      timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [payWaiting, done, actions, paySettled, payAmount, say]);

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

  // Anything worth not losing if the clerk backs out of the dialog —
  // decides whether the idle view offers "New booking" or "Continue
  // booking" for the next tap.
  const hasDraft = Boolean(
    loadedCode || senderName.trim() || senderMsisdn.trim() || receiverName.trim() ||
    receiverMsisdn.trim() || originLabel.trim() || destinationLabel.trim() ||
    itemDescription.trim() || weightKg.trim() || lengthCm.trim(),
  );

  function detach() {
    setLoadedCode(null);
    setCode('');
    setNotice(null);
    setSenderName(''); setSenderMsisdn(''); setReceiverName(''); setReceiverMsisdn('');
    setOriginLabel(''); setDestinationLabel(''); setItemType(''); setItemDescription('');
    setWeightKg(''); setLengthCm(''); setWidthCm(''); setHeightCm('');
    setDeclaredValue(''); setParcelType(''); setContentsDeclared(false);
    setComposing(false);
  }

  function labelInfo(): CounterLabelInfo & { itemDescription: string } {
    return {
      itemDescription: itemDescription.trim(),
      destination: destinationLabel.trim() || undefined,
      senderName: senderName.trim() || undefined,
      senderMsisdn: senderMsisdn.trim() || undefined,
      receiverName: receiverName.trim() || undefined,
      receiverMsisdn: receiverMsisdn.trim() || undefined,
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
    void actions.attachLabelInfo(loadedCode, labelInfo()).then((res) => {
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      setDone({ code: loadedCode, kind: 'held' });
      setDoneSig(undefined);
      setComposing(false);
      say(`Saved ${loadedCode}`, 'assertive');
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
    const input: CounterBookInput = {
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
    void actions.bookParcel(input).then((res) => {
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      setDone({ code: res.code, kind: 'booked' });
      setDoneSig(undefined);
      setIntakeConfirmed(false);
      setConfirmError(null);
      setComposing(false);
      // Initialize counter payment prompt
      setPayMsisdn(senderMsisdn.trim());
      setPayAmount(bracket?.minKes ? String(bracket.minKes) : '');
      setPayWaiting(false);
      setPaySettled(null);
      setPayError(null);
      setPaySkipped(false);
      say(`Booked ${res.code}`, 'assertive');
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
        setDoneSig(undefined);
        setComposing(false);
        say(`${loadedCode} held offline`, 'assertive');
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
                void actions.confirmIntake(done.code).then((res) => {
                  setConfirmingIntake(false);
                  if (!res.ok) { setConfirmError(res.error); return; }
                  setIntakeConfirmed(true);
                  say('Confirmed received — sender and receiver texted', 'assertive');
                });
              }}
            >
              {confirmingIntake ? 'Confirming…' : 'Confirm the box is here'}
            </button>
            {confirmError && <p className="sub" style={{ color: 'var(--red)', margin: '6px 0 0' }}>{confirmError}</p>}
          </div>
        )}
        {/* Payment collection for counter booking */}
        {done.kind === 'booked' && (actions.settleCash || actions.settleStk) && (
          <div style={{ marginTop: 16, marginBottom: 8, padding: 14, textAlign: 'left', background: 'var(--subtle, #f8fafc)', borderRadius: 8, border: '1.5px solid var(--line, #e2e8f0)' }}>
            {paySettled ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--green, #16a34a)', fontWeight: 600 }}>
                <Icon name="check-circle" size={20} />
                <span>
                  Fare collected ({paySettled.method} · KES {paySettled.amount.toLocaleString()}
                  {paySettled.receipt ? ` · Receipt: ${paySettled.receipt}` : ''})
                </span>
              </div>
            ) : paySkipped ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="sub" style={{ fontSize: '.88rem' }}>Payment prompt skipped — fare can be collected upon delivery / pickup.</span>
                <button type="button" className="btn btn-o btn-sm" onClick={() => setPaySkipped(false)}>
                  Collect fare now
                </button>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <strong style={{ fontSize: '.95rem' }}>Collect fare for {done.code}</strong>
                  <button
                    type="button"
                    className="btn btn-o btn-sm"
                    style={{ padding: '2px 8px', fontSize: '.8rem' }}
                    onClick={() => setPaySkipped(true)}
                  >
                    Pay on collection / Skip
                  </button>
                </div>
                {payError && (
                  <p className="sub" style={{ color: 'var(--red, #b42318)', margin: '0 0 10px', fontSize: '.85rem' }}>
                    {payError}
                  </p>
                )}
                {payWaiting ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>
                      <Icon name="info" size={14} /> Waiting for payer to approve M-Pesa prompt on their phone…
                      {payProviderStatus ? <span className="mono" style={{ marginLeft: 6 }}>({payProviderStatus})</span> : null}
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-p btn-sm"
                        disabled={payChecking || payCancelling}
                        onClick={async () => {
                          if (!done.code || !actions.getSettlementStatus) return;
                          setPayChecking(true);
                          setPayError(null);
                          try {
                            const res = await actions.getSettlementStatus(done.code, true);
                            if (res.ok) {
                              const s = res.status;
                              if (s.providerStatus) setPayProviderStatus(s.providerStatus);
                              if (s.status === 'SETTLED') {
                                setPaySettled({ method: 'M-Pesa', amount: Number(payAmount) || s.priceKes, receipt: s.mpesaReceiptCode });
                                setPayWaiting(false);
                                say(`M-Pesa payment confirmed for ${done.code}`, 'assertive');
                              } else if (s.status === 'NOT_STARTED') {
                                setPayWaiting(false);
                                setPayError('The prompt is no longer active. Send it again or take cash.');
                              }
                            } else {
                              setPayError(res.error);
                            }
                          } catch (e) {
                            setPayError(e instanceof Error ? e.message : 'Could not reach server to check status');
                          } finally {
                            setPayChecking(false);
                          }
                        }}
                      >
                        <Icon name="refresh" size={14} /> {payChecking ? 'Checking…' : 'Check payment now'}
                      </button>
                      {actions.cancelStk && (
                        <button
                          type="button"
                          className="btn btn-o btn-sm"
                          disabled={payCancelling || payChecking}
                          onClick={async () => {
                            if (!done.code || !actions.cancelStk) return;
                            setPayCancelling(true);
                            setPayError(null);
                            try {
                              const res = await actions.cancelStk(done.code);
                              if (res.ok) {
                                setPayWaiting(false);
                                setPayError('Prompt cancelled. Send a new one, or take cash.');
                              } else {
                                setPayError(res.error);
                              }
                            } catch (e) {
                              setPayError(e instanceof Error ? e.message : 'Could not cancel prompt');
                            } finally {
                              setPayCancelling(false);
                            }
                          }}
                        >
                          {payCancelling ? 'Cancelling…' : 'Cancel prompt'}
                        </button>
                      )}
                      {actions.confirmManualCode && (
                        <button
                          type="button"
                          className="btn btn-o btn-sm"
                          disabled={payCancelling || payChecking || payManualBusy}
                          onClick={() => setShowManualCode((v) => !v)}
                        >
                          Enter M-Pesa code
                        </button>
                      )}
                    </div>
                    {showManualCode && actions.confirmManualCode && (
                      <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
                        <p className="sub" style={{ margin: 0, fontSize: '.82rem' }}>
                          Payer already received the M-Pesa SMS? Enter the receipt code below:
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            className="inp mono"
                            style={{ flex: 1, minWidth: 0, textTransform: 'uppercase' }}
                            value={payManualCode}
                            onChange={(e) => setPayManualCode(e.target.value.toUpperCase())}
                            placeholder="e.g. UJ8MW98DC8"
                            aria-label="M-Pesa code from customer's SMS"
                            disabled={payManualBusy}
                          />
                          <button
                            type="button"
                            className="btn btn-p btn-sm"
                            disabled={!payManualCode.trim() || payManualBusy}
                            onClick={async () => {
                              if (!done.code || !actions.confirmManualCode || !payManualCode.trim()) return;
                              setPayManualBusy(true);
                              setPayError(null);
                              try {
                                const res = await actions.confirmManualCode(done.code, payManualCode.trim());
                                if (res.ok) {
                                  setPaySettled({
                                    method: 'M-Pesa',
                                    amount: Number(payAmount) || 0,
                                    receipt: payManualCode.trim().toUpperCase(),
                                  });
                                  setPayWaiting(false);
                                  say(`M-Pesa payment confirmed for ${done.code}`, 'assertive');
                                } else {
                                  setPayError(res.error);
                                }
                              } catch (e) {
                                setPayError(e instanceof Error ? e.message : 'Could not save M-Pesa code');
                              } finally {
                                setPayManualBusy(false);
                              }
                            }}
                          >
                            {payManualBusy ? 'Saving…' : 'Use this code'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 16 }}>
                      {actions.settleCash && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.88rem', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="ctr-pay-method"
                            checked={payMethod === 'CASH'}
                            onChange={() => setPayMethod('CASH')}
                            disabled={payBusy}
                          />
                          Cash
                        </label>
                      )}
                      {actions.settleStk && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.88rem', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="ctr-pay-method"
                            checked={payMethod === 'MPESA'}
                            onChange={() => setPayMethod('MPESA')}
                            disabled={payBusy}
                          />
                          M-Pesa STK prompt
                        </label>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 130px' }}>
                        <input
                          className="mono"
                          style={{ width: '100%', padding: '6px 10px', border: '1.5px solid var(--line, #cbd5e1)', borderRadius: 6 }}
                          value={payAmount}
                          placeholder="Amount (KES)"
                          inputMode="decimal"
                          disabled={payBusy}
                          onChange={(e) => setPayAmount(e.target.value.replace(/[^\d.]/g, ''))}
                        />
                      </div>
                      {payMethod === 'MPESA' && (
                        <div style={{ flex: '1 1 160px' }}>
                          <input
                            className="mono"
                            style={{ width: '100%', padding: '6px 10px', border: '1.5px solid var(--line, #cbd5e1)', borderRadius: 6 }}
                            value={payMsisdn}
                            placeholder="M-Pesa phone (07…)"
                            inputMode="tel"
                            disabled={payBusy}
                            onChange={(e) => setPayMsisdn(e.target.value)}
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-p btn-sm"
                        disabled={payBusy}
                        onClick={async () => {
                          const amt = Number(payAmount);
                          if (!amt || amt <= 0) { setPayError('Enter the fare amount'); return; }
                          setPayBusy(true); setPayError(null);
                          try {
                            if (payMethod === 'CASH') {
                              if (!actions.settleCash) return;
                              const res = await actions.settleCash(done.code, amt);
                              if (!res.ok) { setPayError(res.error); return; }
                              setPaySettled({ method: 'Cash', amount: amt });
                              say(`Payment of ${amt} recorded for ${done.code}`, 'assertive');
                            } else {
                              if (!actions.settleStk) return;
                              const phone = payMsisdn.trim();
                              if (!phone) { setPayError('Enter the phone number to charge'); return; }
                              const res = await actions.settleStk(done.code, amt, phone);
                              if (!res.ok) { setPayError(res.error); return; }
                              if (res.status === 'SETTLED') {
                                setPaySettled({ method: 'M-Pesa', amount: amt });
                                say(`M-Pesa payment confirmed for ${done.code}`, 'assertive');
                              } else {
                                setPayWaiting(true);
                              }
                            }
                          } catch (e) {
                            setPayError(e instanceof Error ? e.message : 'Payment request failed');
                          } finally {
                            setPayBusy(false);
                          }
                        }}
                      >
                        {payBusy ? 'Processing…' : payMethod === 'CASH' ? 'Record cash payment' : 'Send M-Pesa prompt'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* The label a counter booking ends on: the sender is standing
            there with a box that has no sticker on it yet, so the print
            happens at this desk the moment the booking lands. The
            signature arrives in the background (see the effect above),
            so a fast clerk isn't sent to the printer before it's
            genuine. */}
        {done.kind === 'booked' && (
          <div className="print-modal-escape" style={{ marginTop: 16 }}>
            {/* route: the drop point, from what the clerk just typed into
                "To". This label goes straight onto a box that will be
                sorted by people without scanners, and the destination was
                sitting in this form's own state the whole time — it just
                never reached the sticker. dropPointFor keeps it to the
                locality, so a free-text address never prints large on
                something that rides in the open. */}
            <PrintableLabel
              code={done.code}
              sig={doneSig}
              route={dropPointFor(destinationLabel)}
              orgName={orgName}
              orgLogoUrl={orgLogoUrl}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          {/* The counter's real loop is one customer after another, so
              the prominent action is "next", not "go look at what you
              just did". */}
          <a className="btn btn-p btn-sm" href={links.nextHref}>Next customer</a>
          {done.kind === 'booked' && (
            <button className="btn btn-o btn-sm" type="button" onClick={() => window.print()}>
              <Icon name="print" size={13} />Print label
            </button>
          )}
          <a className="btn btn-o btn-sm" href={links.parcelHref(done.code)}>
            Open parcel
          </a>
        </div>
        <PrintStyles />
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <PendingSync book={actions.bookParcel} say={say} />
      {/* ── Scan ─────────────────────────────────────────────── */}
      {/* Hidden when a unified scanner above this form already owns
          scanning (see the scanbox prop): the same load path still runs
          through the ref's scan(), and the feedback below (parcel
          notice, idle state) says what came in. This bar is the whole
          resting page — a scanner gun is a keyboard that types fast and
          hits Enter, so the fastest path from box to booking is never
          more than this one field away. */}
      {scanbox !== false && (
      <form onSubmit={(e) => { e.preventDefault(); void load(code); }} className="ctr-scan" style={{ marginBottom: 14 }}>
        <input
          ref={scanRef} className="mono" value={code}
          onChange={(e) => { setCode(e.target.value); setLoadedCode(null); setParcelRef(null); }}
          placeholder="Scan the label, or type PKG-XXXXXX"
          aria-label="Label code"
          autoComplete="off" spellCheck={false}
        />
        <button className="btn btn-o btn-sm" type="submit" disabled={loading}>
          {loading ? 'Checking…' : 'Load'}
        </button>
      </form>
      )}

      {/* A scanned code that turned out to be an existing parcel: the
          chain says what it is and the action is the door — "open the
          parcel" instead of a refusal. */}
      {parcelRef && (
        <div className="chain" style={{ marginBottom: 12 }}>
          <Icon name="box" size={16} />
          <span style={{ flex: 1 }}>{notice}</span>
          <a className="btn btn-o btn-sm" href={links.parcelHref(parcelRef.code)}>Open parcel</a>
        </div>
      )}

      {/* Scan-syntax errors ("printed outside Esoqo") happen before the
          dialog ever opens, so they surface right here — not buried
          behind a modal the clerk hasn't opened yet. */}
      {!composing && error && (
        /printed outside Esoqo|Only Esoqo PKG/i.test(error) ? (
          <div role="alert" className="chain bad" style={{ marginBottom: 12 }}>
            <span>{error}</span>
            <a className="btn btn-o btn-sm" href={links.labelsHref} style={{ marginLeft: 8 }}>
              Print a fresh label
            </a>
          </div>
        ) : (
          <p role="alert" style={{ color: 'var(--red)', margin: '0 0 12px' }}>{error}</p>
        )
      )}

      {/* The idle state — everything between customers. Two quick
          actions and nothing to scroll past: the Who/What/Measure
          fields only exist once there's something to put in them. */}
      {!parcelRef && !composing && (
        <div className="ctr-empty">
          <Icon name={loadedCode ? 'qr' : 'package'} size={28} />
          <h3>{loadedCode ? `${loadedCode} loaded` : hasDraft ? 'Booking in progress' : 'Ready for the next customer'}</h3>
          <p>
            {loadedCode
              ? notice ?? 'Scanned and ready — continue to fill in the details.'
              : hasDraft
                ? 'Pick up where you left off, or clear it and start over.'
                : 'Scan a pre-printed label above, or start a booking without one.'}
          </p>
          <div className="ctr-empty-actions">
            <button type="button" className="btn btn-p btn-sm" onClick={() => setComposing(true)}>
              {loadedCode || hasDraft ? 'Continue booking' : 'New booking'}
            </button>
            {hasDraft && (
              <button type="button" className="btn btn-o btn-sm" onClick={detach}>
                <Icon name="close" size={12} />{loadedCode ? 'Detach label' : 'Clear'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Who / What / Measure ─────────────────────────────── */}
      {/* Pulled into a dialog rather than stacked on the page: the
          resting page above stays short, and everything a clerk needs
          to finish this one booking — fields through to Book — is in
          one place they don't have to scroll to find. */}
      {composing && (
        <Modal
          title={loadedCode ? `Booking — ${loadedCode}` : 'New booking'}
          subtitle={!parcelRef && notice ? notice : undefined}
          size="lg"
          onClose={() => setComposing(false)}
          footer={(
            <>
              <button className="btn btn-p btn-sm" disabled={busy} onClick={book}>
                {busy ? 'Working…' : 'Book parcel'}
              </button>
              {/* The early exit. Only offered when there's a label to
                  hold it against — without a code there is nowhere for
                  a partial record to live. */}
              {loadedCode && (
                <button className="btn btn-o btn-sm" disabled={busy} onClick={holdAsLabel}>
                  Save to label only
                </button>
              )}
              <button className="btn btn-o btn-sm" disabled={busy} onClick={() => setComposing(false)}>
                Cancel
              </button>
              <span className="sub" style={{ fontSize: '.78rem', marginLeft: 'auto' }}>
                Creates a draft — price and payment come next.
              </span>
            </>
          )}
        >
          {loadedCode && (
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 14px' }}>
              <span className="pill p-info"><Icon name="qr" size={12} />{loadedCode}</span>
              <span className="sub" style={{ fontSize: '.8rem' }}>booking will be bound to this sticker</span>
              <button type="button" className="btn btn-o btn-sm" onClick={detach}>
                <Icon name="close" size={12} />Detach
              </button>
            </div>
          )}

          <Section title="Who">
            <Row>
              <PartyField
                label="Sender" name={senderName} msisdn={senderMsisdn}
                onName={setSenderName} onMsisdn={setSenderMsisdn}
                search={actions.searchParties}
              />
            </Row>
            <Row>
              <PartyField
                label="Receiver" name={receiverName} msisdn={receiverMsisdn}
                onName={setReceiverName} onMsisdn={setReceiverMsisdn}
                search={actions.searchParties}
              />
            </Row>
            <Row>
              <Field label="From" value={originLabel} onChange={setOriginLabel} placeholder="e.g. Kisumu" />
              <Field label="To" value={destinationLabel} onChange={setDestinationLabel} placeholder="e.g. Westlands, Nairobi" />
            </Row>
          </Section>

          <Section title="What">
            <Row>
              <label className="sub" style={{ flex: 1, minWidth: 140 }}>Item type
                <select value={itemType} onChange={(e) => setItemType(e.target.value)} style={INPUT}>
                  <option value="">—</option>
                  {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <Field label="Description" value={itemDescription} onChange={setItemDescription} placeholder="e.g. flat-pack shelf unit" />
            </Row>
          </Section>

          <Section title="Measure">
            {/* The rate card in one glance. A clerk who can see the
                whole ladder — and which rung the box is climbing — can
                quote before the numbers are in, and explain a jump
                without sending the customer off to read terms. */}
            {pricing.length > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {pricing.map((p) => {
                  const chosen = effectiveType === p.parcelType;
                  return (
                    <span
                      key={p.parcelType}
                      className={chosen ? 'pill p-info' : 'pill p-mute'}
                      title={`${p.minWeightKg}–${p.maxWeightKg}kg — this is what ${p.weightLabel.toLowerCase()} charges`}
                    >
                      {p.weightLabel}: KES {p.minKes}–{p.maxKes}
                    </span>
                  );
                })}
              </div>
            )}
            <Row>
              <Field label="Weight (kg)" value={weightKg} onChange={setWeightKg} placeholder="0.0" type="number" />
              <Field label="Length (cm)" value={lengthCm} onChange={setLengthCm} placeholder="0" type="number" />
              <Field label="Width (cm)" value={widthCm} onChange={setWidthCm} placeholder="0" type="number" />
              <Field label="Height (cm)" value={heightCm} onChange={setHeightCm} placeholder="0" type="number" />
            </Row>
            {/* Shown, never silent. A clerk who can see *why* the price
                moved can explain it to the person holding the box; one
                who only sees a bigger number will assume the system is
                wrong and argue with it. */}
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
              <label className="sub" style={{ flex: 1, minWidth: 140 }}>Weight bracket
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

          {/* A positive affirmation, recorded against the clerk who
              made it — see the intake migration on why this is a
              person and a time rather than a boolean. */}
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '4px 0 0' }}>
            <input type="checkbox" checked={contentsDeclared} onChange={(e) => setContentsDeclared(e.target.checked)}
              style={{ marginTop: 3 }} />
            <span className="sub">
              I asked the sender about prohibited items and they confirmed there are none.
              This is recorded against your account.
            </span>
          </label>

          {error && (
            /printed outside Esoqo|Only Esoqo PKG/i.test(error) ? (
              <div role="alert" className="chain bad" style={{ marginTop: 14 }}>
                <span>{error}</span>
                <a className="btn btn-o btn-sm" href={links.labelsHref} style={{ marginLeft: 8 }}>
                  Print a fresh label
                </a>
              </div>
            ) : (
              <p role="alert" style={{ color: 'var(--red)', margin: '14px 0 0' }}>{error}</p>
            )
          )}
        </Modal>
      )}
    </div>
  );
});

/** What the scan box holds, normalised — the same contract as
 *  @esoqo/domain's extractParcelCode (URL last-segment, else the
 *  upper-cased entry; empty in, empty out), kept local so this
 *  component's only cross-package wire is its props. */
function extractCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const segments = new URL(trimmed).pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) return decodeURIComponent(last).trim().toUpperCase();
      return '';
    } catch {
      // Not parseable after all — fall through to the bare-code path.
    }
  }
  return trimmed.toUpperCase();
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
function PendingSync({ book, say }: { book: CounterActions['bookParcel']; say: (message: string, priority?: 'polite' | 'assertive') => void }) {
  const [pending, setPending] = useState<QueuedBooking[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setPending(await listQueued());
  }, []);

  const flush = useCallback(async () => {
    if (!offlineSupported()) return;
    const queued = await listQueued();
    if (queued.length === 0) { setPending([]); return; }
    setSyncing(true);
    const result = await flushQueue(book);
    setSyncing(false);
    await refresh();
    if (result.synced.length > 0) {
      say(`${result.synced.length} offline booking${result.synced.length === 1 ? '' : 's'} sent`, 'polite');
    }
  }, [book, refresh, say]);

  useEffect(() => {
    void flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);

  useEffect(() => { void refresh(); }, [refresh]);

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
function bracketFor(pricing: CounterPricingOption[], kg: number): CounterPricingOption | undefined {
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
  return <div className="ctr-grid" style={{ marginBottom: 8 }}>{children}</div>;
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
  label, name, msisdn, onName, onMsisdn, search,
}: {
  label: string; name: string; msisdn: string;
  onName: (v: string) => void; onMsisdn: (v: string) => void;
  search: (q: string) => Promise<CounterPartyOption[]>;
}) {
  const [matches, setMatches] = useState<CounterPartyOption[]>([]);
  const [showing, setShowing] = useState(false);

  async function searchParties(value: string) {
    onName(value);
    if (value.trim().length < 3) { setMatches([]); setShowing(false); return; }
    const found = await search(value);
    setMatches(found);
    setShowing(found.length > 0);
  }

  function choose(p: CounterPartyOption) {
    onName(p.name);
    onMsisdn(p.msisdn);
    setShowing(false);
  }

  return (
    <>
      <label className="sub" style={{ flex: 1, minWidth: 140, position: 'relative' }}>{label}
        <input value={name} onChange={(e) => void searchParties(e.target.value)}
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
