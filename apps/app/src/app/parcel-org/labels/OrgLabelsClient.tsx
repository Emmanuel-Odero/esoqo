'use client';

import { useMemo, useState, useTransition } from 'react';
import { Icon, LabelPrintSheet, PrintLayoutControls, DEFAULT_PRINT_LAYOUT, type PrintLayout } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  voidOrgLabelBatch, voidOrgLabels,
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
 * Pads are issued by Esoqo admin — a company never mints its own, so
 * there is no minting on this screen, only the register of what was
 * issued, reprinting it with the company's brand, and withdrawing a
 * pad that walked away.
 */

const TABS: { state: string; label: string }[] = [
  { state: 'all', label: 'All' },
  { state: 'blank', label: 'Empty' },
  { state: 'filled', label: 'Filled in' },
  { state: 'spent', label: 'Used' },
  { state: 'voided', label: 'Withdrawn' },
];

type SortKey = 'newest' | 'oldest' | 'code' | 'item' | 'destination';

export function OrgLabelsClient({
  labels, counts, batches, state, canManage, orgName, orgLogoUrl,
}: {
  labels: OrgLabelRow[]; counts: Record<string, number>;
  batches: OrgLabelBatchRow[]; state: string; canManage: boolean;
  /** The company's own name — printed on every reprint as the brand. */
  orgName: string;
  /** Company logo — centered in the label header; absent = Esoqo alone. */
  orgLogoUrl?: string;
}) {
  // Live filter over the fetched register — the tab is server-side, but
  // finding one code in the current list shouldn't be a round trip.
  // Any consecutive run matches (code, item or destination), so results
  // appear from the second keystroke.
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<PrintLayout>(DEFAULT_PRINT_LAYOUT);
  const [showPreview, setShowPreview] = useState(false);
  const [discardReason, setDiscardReason] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();

  const needle = filter.trim().toUpperCase();
  const shown = useMemo(() => {
    const rows = needle
      ? labels.filter((l) =>
          l.code.toUpperCase().includes(needle) ||
          (l.itemDescription ?? '').toUpperCase().includes(needle) ||
          (l.destination ?? '').toUpperCase().includes(needle))
      : [...labels];
    return rows.sort((a, b) => {
      switch (sort) {
        case 'code': return a.code.localeCompare(b.code);
        case 'oldest': return stampOf(a) - stampOf(b);
        case 'newest': return stampOf(b) - stampOf(a);
        case 'item': return (a.itemDescription ?? '').localeCompare(b.itemDescription ?? '');
        case 'destination': return (a.destination ?? '').localeCompare(b.destination ?? '');
      }
    });
  }, [labels, needle, sort]);

  const selectedRows = useMemo(() => shown.filter((l) => selected.has(l.code)), [shown, selected]);
  const discardable = useMemo(() => selectedRows.filter((l) => !l.usedAt && !l.voidedAt), [selectedRows]);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function discardSelected() {
    if (discardable.length === 0 || !discardReason.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await voidOrgLabels(discardable.map((l) => l.code), discardReason.trim());
      if (!res.ok) { setError(res.error); return; }
      setMessage(`Withdrew ${res.voided} label${res.voided === 1 ? '' : 's'}.`);
      announce(`${res.voided} labels withdrawn`, 'assertive');
      setSelected(new Set());
      setConfirmDiscard(false);
      setDiscardReason('');
    });
  }

  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <p className="sub" style={{ margin: '0 0 6px' }}>
          {counts['blank'] ?? 0} empty · {(counts['filled'] ?? 0) + (counts['spent'] ?? 0)} attached to packages.
          These codes are yours — issued to {orgName} by Esoqo. Nobody else can book a
          parcel against them, and if a pad goes missing you can withdraw the whole
          batch below. Need more? Your Esoqo account manager prints the next pad.
        </p>
        <p className="sub" style={{ margin: 0 }}>
          Only Esoqo PKG-… labels scan. Labels your company printed itself are retired —
          re-print the Esoqo pad below{orgLogoUrl ? ' with your logo attached' : ' (add your logo via your account manager for branded prints)'}.
        </p>
      </div>

      {(state === 'blank' || selectedRows.length > 0) && shown.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <strong>
              {selectedRows.length > 0
                ? `Print selection — ${selectedRows.length} label${selectedRows.length === 1 ? '' : 's'}`
                : `Reprint your pad — ${shown.length} label${shown.length === 1 ? '' : 's'}`}
            </strong>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selectedRows.length === 0 && (
                <button className="btn btn-o btn-sm" onClick={() => setSelected(new Set(shown.map((l) => l.code)))}>
                  Select all {shown.length}
                </button>
              )}
              {selectedRows.length > 0 && (
                <button className="btn btn-o btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
              )}
              <button className="btn btn-o btn-sm" onClick={() => setShowPreview((v) => !v)}>
                <Icon name="print" size={13} />{showPreview ? 'Hide preview' : 'Preview…'}
              </button>
              {showPreview && (
                <button className="btn btn-p btn-sm" onClick={() => window.print()}>
                  <Icon name="print" size={13} />Print {selectedRows.length > 0 ? selectedRows.length : shown.length}
                </button>
              )}
            </div>
          </div>
          <p className="sub" style={{ margin: '0 0 10px' }}>
            {selectedRows.length > 0
              ? 'Preview below is exactly how the stickers fall on the page — set columns and rows, then print.'
              : 'Tick labels in the register below to print a selection, or preview the whole list here.'}
          </p>
          <PrintLayoutControls layout={layout} onChange={setLayout} />
          {showPreview && (
            <div style={{ marginTop: 12 }}>
              <LabelPrintSheet
                labels={(selectedRows.length > 0 ? selectedRows : shown).map((l) => ({ code: l.code, sig: l.sig || undefined }))}
                layout={layout} orgName={orgName} orgLogoUrl={orgLogoUrl} previewScale={0.55}
              />
            </div>
          )}
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <input
            className="mono" value={filter} placeholder="Type any characters — code, item or destination…"
            aria-label="Filter this list"
            onChange={(e) => setFilter(e.target.value.toUpperCase())}
            style={{ flex: 1, minWidth: 220, maxWidth: 420, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }}
          />
          <label className="sub">Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
              style={{ display: 'block', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2 }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="code">Code A–Z</option>
              <option value="item">Item A–Z</option>
              <option value="destination">Destination A–Z</option>
            </select>
          </label>
        </div>
        {message && <p className="sub" style={{ color: 'var(--green, #1a7f37)', margin: '0 0 8px' }}>{message}</p>}
        {error && <p role="alert" className="sub" style={{ color: 'var(--red)', margin: '0 0 8px' }}>{error}</p>}
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: 10, border: '1.5px solid var(--line)', borderRadius: 8, background: 'var(--paper)' }}>
            <strong style={{ fontSize: '.85rem' }}>{selected.size} selected</strong>
            <button className="btn btn-o btn-sm" onClick={() => { setShowPreview(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <Icon name="print" size={13} />Preview & print
            </button>
            <button className="btn btn-o btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            {canManage && discardable.length > 0 && (
              !confirmDiscard ? (
                <button className="btn btn-o btn-sm" onClick={() => setConfirmDiscard(true)}>
                  Discard {discardable.length} unused…
                </button>
              ) : (
                <>
                  <input value={discardReason} onChange={(e) => setDiscardReason(e.target.value)}
                    placeholder="Why — e.g. misprinted"
                    aria-label="Why these labels are being discarded"
                    style={{ flex: 1, minWidth: 200, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
                  <button className="btn btn-p btn-sm" disabled={pending || !discardReason.trim()} onClick={discardSelected}>
                    {pending ? 'Discarding…' : `Discard ${discardable.length}`}
                  </button>
                  <button className="btn btn-o btn-sm" onClick={() => { setConfirmDiscard(false); setDiscardReason(''); }}>Cancel</button>
                </>
              )
            )}
          </div>
        )}
        {shown.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>
            {labels.length === 0 ? 'Nothing here yet.' : `No matches for “${filter.trim()}” in this list.`}
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th aria-label="Select"><input type="checkbox" aria-label="Select all listed labels"
                  checked={shown.length > 0 && shown.every((l) => selected.has(l.code))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((l) => l.code)) : new Set())} /></th>
                <th>Code</th><th>Item</th><th>Destination</th><th>{state === 'voided' ? 'Why' : 'When'}</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.code}>
                  <td><input type="checkbox" checked={selected.has(l.code)} onChange={() => toggle(l.code)} aria-label={`Select ${l.code}`} /></td>
                  <td className="mono">{l.code}</td>
                  <td>{l.itemDescription ?? <span className="sub">—</span>}</td>
                  <td>{l.destination ?? <span className="sub">—</span>}</td>
                  <td className="sub" style={{ fontSize: '.8rem' }}>
                    {state === 'voided'
                      ? (l.voidedReason ?? 'Withdrawn')
                      : new Date(l.usedAt ?? l.infoAttachedAt ?? l.createdAt)
                        .toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {(l.state === 'blank' || l.state === 'filled') && canManage && (
                      <a className="btn btn-o btn-sm" href={`/parcel-org/labels?state=${state}&code=${encodeURIComponent(l.code)}`}>
                        <Icon name="document" size={13} />Details
                      </a>
                    )}
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

function stampOf(l: OrgLabelRow): number {
  return new Date(l.usedAt ?? l.infoAttachedAt ?? l.createdAt).getTime() || 0;
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
