'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { actionUpdateParcelPricing } from '../actions';

interface BargainReason { reason: string; extraDiscountPct: number }
interface Rule {
  parcelType: string; weightLabel: string; minWeightKg: number; maxWeightKg: number;
  minKes: number; maxKes: number;
  bargainMinPct: number; bargainMaxPct: number; bargainReasons: BargainReason[];
  suggestedTransportMode: string; slaHours: number | null; updatedAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  ENVELOPE_DOCUMENT: 'Envelope / Document',
  SMALL: 'Small parcel',
  MEDIUM: 'Medium parcel',
  LARGE: 'Large parcel',
  HEAVY_OVERSIZE: 'Heavy / Oversize',
};

type Draft = {
  weightLabel: string; minWeightKg: string; maxWeightKg: string;
  minKes: string; maxKes: string; bargainMinPct: string; bargainMaxPct: string; bargainReasons: BargainReason[];
  slaHours: string;
};

function toDraft(r: Rule): Draft {
  return {
    weightLabel: r.weightLabel, minWeightKg: String(r.minWeightKg), maxWeightKg: String(r.maxWeightKg),
    minKes: String(r.minKes), maxKes: String(r.maxKes),
    bargainMinPct: String(r.bargainMinPct), bargainMaxPct: String(r.bargainMaxPct),
    bargainReasons: r.bargainReasons,
    slaHours: r.slaHours != null ? String(r.slaHours) : '',
  };
}

