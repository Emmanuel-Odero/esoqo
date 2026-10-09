'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon, Modal } from '@esoqo/ui';
import {
  addCustomParcel,
  listOrgLabels,
  resolveOrgLabel,
  searchOrgLabels,
  settleCounterParcel,
  settleCounterParcelStk,
} from './actions';
import type { OrgLabelSearchRow } from '@/lib/parcel-org-session';
import { setFormActive } from './form-activity';
import { LabelPicker } from './LabelPicker';
import { MpesaPromptWatch } from './MpesaPromptWatch';

const PARCEL_TYPES: [value: string, label: string][] = [
  ['ENVELOPE_DOCUMENT', 'Envelope / document'],
  ['SMALL', 'Small'],
  ['MEDIUM', 'Medium'],
  ['LARGE', 'Large'],
  ['HEAVY_OVERSIZE', 'Heavy / oversize'],
];





/**
 * Add a parcel with your own number — for work that starts on paper or
 * in another book and still needs to be managed and tracked here. Your
 * number stays on the parcel and is searchable; Esoqo mints a tracking
 * code for it and shows it back so it can go on the box.
 *
 * Lives in a dialog, not stacked on the page: it's a distinct workflow
 * from desk booking (own numbering, own paper trail) and used far less
 * often, so it shouldn't cost every counter session a scroll past a
 * second full form it isn't using.
 *
 * The draft survives a dashboard refresh (see DropoffPoll): every
 * keystroke is mirrored to localStorage and restored on mount, so even
 * if the page subtree remounts under an open dialog nothing typed is
 * ever lost. A successful save or an explicit Close clears it.
 */
const DRAFT_KEY = 'parcel-org:custom-parcel-draft';

interface CustomParcelDraft {
  number: string;
  senderName: string;
  senderMsisdn: string;
  receiverName: string;
  receiverMsisdn: string;
  originLabel: string;
  destinationLabel: string;
  parcelType: string;
  weightKg: string;
  fragile: boolean;
  notes: string;
  labelCode: string;
}

function loadDraft(): CustomParcelDraft | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomParcelDraft>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      number: typeof parsed.number === 'string' ? parsed.number : '',
      senderName: typeof parsed.senderName === 'string' ? parsed.senderName : '',
      senderMsisdn: typeof parsed.senderMsisdn === 'string' ? parsed.senderMsisdn : '',
      receiverName: typeof parsed.receiverName === 'string' ? parsed.receiverName : '',
      receiverMsisdn: typeof parsed.receiverMsisdn === 'string' ? parsed.receiverMsisdn : '',
      originLabel: typeof parsed.originLabel === 'string' ? parsed.originLabel : '',
      destinationLabel: typeof parsed.destinationLabel === 'string' ? parsed.destinationLabel : '',
      parcelType: typeof parsed.parcelType === 'string' ? parsed.parcelType : 'SMALL',
      weightKg: typeof parsed.weightKg === 'string' ? parsed.weightKg : '',
      fragile: parsed.fragile === true,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      labelCode: typeof parsed.labelCode === 'string' ? parsed.labelCode : '',
    };
  } catch {
    return null;
  }
}

function hasContent(d: CustomParcelDraft): boolean {
  return Boolean(
    d.number.trim() || d.senderName.trim() || d.senderMsisdn.trim() ||
    d.receiverName.trim() || d.receiverMsisdn.trim() ||
    d.originLabel.trim() || d.destinationLabel.trim() || d.notes.trim() ||
    d.weightKg.trim() || d.fragile || d.parcelType !== 'SMALL' ||
    d.labelCode.trim(),
  );
}

