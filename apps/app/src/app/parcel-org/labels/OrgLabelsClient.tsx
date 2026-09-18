'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  generateOrgLabels, voidOrgLabelBatch,
  type OrgLabelBatchRow, type OrgLabelRow,
} from '../actions';

/**
 * A courier company's own blank labels.
 *
 * Pre-printed stock is how the trade has always worked — a pad of
 * pre-numbered waybills issued to an account, stuck on boxes in
 * advance, and checked at induction rather than at print time. Esoqo
 * enforces that check at booking: a code printed for one company can't
 * be spent by another.
 *
 * Which only became a real control once a company could get a pad of
 * its own. This is that.
 */

const TABS: { state: string; label: string }[] = [
  { state: 'blank', label: 'Blank' },
  { state: 'filled', label: 'Filled in' },
  { state: 'spent', label: 'Used' },
  { state: 'voided', label: 'Withdrawn' },
];

export function OrgLabelsClient({
  labels, counts, batches, state, canManage,
}: {
  labels: OrgLabelRow[]; counts: Record<string, number>;
  batches: OrgLabelBatchRow[]; state: string; canManage: boolean;
}) {
  const [count, setCount] = useState(20);
  const [minted, setMinted] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live filter over the fetched register — the tab is server-side, but
  // finding one code in the current list shouldn't be a round trip.
  const [filter, setFilter] = useState('');
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  const needle = filter.trim().toUpperCase();
  const shown = needle
    ? labels.filter((l) =>
        l.code.toUpperCase().includes(needle) ||
        (l.itemDescription ?? '').toUpperCase().includes(needle) ||
        (l.destination ?? '').toUpperCase().includes(needle))
    : labels;

  function mint() {
    setError(null);
    startTransition(async () => {
      const res = await generateOrgLabels(count);
      if (!res.ok) { setError(res.error); return; }
      setMinted(res.codes);
      announce(`${res.codes.length} labels printed`, 'assertive');
    });
  }

  return (
    <>
      {canManage && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="sub">How many
              <input type="number" min={1} max={500} value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                style={{ display: 'block', width: 100, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2 }} />
            </label>
            <button className="btn btn-p btn-sm" disabled={pending} onClick={mint}>
              {pending ? 'Printing…' : `Print ${count} label${count === 1 ? '' : 's'}`}
            </button>
            {error && <span className="sub" style={{ color: 'var(--red)' }}>{error}</span>}
          </div>
          <p className="sub" style={{ margin: '10px 0 0' }}>
            These codes are yours. Nobody else can book a parcel against them, and if a pad goes
            missing you can withdraw the whole batch below.
          </p>
        </div>
      )}

      {minted && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <strong>Just printed — {minted.length} code{minted.length === 1 ? '' : 's'}</strong>
          <p className="sub" style={{ margin: '4px 0 10px' }}>
            Write these on your labels, or print this page.
          </p>
          <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: '.85rem' }}>
            {minted.map((c) => <span key={c}>{c}</span>)}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <a key={t.state} href={`/parcel-org/labels?state=${t.state}`}
              className={`btn btn-sm ${t.state === state ? 'btn-p' : 'btn-o'}`}>
              {t.label} ({counts[t.state] ?? 0})
            </a>
          ))}
        </div>
        <input
          className="mono" value={filter} placeholder="Find a code, item or destination in this list…"
          aria-label="Filter this list"
          onChange={(e) => setFilter(e.target.value.toUpperCase())}
          style={{ width: '100%', maxWidth: 420, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, marginBottom: 12 }}
        />
        {shown.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>
            {labels.length === 0 ? 'Nothing here yet.' : `No matches for “${filter.trim()}” in this list.`}
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Code</th><th>Item</th><th>Destination</th><th>{state === 'voided' ? 'Why' : 'When'}</th></tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.code}>
                  <td className="mono">{l.code}</td>
                  <td>{l.itemDescription ?? <span className="sub">—</span>}</td>
                  <td>{l.destination ?? <span className="sub">—</span>}</td>
                  <td className="sub" style={{ fontSize: '.8rem' }}>
                    {state === 'voided'
                      ? (l.voidedReason ?? 'Withdrawn')
                      : new Date(l.usedAt ?? l.infoAttachedAt ?? l.createdAt)
                        .toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <BatchList batches={batches} canManage={canManage} />
    </>
  );
}

function BatchList({ batches, canManage }: { batches: OrgLabelBatchRow[]; canManage: boolean }) {
  if (batches.length === 0) return null;
  return (
    <div className="card" style={{ padding: 16 }}>
      <strong style={{ display: 'block', marginBottom: 10 }}>Your pads</strong>
      <table className="tbl">
        <thead>
          <tr>
            <th>Printed</th><th className="num">Usable</th><th className="num">Used</th>
            <th className="num">Withdrawn</th><th />
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => <BatchRow key={b.batchId} batch={b} canManage={canManage} />)}
        </tbody>
      </table>
    </div>
  );
}

function BatchRow({ batch, canManage }: { batch: OrgLabelBatchRow; canManage: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  function withdraw() {
    if (!reason.trim()) { setError('Say what happened to it.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await voidOrgLabelBatch(batch.batchId, reason.trim());
      if (!res.ok) { setError(res.error); return; }
      announce(`${res.voided} labels withdrawn`, 'assertive');
      setConfirming(false);
    });
  }

  return (
    <>
      <tr>
        <td className="sub">
          {new Date(batch.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
        </td>
        <td className="num mono">{batch.live}</td>
        <td className="num mono sub">{batch.used}</td>
        <td className="num mono">
          {batch.voided > 0 ? <span style={{ color: 'var(--red)' }}>{batch.voided}</span> : <span className="sub">0</span>}
        </td>
        <td style={{ textAlign: 'right' }}>
          {canManage && batch.live > 0 && !confirming && (
            <button className="btn btn-o btn-sm" onClick={() => setConfirming(true)}>Withdraw</button>
          )}
        </td>
      </tr>
      {confirming && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--paper)' }}>
            <p className="sub" style={{ margin: '0 0 8px' }}>
              This stops all {batch.live} unused label{batch.live === 1 ? '' : 's'} from ever being
              booked. The {batch.used} already used {batch.used === 1 ? 'is' : 'are'} untouched —
              those are on parcels already moving.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }}
                placeholder="e.g. pad stolen from the Kisumu desk"
                aria-label="Why this batch is being withdrawn"
                style={{ flex: 1, minWidth: 220, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              <button className="btn btn-p btn-sm" disabled={pending} onClick={withdraw}>
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

export function LabelsIcon() { return <Icon name="qr" size={13} />; }
