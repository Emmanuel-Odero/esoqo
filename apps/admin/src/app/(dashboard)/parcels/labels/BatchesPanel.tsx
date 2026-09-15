'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionVoidParcelLabelBatch, type ParcelLabelBatchRow } from '../actions';

/**
 * The pads, not the stickers.
 *
 * A batch is the run that came off the printer together and gets
 * carried to a branch together, which is also the unit that goes
 * missing — so it's the unit that can be withdrawn. Voiding label by
 * label would be asking someone to click two hundred times to report
 * one theft.
 *
 * Labels minted before batches were tracked don't appear here at all,
 * rather than being lumped into one phantom pad: the batches they came
 * off are genuinely unknown, and inventing one would be asserting they
 * were printed together. They remain usable and printable from the
 * pool above — they just can't be recalled as a group, because they
 * never were one.
 */
export function BatchesPanel({ batches }: { batches: ParcelLabelBatchRow[] }) {
  if (batches.length === 0) {
    return (
      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <strong>Batches</strong>
        <p className="sub" style={{ margin: '6px 0 0' }}>
          No batches yet. Every new run of labels is recorded as one from now on, so a pad that
          goes missing can be withdrawn in a single action.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <strong style={{ display: 'block', marginBottom: 10 }}>Batches</strong>
      <table className="tbl">
        <thead>
          <tr>
            <th>Printed</th><th>For</th>
            <th className="num">Usable</th><th className="num">Spent</th><th className="num">Withdrawn</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => <BatchRow key={b.batchId} batch={b} />)}
        </tbody>
      </table>
    </div>
  );
}

function BatchRow({ batch }: { batch: ParcelLabelBatchRow }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  function voidBatch() {
    if (!reason.trim()) { setError('Say why this batch is being withdrawn.'); return; }
    setError(null);
    startTransition(async () => {
      const result = await actionVoidParcelLabelBatch(
        batch.batchId, reason.trim(), batch.parcelOrgId ?? undefined,
      );
      if (!result.ok) { setError(result.error); return; }
      announce(`${result.voided} labels withdrawn`, 'assertive');
      setConfirming(false);
    });
  }

  return (
    <>
      <tr>
        <td className="sub">{new Date(batch.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
        <td>{batch.orgName ?? <span className="sub">Esoqo pool</span>}</td>
        <td className="num mono">{batch.live}</td>
        <td className="num mono sub">{batch.used}</td>
        <td className="num mono">
          {batch.voided > 0
            ? <span style={{ color: 'var(--red)' }}>{batch.voided}</span>
            : <span className="sub">0</span>}
        </td>
        <td style={{ textAlign: 'right' }}>
          {/* Nothing usable left means nothing to withdraw — a button
              whose only outcome is "no usable labels in that batch"
              shouldn't be offered. */}
          {batch.live > 0 && !confirming && (
            <button className="btn btn-o btn-sm" onClick={() => setConfirming(true)}>
              <Icon name="alert-triangle" size={13} />Withdraw
            </button>
          )}
        </td>
      </tr>
      {confirming && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--paper)' }}>
            <p className="sub" style={{ margin: '0 0 8px' }}>
              Withdrawing stops all {batch.live} unused label{batch.live === 1 ? '' : 's'} in this
              batch from ever being booked. The {batch.used} already spent
              {batch.used === 1 ? ' is' : ' are'} untouched — those are on parcels already moving.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={reason}
                onChange={(e) => { setReason(e.target.value); setError(null); }}
                placeholder="Why? e.g. pad stolen from Kisumu branch"
                aria-label="Reason for withdrawing this batch"
                style={{ flex: 1, minWidth: 240, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }}
              />
              <button className="btn btn-p btn-sm" disabled={pending} onClick={voidBatch}>
                {pending ? 'Withdrawing…' : `Withdraw ${batch.live}`}
              </button>
              <button className="btn btn-o btn-sm" onClick={() => { setConfirming(false); setError(null); }}>
                Cancel
              </button>
            </div>
            {error && <p role="alert" style={{ color: 'var(--red)', margin: '8px 0 0' }}>{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