export function CustomParcelPanel() {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverMsisdn, setReceiverMsisdn] = useState('');
  const [originLabel, setOriginLabel] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [parcelType, setParcelType] = useState('SMALL');
  const [weightKg, setWeightKg] = useState('');
  const [fragile, setFragile] = useState(false);
  const [notes, setNotes] = useState('');
  // The pre-printed sticker stuck on this box, if any. Its code becomes
  // the parcel's tracking code on save.
  const [labelCode, setLabelCode] = useState('');
  const [labelTail, setLabelTail] = useState('');
  const [labelResults, setLabelResults] = useState<OrgLabelSearchRow[] | null>(null);
  const [labelSearching, setLabelSearching] = useState(false);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const labelSeq = useRef(0);
  // A scan hands back whatever the camera read, not a label this
  // company actually owns and can still spend — the type-ahead search
  // and browse list are already scoped to that set (see searchOrgLabels/
  // listOrgLabels), but a scan skips straight to a full code with no
  // such check. Left unchecked, that full code was only ever caught at
  // Save, after a clerk had already typed out the whole shipment —
  // this re-checks it the moment it's scanned instead.
  const [labelChecking, setLabelChecking] = useState(false);
  const [labelCheckError, setLabelCheckError] = useState<string | null>(null);
  const labelCheckSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<{ code: string; ref: string; phone: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Payment prompt state for freshly created custom parcel
  const [payMethod, setPayMethod] = useState<'CASH' | 'MPESA'>('MPESA');
  const [payAmount, setPayAmount] = useState('');
  const [payMsisdn, setPayMsisdn] = useState('');
  const [payWaiting, setPayWaiting] = useState(false);
  const [paySettled, setPaySettled] = useState<{ method: string; amount: number; receipt?: string | null } | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payPending, startPayTransition] = useTransition();

  // Restore draft from localStorage client-side after initial mount so SSR and hydration match perfectly
  useEffect(() => {
    const draft = loadDraft();
    if (draft && hasContent(draft)) {
      setNumber(draft.number);
      setSenderName(draft.senderName);
      setSenderMsisdn(draft.senderMsisdn);
      setReceiverName(draft.receiverName);
      setReceiverMsisdn(draft.receiverMsisdn);
      setOriginLabel(draft.originLabel);
      setDestinationLabel(draft.destinationLabel);
      setParcelType(draft.parcelType || 'SMALL');
      setWeightKg(draft.weightKg);
      setFragile(draft.fragile);
      setNotes(draft.notes);
      setLabelCode(draft.labelCode);
      setOpen(true);
    }
  }, []);

  // While this panel is open the dashboard poller stands down, so the
  // page never refreshes under the form. Removed on close and on
  // unmount, so a stuck signal can't silence the poller forever.
  useEffect(() => {
    if (!open) return;
    setFormActive(true);
    return () => setFormActive(false);
  }, [open ]);

  // Mirror the draft so a remount restores exactly what was typed.
  useEffect(() => {
    if (!open) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        number, senderName, senderMsisdn, receiverName, receiverMsisdn,
        originLabel, destinationLabel, parcelType, weightKg, fragile, notes,
        labelCode,
      } satisfies CustomParcelDraft));
    } catch {
      // Private-mode storage failures must never break typing.
    }
  }, [open, number, senderName, senderMsisdn, receiverName, receiverMsisdn,
    originLabel, destinationLabel, parcelType, weightKg, fragile, notes,
    labelCode]);

  // Tail search over the company's own unused labels, debounced. The
  // sequence guard drops out-of-order responses, so a slow earlier
  // keystroke can never overwrite a newer one.
  //
  // An empty tail with the picker open isn't "no query yet" — it's
  // "show me what's available to pick from", so it lists the register's
  // own blank labels (see listOrgLabels('blank'), same data Settings →
  // Labels shows) instead of leaving the dropdown empty until someone
  // starts typing. Undebounced: opening the picker is the trigger, not
  // a keystroke.
  useEffect(() => {
    const tail = labelTail.trim();
    if (!labelPickerOpen) {
      setLabelResults(null);
      setLabelSearching(false);
      return;
    }
    if (tail.length === 0) {
      setLabelSearching(true);
      const seq = ++labelSeq.current;
      void listOrgLabels('blank').then(({ labels }) => {
        if (labelSeq.current !== seq) return;
        setLabelResults(labels.map((l) => ({ code: l.code, createdAt: l.createdAt })));
        setLabelSearching(false);
      }).catch(() => {
        if (labelSeq.current !== seq) return;
        setLabelResults([]);
        setLabelSearching(false);
      });
      return;
    }
    setLabelSearching(true);
    const seq = ++labelSeq.current;
    const id = window.setTimeout(() => {
      void searchOrgLabels(tail).then((rows) => {
        if (labelSeq.current !== seq) return;
        setLabelResults(rows);
        setLabelSearching(false);
      }).catch(() => {
        if (labelSeq.current !== seq) return;
        setLabelResults([]);
        setLabelSearching(false);
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [labelTail, labelPickerOpen]);

  function clearDraft() {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore — see above.
    }
  }

  function reset() {
    setNumber(''); setSenderName(''); setSenderMsisdn('');
    setReceiverName(''); setReceiverMsisdn(''); setOriginLabel(''); setDestinationLabel('');
    setParcelType('SMALL'); setWeightKg(''); setFragile(false); setNotes('');
    setLabelCode(''); setLabelTail(''); setLabelResults(null); setLabelPickerOpen(false);
    setLabelChecking(false); setLabelCheckError(null);
    clearDraft();
  }

  // A scanned code is checked against the company's own register before
  // it's accepted — same states Save itself would reject on
  // (dbx.importOrgParcelWithLabel): already spent, withdrawn, or not
  // found under this company at all. `blank` and `filled` both pass —
  // Save accepts either (a label can have field notes attached before
  // it's ever booked against).
  function handleScannedLabel(code: string) {
    setLabelCheckError(null);
    setLabelChecking(true);
    const seq = ++labelCheckSeq.current;
    void resolveOrgLabel(code).then((res) => {
      if (labelCheckSeq.current !== seq) return;
      setLabelChecking(false);
      if (!res.ok) {
        setLabelCheckError(`${code}: ${res.error}`);
        return;
      }
      if (res.label.state === 'spent') {
        setLabelCheckError(`${code} has already been used on another parcel.`);
        return;
      }
      if (res.label.state === 'voided') {
        setLabelCheckError(`${code} has been withdrawn and can't be used.`);
        return;
      }
      setLabelCode(code);
      setLabelTail(''); setLabelResults(null); setLabelPickerOpen(false);
    }).catch(() => {
      if (labelCheckSeq.current !== seq) return;
      setLabelChecking(false);
      setLabelCheckError(`Could not check ${code} — try again.`);
    });
  }

  const ready = number.trim() && senderName.trim() && senderMsisdn.trim()
    && receiverName.trim() && receiverMsisdn.trim()
    && originLabel.trim() && destinationLabel.trim();

  function save() {
    setError(null); setMinted(null);
    const customRef = number.trim();
    const senderPhone = senderMsisdn.trim();
    startTransition(async () => {
      try {
        const result = await addCustomParcel({
          externalRef: customRef,
          senderName, senderMsisdn, receiverName, receiverMsisdn,
          originLabel, destinationLabel, parcelType,
          weightKg: weightKg.trim() ? Number(weightKg) : null, fragile, notes,
          labelCode: labelCode.trim() || null,
        });
        if (!result.ok) { setError(result.error); return; }
        setMinted({ code: result.code, ref: customRef, phone: senderPhone });
        setPayMsisdn(senderPhone);
        setPayAmount('');
        setPayWaiting(false);
        setPaySettled(null);
        setPayError(null);
        reset();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save parcel');
      }
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-o btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />Add a custom parcel
      </button>
    );
  }

  return (
    <Modal
      title="Add a custom parcel"
      subtitle="Use your own parcel number — it stays on the parcel and is searchable here. Esoqo gives it a tracking code so you can manage and track it like any other. Only Esoqo PKG-… labels scan: attach one of your Esoqo labels below so the box scans."
      size="lg"
      onClose={() => { reset(); setOpen(false); setError(null); setMinted(null); }}
      footer={(
        minted ? (
          <>
            <button
              className="btn btn-p"
              onClick={() => {
                setMinted(null);
                setPaySettled(null);
                setPayWaiting(false);
                setPayError(null);
              }}
            >
              <Icon name="plus" size={16} />Add another parcel
            </button>
            <button
              className="btn btn-o"
              onClick={() => {
                reset();
                setOpen(false);
                setError(null);
                setMinted(null);
              }}
            >
              Close
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-p" disabled={pending || !ready} onClick={save}>
              <Icon name="check" size={16} />{pending ? 'Saving…' : 'Save parcel'}
            </button>
            <button className="btn btn-o" disabled={pending}
              onClick={() => { reset(); setOpen(false); setError(null); }}>
              Cancel
            </button>
          </>
        )
      )}
    >
      <div className="porg-custom-body">
        {minted && (
          <div style={{ marginBottom: 16, padding: 14, background: 'var(--subtle, #f8fafc)', borderRadius: 8, border: '1.5px solid var(--line, #e2e8f0)' }}>
            <p className="pnote pnote-ok" role="status" style={{ margin: '0 0 12px' }}>
              <Icon name="check-circle" size={16} />
              <span>Custom parcel registered. Tracking code: <strong className="mono">{minted.code}</strong> (Ref: {minted.ref})</span>
            </p>
            {paySettled ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--green, #16a34a)', fontWeight: 600, padding: '8px 0' }}>
                <Icon name="check-circle" size={20} />
                <span>
                  Fare collected ({paySettled.method} · KES {paySettled.amount.toLocaleString()}
                  {paySettled.receipt ? ` · Receipt: ${paySettled.receipt}` : ''})
                </span>
              </div>
            ) : (
              <div>
                <strong style={{ display: 'block', fontSize: '.95rem', marginBottom: 8 }}>
                  Collect fare now for <span className="mono">{minted.code}</span>
                </strong>
                {payError && (
                  <p className="sub" style={{ color: 'var(--red, #b42318)', margin: '0 0 10px', fontSize: '.85rem' }}>
                    {payError}
                  </p>
                )}
                {payWaiting ? (
                  <div style={{ marginTop: 8 }}>
                    <MpesaPromptWatch
                      code={minted.code}
                      onSettled={(receipt) => {
                        setPaySettled({ method: 'M-Pesa', amount: Number(payAmount), receipt });
                        setPayWaiting(false);
                      }}
                      onReleased={(message) => {
                        setPayWaiting(false);
                        setPayError(message);
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.88rem', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="custom-pay-method"
                          checked={payMethod === 'CASH'}
                          onChange={() => setPayMethod('CASH')}
                          disabled={payPending}
                        />
                        Cash
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.88rem', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="custom-pay-method"
                          checked={payMethod === 'MPESA'}
                          onChange={() => setPayMethod('MPESA')}
                          disabled={payPending}
                        />
                        M-Pesa STK prompt
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 130px' }}>
                        <input
                          className="mono"
                          style={{ width: '100%', padding: '6px 10px', border: '1.5px solid var(--line, #cbd5e1)', borderRadius: 6 }}
                          value={payAmount}
                          placeholder="Amount (KES)"
                          inputMode="decimal"
                          disabled={payPending}
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
                            disabled={payPending}
                            onChange={(e) => setPayMsisdn(e.target.value)}
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-p btn-sm"
                        disabled={payPending}
                        onClick={() => {
                          const amt = Number(payAmount);
                          if (!amt || amt <= 0) { setPayError('Enter the fare amount'); return; }
                          setPayError(null);
                          startPayTransition(async () => {
                            try {
                              if (payMethod === 'CASH') {
                                const res = await settleCounterParcel(minted.code, amt);
                                if (!res.ok) { setPayError(res.error); return; }
                                setPaySettled({ method: 'Cash', amount: amt });
                              } else {
                                const phone = payMsisdn.trim();
                                if (!phone) { setPayError('Enter the phone number to charge'); return; }
                                const res = await settleCounterParcelStk(minted.code, amt, phone);
                                if (!res.ok) { setPayError(res.error); return; }
                                if (res.status === 'SETTLED') {
                                  setPaySettled({ method: 'M-Pesa', amount: amt });
                                } else {
                                  setPayWaiting(true);
                                }
                              }
                            } catch (e) {
                              setPayError(e instanceof Error ? e.message : 'Payment request failed');
                            }
                          });
                        }}
                      >
                        {payPending ? 'Processing…' : payMethod === 'CASH' ? 'Record cash payment' : 'Send M-Pesa prompt'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <fieldset className="psection is-boxed">
          <h3 className="psection-title">Parcel number</h3>
          <div className="pgrid">
            <label className="pfield"><span>Your number</span>
              <input className="mono" value={number} placeholder="e.g. SWIFT-00471"
                onChange={(e) => setNumber(e.target.value)} />
            </label>
            <label className="pfield"><span>Parcel type</span>
              <select value={parcelType} onChange={(e) => setParcelType(e.target.value)}>
                {PARCEL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <LabelPicker
          tail={labelTail}
          onTail={(v) => { setLabelTail(v.toUpperCase()); setLabelPickerOpen(true); }}
          onFocus={() => setLabelPickerOpen(true)}
          results={labelResults}
          searching={labelSearching}
          pickerOpen={labelPickerOpen}
          selected={labelCode}
          onSelect={(code) => { setLabelCode(code); setLabelPickerOpen(false); setLabelTail(''); setLabelResults(null); setLabelCheckError(null); }}
          onScan={handleScannedLabel}
          checking={labelChecking}
          checkError={labelCheckError}
          onClear={() => { setLabelCode(''); setLabelTail(''); setLabelResults(null); setLabelCheckError(null); }}
          onClose={() => setLabelPickerOpen(false)}
        />

        <fieldset className="psection is-boxed">
          <h3 className="psection-title">Sender</h3>
          <div className="pgrid">
            <label className="pfield"><span>Name</span>
              <input value={senderName} onChange={(e) => setSenderName(e.target.value)} />
            </label>
            <label className="pfield"><span>Phone</span>
              <input className="mono" value={senderMsisdn} placeholder="07…" inputMode="tel"
                onChange={(e) => setSenderMsisdn(e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="psection is-boxed">
          <h3 className="psection-title">Receiver</h3>
          <div className="pgrid">
            <label className="pfield"><span>Name</span>
              <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
            </label>
            <label className="pfield"><span>Phone</span>
              <input className="mono" value={receiverMsisdn} placeholder="07…" inputMode="tel"
                onChange={(e) => setReceiverMsisdn(e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="psection is-boxed">
          <h3 className="psection-title">Journey</h3>
          <div className="pgrid">
            <label className="pfield"><span>From</span>
              <input value={originLabel} placeholder="e.g. Nairobi CBD"
                onChange={(e) => setOriginLabel(e.target.value)} />
            </label>
            <label className="pfield"><span>To</span>
              <input value={destinationLabel} placeholder="e.g. Nakuru"
                onChange={(e) => setDestinationLabel(e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="psection is-boxed">
          <h3 className="psection-title">Package</h3>
          <div className="pgrid">
            <label className="pfield"><span>Weight (kg, optional)</span>
              <input className="mono" value={weightKg} inputMode="decimal"
                onChange={(e) => setWeightKg(e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
            <label className="pfield"><span>Notes (optional)</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <label className="pfield-check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
            <span>Fragile — handle with care</span>
          </label>
        </fieldset>

        {error && (
          <p role="alert" className="pnote pnote-bad">
            <Icon name="alert-circle" size={16} /><span>{error}</span>
          </p>
        )}
      </div>
    </Modal>
  );
}

