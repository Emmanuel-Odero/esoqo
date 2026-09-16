'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  actionAttachParcelLabelInfo, actionGetParcelLabelInfo, type ParcelLabelInfoInput,
} from '../actions';

// A practical, small taxonomy for what's physically stuck on a
// pre-printed label — deliberately not the same list as ParcelType
// (the pricing-bracket enum a real booking uses): this is filled in
// by a handler eyeballing an item in the field, before any weighing
// or pricing happens, so it favours "what does this look like" over
// a pricing category.
const ITEM_TYPE_OPTIONS = [
  'Luggage / Suitcase', 'Backpack', 'Box / Carton', 'Envelope / Document',
  'Electronics', 'Furniture',
];

const WEIGHT_RANGE_OPTIONS = ['Under 1kg', '1–5kg', '5–10kg', '10–20kg', '20kg+'];

const INPUT: React.CSSProperties = {
  display: 'block', width: '100%', padding: '6px 8px',
  border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2,
};

/**
 * The "fill in" half of the pre-printed-label pipeline: a handler has
 * just stuck a label on a real item — this is where that gets written
 * down, without needing to run the item through a full sender/
 * receiver/pricing/payment booking (or ever, if it never needs one).
 * core-go's guest-safe scan/track endpoint then shows this same info
 * to anyone who scans the code — see dbx.GetParcelStatus's own
 * comment on the fallback.
 *
 * Opened by clicking a label's QR in the printed batch/pool grid (see
 * LabelStockPanel) — `initialCode` arrives pre-filled and locked, since
 * the whole point of that entry point is "this specific label, right
 * here". `initialCode` being undefined instead opens it in "type any
 * code" mode, for attaching info to a label that isn't in the current
 * on-screen batch (e.g. one printed in an earlier session).
 *
 * Always loads before it saves. dbx.AttachParcelLabelInfo overwrites
 * rather than merges — so a form that opened blank over an already-
 * filled label and re-submitted every field silently erased the six
 * the handler wasn't editing. Correcting one typo cost the other six
 * fields. The load is what makes the overwrite safe.
 */
