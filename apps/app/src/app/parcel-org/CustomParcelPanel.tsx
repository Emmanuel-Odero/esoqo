'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon, Modal } from '@esoqo/ui';
import { addCustomParcel, searchOrgLabels } from './actions';
import type { OrgLabelSearchRow } from '@/lib/parcel-org-session';
import { setFormActive } from './form-activity';

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
  const [draft] = useState<CustomParcelDraft | null>(loadDraft);
  const [open, setOpen] = useState(() => draft !== null && hasContent(draft));
  const [number, setNumber] = useState(draft?.number ?? '');
  const [senderName, setSenderName] = useState(draft?.senderName ?? '');
  const [senderMsisdn, setSenderMsisdn] = useState(draft?.senderMsisdn ?? '');
  const [receiverName, setReceiverName] = useState(draft?.receiverName ?? '');
  const [receiverMsisdn, setReceiverMsisdn] = useState(draft?.receiverMsisdn ?? '');
  const [originLabel, setOriginLabel] = useState(draft?.originLabel ?? '');
  const [destinationLabel, setDestinationLabel] = useState(draft?.destinationLabel ?? '');
  const [parcelType, setParcelType] = useState(draft?.parcelType ?? 'SMALL');
  const [weightKg, setWeightKg] = useState(draft?.weightKg ?? '');
  const [fragile, setFragile] = useState(draft?.fragile ?? false);
  const [notes, setNotes] = useState(draft?.notes ?? '');
  // The pre-printed sticker stuck on this box, if any. Its code becomes
  // the parcel's tracking code on save.
  const [labelCode, setLabelCode] = useState(draft?.labelCode ?? '');
  const [labelTail, setLabelTail] = useState('');
  const [labelResults, setLabelResults] = useState<OrgLabelSearchRow[] | null>(null);
  const [labelSearching, setLabelSearching] = useState(false);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const labelSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
  useEffect(() => {
    const tail = labelTail.trim();
    if (!labelPickerOpen || tail.length === 0) {
      setLabelResults(null);
      setLabelSearching(false);
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
  }, [labelTail, labelPickerOpen ]);

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
    clearDraft();
  }

  const ready = number.trim() && senderName.trim() && senderMsisdn.trim()
    && receiverName.trim() && receiverMsisdn.trim()
    && originLabel.trim() && destinationLabel.trim();

  function save() {
    setError(null); setMinted(null);
    startTransition(async () => {
      const result = await addCustomParcel({
        externalRef: number,
        senderName, senderMsisdn, receiverName, receiverMsisdn,
        originLabel, destinationLabel, parcelType,
        weightKg: weightKg.trim() ? Number(weightKg) : null, fragile, notes,
        labelCode: labelCode.trim() || null,
      });
      if (!result.ok) { setError(result.error); return; }
      setMinted(result.code);
      reset();
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
        <>
          <button className="btn btn-p" disabled={pending || !ready} onClick={save}>
            <Icon name="check" size={16} />{pending ? 'Saving…' : 'Save parcel'}
          </button>
          <button className="btn btn-o" disabled={pending}
            onClick={() => { reset(); setOpen(false); setError(null); }}>
            Cancel
          </button>
        </>
      )}
    >
      <div className="porg-custom-body">
        {minted && (
          <p className="pnote pnote-ok" role="status">
            <Icon name="check-circle" size={16} />
            <span>Saved. Tracking code: <strong className="mono">{minted}</strong></span>
          </p>
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
          results={labelResults}
          searching={labelSearching}
          pickerOpen={labelPickerOpen}
          selected={labelCode}
          onSelect={(code) => { setLabelCode(code); setLabelPickerOpen(false); setLabelTail(''); setLabelResults(null); }}
          onClear={() => { setLabelCode(''); setLabelTail(''); setLabelResults(null); }}
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

/**
 * The sticker picker: hold a pre-printed label, read off its last few
 * characters, and the full code builds itself from behind. Only the
 * company's own unused stickers are ever offered — matching by tail
 * (case-insensitive suffix), because the tail is what disambiguates a
 * sticker held at arm's length.
 */
function LabelPicker({
  tail, onTail, results, searching, pickerOpen, selected, onSelect, onClear, onClose,
}: {
  tail: string;
  onTail: (v: string) => void;
  results: OrgLabelSearchRow[] | null;
  searching: boolean;
  pickerOpen: boolean;
  selected: string;
  onSelect: (code: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <fieldset className="psection is-boxed">
      <h3 className="psection-title">Parcel label (optional)</h3>
      <p className="sub" style={{ margin: '6px 0 0' }}>
        Sticking one of your pre-printed labels on this box? Its code becomes the
        tracking code. Leave this empty and Esoqo mints one instead.
      </p>
      {selected ? (
        <div className="chain ok" style={{ marginTop: 8 }}>
          <Icon name="tag" size={16} />
          <span>Label <strong className="mono">{selected}</strong> will go on this parcel</span>
          <button className="btn btn-o btn-sm" style={{ marginLeft: 'auto' }} onClick={onClear}>
            <Icon name="close" size={14} />Remove
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative', marginTop: 8 }}>
          <input
            className="pinput mono" value={tail}
            placeholder="Type any characters, e.g. YZN…"
            aria-label="Find a label by any characters in its code"
            autoComplete="off"
            onChange={(e) => onTail(e.target.value)}
            onBlur={() => window.setTimeout(onClose, 150)}
          />
          {pickerOpen && tail.trim() && (
            <div
              role="listbox" aria-label="Matching labels"
              style={{
                position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%',
                background: 'var(--bg, #fff)', border: '1.5px solid var(--line)',
                borderRadius: 8, marginTop: 4, maxHeight: 220, overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,.12)',
              }}
            >
              {searching || results === null ? (
                <p className="sub" style={{ margin: 0, padding: '10px 12px' }}>Searching your labels…</p>
              ) : results.length === 0 ? (
                <p className="sub" style={{ margin: 0, padding: '10px 12px' }}>
                  No unused label contains “{tail.trim().toUpperCase()}”. Check the sticker, or leave
                  this empty to mint a fresh code.
                </p>
              ) : (
                results.map((r) => (
                  <TailOption key={r.code} code={r.code} tail={tail.trim().toUpperCase()} onSelect={onSelect} />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** One dropdown row: the full code with the typed fragment emphasised
 *  wherever it occurs, so typing any consecutive run feels like the
 *  code building itself up live. */
function TailOption({ code, tail, onSelect }: { code: string; tail: string; onSelect: (code: string) => void }) {
  const upper = code.toUpperCase();
  const idx = tail ? upper.indexOf(tail) : -1;
  const head = idx >= 0 ? code.slice(0, idx) : code;
  const mid = idx >= 0 ? code.slice(idx, idx + tail.length) : '';
  const rest = idx >= 0 ? code.slice(idx + tail.length) : '';
  return (
    <button
      type="button" role="option" aria-selected="false"
      onMouseDown={(e) => { e.preventDefault(); onSelect(code); }}
      className="mono"
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: '9px 12px', border: 0, borderBottom: '1px solid var(--line)',
        background: 'transparent', fontSize: '.92rem',
      }}
    >
      {idx >= 0 ? (
        <><span style={{ opacity: 0.55 }}>{head}</span><strong>{mid}</strong><span style={{ opacity: 0.55 }}>{rest}</span></>
      ) : (
        <span style={{ opacity: 0.55 }}>{code}</span>
      )}
    </button>
  );
}