export function ParcelPricingEditor({ rules, canEdit }: { rules: Rule[]; canEdit: boolean }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    Object.fromEntries(rules.map((r) => [r.parcelType, toDraft(r)])),
  );
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function patchDraft(parcelType: string, patch: Partial<Draft>) {
    setDrafts((d) => {
      const current = d[parcelType] ?? toDraft(rules.find((r) => r.parcelType === parcelType)!);
      return { ...d, [parcelType]: { ...current, ...patch } };
    });
  }

  function patchReason(parcelType: string, idx: number, patch: Partial<BargainReason>) {
    setDrafts((d) => {
      const current = d[parcelType];
      if (!current) return d;
      const reasons = [...current.bargainReasons];
      const existing = reasons[idx] ?? { reason: '', extraDiscountPct: 0 };
      reasons[idx] = { ...existing, ...patch };
      return { ...d, [parcelType]: { ...current, bargainReasons: reasons } };
    });
  }

  function addReason(parcelType: string) {
    setDrafts((d) => {
      const current = d[parcelType];
      if (!current) return d;
      return { ...d, [parcelType]: { ...current, bargainReasons: [...current.bargainReasons, { reason: '', extraDiscountPct: 0 }] } };
    });
  }

  function removeReason(parcelType: string, idx: number) {
    setDrafts((d) => {
      const current = d[parcelType];
      if (!current) return d;
      return { ...d, [parcelType]: { ...current, bargainReasons: current.bargainReasons.filter((_, i) => i !== idx) } };
    });
  }

  function save(parcelType: string) {
    setError(null);
    setPendingType(parcelType);
    const draft = drafts[parcelType];
    if (!draft) { setPendingType(null); return; }
    startTransition(async () => {
      const result = await actionUpdateParcelPricing(parcelType, {
        weightLabel: draft.weightLabel,
        minWeightKg: Number(draft.minWeightKg), maxWeightKg: Number(draft.maxWeightKg),
        minKes: Number(draft.minKes), maxKes: Number(draft.maxKes),
        bargainMinPct: Number(draft.bargainMinPct), bargainMaxPct: Number(draft.bargainMaxPct),
        bargainReasons: draft.bargainReasons.filter((r) => r.reason.trim() !== ''),
        slaHours: draft.slaHours.trim() === '' ? null : Number(draft.slaHours),
      });
      if (!result.ok) setError(result.error);
      setPendingType(null);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {rules.map((r) => {
        const draft = drafts[r.parcelType] ?? toDraft(r);
        return (
          <details key={r.parcelType} className="card" style={{ padding: 16 }}>
            {/* Collapsed by default — five full editor panels stacked
                open made this the longest single scroll on the page
                before you even reached Zones. <summary> is the one
                line always visible: type, weight bracket, price range
                and SLA, enough to scan the whole rate card without
                opening anything. */}
            <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', listStyle: 'none' }}>
              <div>
                <strong>{TYPE_LABEL[r.parcelType] ?? r.parcelType}</strong>
                <span className="sub" style={{ marginLeft: 8 }}>
                  {r.weightLabel} — {r.suggestedTransportMode.toLowerCase()} — KES {r.minKes.toLocaleString('en-KE')}-{r.maxKes.toLocaleString('en-KE')}
                  {r.slaHours != null && ` — ${r.slaHours}h SLA`}
                </span>
              </div>
              <span className="sub">Updated {new Date(r.updatedAt).toLocaleDateString('en-KE')}</span>
            </summary>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16, marginBottom: 12 }}>
              <label className="sub">Weight label
                <input disabled={!canEdit} value={draft.weightLabel}
                  onChange={(e) => patchDraft(r.parcelType, { weightLabel: e.target.value })}
                  style={{ display: 'block', width: 160, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              </label>
              <label className="sub">Min weight (kg)
                <input className="mono" disabled={!canEdit} value={draft.minWeightKg}
                  onChange={(e) => patchDraft(r.parcelType, { minWeightKg: e.target.value })}
                  style={{ display: 'block', width: 90, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              </label>
              <label className="sub">Max weight (kg)
                <input className="mono" disabled={!canEdit} value={draft.maxWeightKg}
                  onChange={(e) => patchDraft(r.parcelType, { maxWeightKg: e.target.value })}
                  style={{ display: 'block', width: 90, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              <label className="sub">Min KES
                <input className="mono" disabled={!canEdit} value={draft.minKes}
                  onChange={(e) => patchDraft(r.parcelType, { minKes: e.target.value })}
                  style={{ display: 'block', width: 100, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              </label>
              <label className="sub">Max KES
                <input className="mono" disabled={!canEdit} value={draft.maxKes}
                  onChange={(e) => patchDraft(r.parcelType, { maxKes: e.target.value })}
                  style={{ display: 'block', width: 100, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              </label>
              <label className="sub">Bargain min %
                <input className="mono" disabled={!canEdit} value={draft.bargainMinPct}
                  onChange={(e) => patchDraft(r.parcelType, { bargainMinPct: e.target.value })}
                  style={{ display: 'block', width: 90, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              </label>
              <label className="sub">Bargain max %
                <input className="mono" disabled={!canEdit} value={draft.bargainMaxPct}
                  onChange={(e) => patchDraft(r.parcelType, { bargainMaxPct: e.target.value })}
                  style={{ display: 'block', width: 90, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              </label>
              <label className="sub">SLA (hours, blank = none)
                <input className="mono" disabled={!canEdit} value={draft.slaHours}
                  onChange={(e) => patchDraft(r.parcelType, { slaHours: e.target.value })}
                  style={{ display: 'block', width: 110, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              </label>
            </div>

            <div className="sub" style={{ marginBottom: 6 }}>Offer reasons (shown to the sender when they negotiate)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {draft.bargainReasons.map((reason, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input disabled={!canEdit} placeholder="Reason, e.g. Not fragile" value={reason.reason}
                    onChange={(e) => patchReason(r.parcelType, idx, { reason: e.target.value })}
                    style={{ flex: 1, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
                  <input className="mono" disabled={!canEdit} value={reason.extraDiscountPct}
                    onChange={(e) => patchReason(r.parcelType, idx, { extraDiscountPct: Number(e.target.value) })}
                    style={{ width: 70, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
                  <span className="sub">% extra</span>
                  {canEdit && (
                    <button className="btn btn-o btn-sm" onClick={() => removeReason(r.parcelType, idx)}>
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button className="btn btn-o btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => addReason(r.parcelType)}>
                  + Add reason
                </button>
              )}
            </div>

            {canEdit && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-o btn-sm" disabled={pending && pendingType === r.parcelType} onClick={() => save(r.parcelType)}>
                  {pending && pendingType === r.parcelType ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </details>
        );
      })}
      {error && (
        <p role="alert" style={{ padding: '10px 14px', color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}
