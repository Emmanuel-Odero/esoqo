'use client';

import { toCentsOrZero, toWire } from '@esoqo/domain';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { actionSaveCoverageTier, type ParcelCoverageTier } from '../actions';

/**
 * The declared-value cover rate card.
 *
 * Two numbers do the work and they are easy to conflate, so the table
 * spells both out: the **fee** a sender pays is `feeKes + declaredValue
 * × feePct`, while **maximum cover** is the ceiling a claim can ever
 * pay out. A sender declaring a million shillings on a boda parcel buys
 * the ceiling, not their own number — and is charged against the
 * ceiling too, never against the amount they typed.
 *
 * Rows are matched by name on save (the server upserts), which is why
 * renaming a level creates a new one rather than editing in place —
 * the same "small named set" shape the distance rate follows.
 */
export function CoverageEditor({
  tiers, canEdit,
}: { tiers: ParcelCoverageTier[]; canEdit: boolean }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Level</th><th>Maximum cover</th><th>Flat fee</th>
              <th>Percent of value</th><th>Active</th>{canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => <TierRow key={t.id} tier={t} canEdit={canEdit} />)}
            {tiers.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="sub" style={{ textAlign: 'center', padding: 24 }}>
                  No cover levels configured — senders won&apos;t be offered any.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ padding: 16, margin: 0, borderTop: '1px solid var(--line)', fontSize: '.82rem' }}>
        A sender pays the flat fee plus the percentage of whatever they declare, capped at the
        maximum. The fee is frozen onto the parcel at booking — editing a level here never changes
        what an in-flight parcel was charged, or what it&apos;s owed on a claim.
      </p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: 120,
};

function TierRow({ tier, canEdit }: { tier: ParcelCoverageTier; canEdit: boolean }) {
  // The money fields arrive as exact decimal strings and stay strings all
  // the way through: no Number() on the way in, none on the way out. The
  // server's money.Amount binding accepts a decimal string, so what the
  // admin typed reaches the Decimal column without ever being a float.
  const [maxCoverKes, setMaxCoverKes] = useState(tier.maxCoverKes);
  const [feeKes, setFeeKes] = useState(tier.feeKes);
  const [feePct, setFeePct] = useState(String(tier.feePct));
  const [active, setActive] = useState(tier.active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Compared as amounts, not as text, so "25000" and "25000.00" are not
  // treated as an unsaved edit.
  const dirty =
    toCentsOrZero(maxCoverKes) !== toCentsOrZero(tier.maxCoverKes)
    || toCentsOrZero(feeKes) !== toCentsOrZero(tier.feeKes)
    || feePct !== String(tier.feePct)
    || active !== tier.active;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await actionSaveCoverageTier({
        name: tier.name,
        // Normalised to an exact 2dp decimal, so "25,000" and "25000"
        // both reach the server as "25000.00".
        maxCoverKes: toWire(toCentsOrZero(maxCoverKes)),
        feeKes: toWire(toCentsOrZero(feeKes)),
        feePct: Number(feePct),
        active,
        sortOrder: tier.sortOrder,
      });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <tr>
      <td><strong>{tier.name}</strong></td>
      <td>
        <input className="mono" style={inputStyle} disabled={!canEdit}
          value={maxCoverKes} onChange={(e) => setMaxCoverKes(e.target.value)} />
      </td>
      <td>
        <input className="mono" style={inputStyle} disabled={!canEdit}
          value={feeKes} onChange={(e) => setFeeKes(e.target.value)} />
      </td>
      <td>
        <input className="mono" style={{ ...inputStyle, width: 80 }} disabled={!canEdit}
          value={feePct} onChange={(e) => setFeePct(e.target.value)} />
        <span className="sub"> %</span>
      </td>
      <td>
        <input type="checkbox" disabled={!canEdit}
          checked={active} onChange={(e) => setActive(e.target.checked)} />
      </td>
      {canEdit && (
        <td style={{ textAlign: 'right' }}>
          <button className="btn btn-o btn-sm" disabled={pending || !dirty} onClick={save}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          {error && (
            <span role="alert" className="sub" style={{ color: 'var(--red)', display: 'block' }}>
              <Icon name="alert-circle" size={12} />{error}
            </span>
          )}
        </td>
      )}
    </tr>
  );
}