export function LabelInfoModal({ initialCode, onClose }: { initialCode?: string; onClose: () => void }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [itemDescription, setItemDescription] = useState('');
  const [destination, setDestination] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverMsisdn, setReceiverMsisdn] = useState('');
  const [itemType, setItemType] = useState('');
  const [weightRangeKg, setWeightRangeKg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // Which code the fields on screen currently describe, and whether
  // that code already had info. Both drive the banner and the save
  // button's wording — "Save" and "Update" are different promises,
  // and a handler about to overwrite six populated fields should be
  // told so before they click, not after.
  const [loading, setLoading] = useState(false);
  const [loadedCode, setLoadedCode] = useState<string | null>(null);
  const [hadInfo, setHadInfo] = useState(false);
  const announce = useAnnounce();

  const load = useCallback(async (raw: string) => {
    const target = raw.trim().toUpperCase();
    if (!target) return;
    setLoading(true);
    setError(null);
    const result = await actionGetParcelLabelInfo(target);
    setLoading(false);
    if (!result.ok) {
      // A code that isn't stock, or is already bound to a booking —
      // say so now rather than after the handler has typed six fields
      // into a form that was always going to be refused.
      setError(result.error);
      setLoadedCode(null);
      return;
    }
    setLoadedCode(target);
    setHadInfo(result.info !== null);
    const info = result.info;
    setItemDescription(info?.itemDescription ?? '');
    setDestination(info?.destination ?? '');
    setSenderName(info?.senderName ?? '');
    setSenderMsisdn(info?.senderMsisdn ?? '');
    setReceiverName(info?.receiverName ?? '');
    setReceiverMsisdn(info?.receiverMsisdn ?? '');
    setItemType(info?.itemType ?? '');
    setWeightRangeKg(info?.weightRangeKg ?? '');
    if (info) announce(`Loaded existing info for ${target}`, 'polite');
  }, [announce]);

  // Clicking a specific label already names its code, so load straight
  // away. In "type any code" mode there's nothing to load until the
  // handler has told us which label they mean (see onBlur below).
  useEffect(() => {
    if (initialCode) void load(initialCode);
  }, [initialCode, load]);

  function submit() {
    const trimmedCode = code.trim().toUpperCase();
    const trimmedDescription = itemDescription.trim();
    if (!trimmedCode || !trimmedDescription) {
      setError('The label code and a short item description are both required.');
      return;
    }
    // Refusing to save contents that were never loaded for this code is
    // the whole point of the load — without it we'd be back to blindly
    // overwriting whatever is already on the label.
    if (loadedCode !== trimmedCode) {
      setError('Check that label code first — press Tab or click away so its current info can load.');
      return;
    }
    setError(null);
    const info: ParcelLabelInfoInput = {
      itemDescription: trimmedDescription,
      destination: destination.trim() || undefined,
      senderName: senderName.trim() || undefined,
      senderMsisdn: senderMsisdn.trim() || undefined,
      receiverName: receiverName.trim() || undefined,
      receiverMsisdn: receiverMsisdn.trim() || undefined,
      itemType: itemType.trim() || undefined,
      weightRangeKg: weightRangeKg || undefined,
    };
    setSaving(true);
    void actionAttachParcelLabelInfo(trimmedCode, info).then((result) => {
      setSaving(false);
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
      announce(`Info attached to ${trimmedCode}`, 'assertive');
    });
  }

  return (
    <div className="scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="label-info-title">
        <div className="modal-hd">
          <div>
            <h2 id="label-info-title">Attach info to a label</h2>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              No booking required — a handler (or anyone who scans/tracks the code) sees this
              once it&apos;s saved.
            </p>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div className="modal-bd">
          {saved ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Icon name="check-circle" size={32} />
              <p style={{ margin: '10px 0 0', fontWeight: 700 }}>Saved for {code.trim().toUpperCase()}</p>
              <button className="btn btn-o btn-sm" style={{ marginTop: 14 }} onClick={onClose}>Close</button>
            </div>
          ) : (
            <>
              <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Label code
                <input className="mono" value={code}
                  onChange={(e) => { setCode(e.target.value); setLoadedCode(null); }}
                  onBlur={(e) => { if (!initialCode) void load(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !initialCode) void load(code); }}
                  placeholder="PKG-XXXXXX" readOnly={!!initialCode}
                  style={{ ...INPUT, background: initialCode ? 'var(--paper)' : undefined }} />
              </label>

              {loading && <p className="sub" style={{ margin: '0 0 10px' }}>Checking that label…</p>}

              {/* An overwrite is about to happen — say so. The fields
                  below are this label's current contents, and anything
                  cleared here is cleared on the label. */}
              {hadInfo && loadedCode && !loading && (
                <div className="chain" style={{ background: 'var(--amber-t)', border: '1px solid #E8D2A0', color: 'var(--amber)', marginBottom: 12 }}>
                  <Icon name="alert-triangle" size={16} />
                  <span>
                    This label already has info — shown below. Saving replaces all of it, so clear a
                    field only if you mean to remove it from the label.
                  </span>
                </div>
              )}

              <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Item description
                <input value={itemDescription} onChange={(e) => setItemDescription(e.target.value)}
                  placeholder="e.g. TV stand, flat-pack box" style={INPUT} />
              </label>

              <label className="sub" style={{ display: 'block', marginBottom: 10 }}>Destination
                <input value={destination} onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Westlands, Nairobi" style={INPUT} />
              </label>

              <label className="sub" style={{ display: 'block', margin: '0 0 6px' }}>Sender</label>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <label className="sub" style={{ flex: 1 }}>Sender name
                  <input value={senderName} onChange={(e) => setSenderName(e.target.value)}
                    placeholder="Full name" style={INPUT} />
                </label>
                <label className="sub" style={{ flex: 1 }}>Sender contact
                  <input value={senderMsisdn} onChange={(e) => setSenderMsisdn(e.target.value)}
                    placeholder="Phone or email" style={INPUT} />
                </label>
              </div>

              <label className="sub" style={{ display: 'block', margin: '0 0 6px' }}>Receiver</label>
              <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <label className="sub" style={{ flex: 1 }}>Receiver name
                  <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)}
                    placeholder="Full name" style={INPUT} />
                </label>
                <label className="sub" style={{ flex: 1 }}>Receiver contact
                  <input value={receiverMsisdn} onChange={(e) => setReceiverMsisdn(e.target.value)}
                    placeholder="Phone or email" style={INPUT} />
                </label>
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
                <SelectWithOther label="Item type" value={itemType} onChange={setItemType}
                  options={ITEM_TYPE_OPTIONS} otherPlaceholder="What is it?" />
                <label className="sub" style={{ flex: 1 }}>Weight range
                  <select value={weightRangeKg} onChange={(e) => setWeightRangeKg(e.target.value)} style={INPUT}>
                    <option value="">—</option>
                    {WEIGHT_RANGE_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </label>
              </div>

              <button className="btn btn-p btn-sm" disabled={saving || loading} onClick={submit}>
                {saving ? 'Saving…' : hadInfo ? 'Update label' : 'Save'}
              </button>
              {error && <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// The sentinel the <select> shows while the free-text box is open. It
// is never stored and never submitted — see SelectWithOther.
const OTHER = '__other__';

/**
 * A dropdown whose "Other" actually collects the other.
 *
 * Offering "Other" with nowhere to say what it is records strictly
 * less than not offering it at all: "Other" tells you only that none
 * of the listed options fit, which is exactly the case where the
 * answer matters most.
 *
 * The typed text is what gets stored — the column holds "Tricycle
 * wheel", never the literal string "Other". That keeps the data
 * usable by anything that reads it later (a filter, a report, a scan
 * page) without teaching every reader about a sentinel value, and it
 * means the mode round-trips for free: a stored value that isn't one
 * of the known options can only have come from the free-text box, so
 * re-opening the form re-derives the mode from the value itself
 * rather than needing a second column to remember it.
 */
function SelectWithOther({
  label, value, onChange, options, otherPlaceholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; otherPlaceholder: string;
}) {
  // Sticky, because a freshly-picked "Other" has an empty value and
  // would otherwise collapse the text box the instant it appeared.
  const [picked, setPicked] = useState(false);
  const showOther = picked || (value !== '' && !options.includes(value));

  return (
    <label className="sub" style={{ flex: 1 }}>{label}
      <select
        value={showOther ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) { setPicked(true); onChange(''); return; }
          setPicked(false);
          onChange(e.target.value);
        }}
        style={INPUT}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTHER}>Other…</option>
      </select>
      {showOther && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
          aria-label={`${label} — please specify`}
          style={{ ...INPUT, marginTop: 6 }}
        />
      )}
    </label>
  );
}
