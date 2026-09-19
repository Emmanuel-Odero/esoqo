'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, LabelPrintSheet, PrintLayoutControls, DEFAULT_PRINT_LAYOUT, type PrintLayout } from '@esoqo/ui';
import type { ParcelLabelRegisterRow } from '../actions';
import { actionVoidParcelLabels } from '../actions';

/**
 * The register: every label, at whatever point of its life it reached.
 *
 * What this fixes is not a missing feature but lost data. The only
 * listing that existed filtered on `infoAttachedAt IS NULL`, so the
 * moment a handler wrote down what a label was stuck on and where it
 * was headed, that label dropped out of every screen in the product.
 * The information was recorded and then unreachable — write-only.
 *
 * Four tabs over one table, because it is one lifecycle, not four
 * things. The counts come from the same predicates the tabs filter by
 * (see dbx.ParcelLabelStates), so a tab reading "Filled (12)" opens
 * twelve rows.
 *
 * Selection + sorting + bulk print/discard live here too: tick exactly
 * the stickers to reprint (with a columns×rows preview of the sheet),
 * or discard a handful of unused ones without voiding the whole pad.
 */

const TABS: { state: string; label: string; hint: string }[] = [
  { state: 'all', label: 'All', hint: 'Every label whatever its state' },
  { state: 'blank', label: 'Empty', hint: 'Printed, nothing written on them yet' },
  { state: 'filled', label: 'Filled in', hint: 'A handler recorded an item — not yet a booking' },
  { state: 'spent', label: 'Used', hint: 'Bound to a real parcel — attached to a package' },
  { state: 'voided', label: 'Withdrawn', hint: 'Recalled — can never be booked' },
];

type SortKey = 'code' | 'newest' | 'oldest' | 'item' | 'destination';

export function RegisterPanel({
  labels, counts, state, orgId,
}: {
  labels: ParcelLabelRegisterRow[]; counts: Record<string, number>;
  state: string; orgId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function tabHref(s: string): Route {
    const params = new URLSearchParams({ state: s });
    if (orgId) params.set('org', orgId);
    return `/parcels/labels?${params}` as Route;
  }

  // Client-side search over the loaded register page — finding one code
  // shouldn't be a round trip. Server tab still scopes the lifecycle.
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<PrintLayout>(DEFAULT_PRINT_LAYOUT);
  const [showPreview, setShowPreview] = useState(false);
  const [discardReason, setDiscardReason] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needle = filter.trim().toUpperCase();
  const filtered = useMemo(() => {
    const rows = needle
      ? labels.filter((l) =>
          l.code.toUpperCase().includes(needle) ||
          (l.itemDescription ?? '').toUpperCase().includes(needle) ||
          (l.destination ?? '').toUpperCase().includes(needle) ||
          (l.senderName ?? '').toUpperCase().includes(needle) ||
          (l.orgName ?? '').toUpperCase().includes(needle))
      : [...labels];
    return rows.sort((a, b) => {
      switch (sort) {
        case 'code': return a.code.localeCompare(b.code);
        case 'oldest': return whenStamp(a) - whenStamp(b);
        case 'newest': return whenStamp(b) - whenStamp(a);
        case 'item': return (a.itemDescription ?? '').localeCompare(b.itemDescription ?? '');
        case 'destination': return (a.destination ?? '').localeCompare(b.destination ?? '');
      }
    });
  }, [labels, needle, sort]);

  const selectedRows = useMemo(() => filtered.filter((l) => selected.has(l.code)), [filtered, selected]);
  const discardable = useMemo(() => selectedRows.filter((l) => !l.usedAt && !l.voidedAt), [selectedRows]);
  const emptyCount = counts['blank'] ?? 0;
  const attachedCount = (counts['filled'] ?? 0) + (counts['spent'] ?? 0);

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
      const res = await actionVoidParcelLabels(discardable.map((l) => l.code), discardReason.trim(), orgId);
      if (!res.ok) { setError(res.error); return; }
      setMessage(`Withdrew ${res.voided} label${res.voided === 1 ? '' : 's'}. Spent labels are never touched.`);
      setSelected(new Set());
      setConfirmDiscard(false);
      setDiscardReason('');
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>Label register</strong>
      <p className="sub" style={{ margin: '0 0 10px' }}>
        {emptyCount} empty · {attachedCount} attached to packages
        {orgId ? ' · this company’s pad' : ' · all companies + Esoqo pool'}
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <Link key={t.state} href={tabHref(t.state)} title={t.hint}
            className={`btn btn-sm ${t.state === state ? 'btn-p' : 'btn-o'}`}>
            {t.label} ({counts[t.state] ?? 0})
          </Link>
        ))}
      </div>

      {labels.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>
          {TABS.find((t) => t.state === state)?.hint}. None right now.
        </p>
      ) : (
        <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <input
            className="mono" value={filter} placeholder="Find a code, item, destination, sender or company…"
            aria-label="Filter this list"
            onChange={(e) => setFilter(e.target.value.toUpperCase())}
            style={{ flex: 1, minWidth: 220, maxWidth: 460, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6 }}
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
            <button className="btn btn-o btn-sm" onClick={() => setShowPreview((v) => !v)}>
              <Icon name="print" size={13} />{showPreview ? 'Hide print preview' : 'Print preview…'}
            </button>
            <button className="btn btn-o btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            {discardable.length > 0 && state !== 'spent' && (
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
            {selectedRows.length !== discardable.length && (
              <span className="sub" style={{ fontSize: '.78rem' }}>Used/withdrawn labels print fine but are never discarded.</span>
            )}
          </div>
        )}
        {showPreview && selectedRows.length > 0 && (
          <div style={{ marginBottom: 12, padding: 12, border: '1.5px dashed var(--line)', borderRadius: 8 }}>
            <PrintLayoutControls layout={layout} onChange={setLayout} />
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <button className="btn btn-p btn-sm" onClick={() => window.print()}>
                <Icon name="print" size={13} />Print {selectedRows.length} selected
              </button>
              <span className="sub">Preview below is how stickers fall on the page.</span>
            </div>
            <LabelPrintSheet labels={selectedRows.map((l) => ({ code: l.code, sig: l.sig || undefined }))} layout={layout} previewScale={0.55} />
          </div>
        )}
        {filtered.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>No matches for “{filter.trim()}” in this list.</p>
        ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th aria-label="Select"><input type="checkbox" aria-label="Select all listed labels"
                checked={filtered.length > 0 && filtered.every((l) => selected.has(l.code))}
                onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((l) => l.code)) : new Set())} /></th>
              <th>Code</th><th>Company</th><th>Item</th><th>Destination</th><th>Sender</th>
              <th>{state === 'voided' ? 'Why' : 'When'}</th><th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.code}>
                <td><input type="checkbox" checked={selected.has(l.code)} onChange={() => toggle(l.code)} aria-label={`Select ${l.code}`} /></td>
                <td className="mono">{l.code}</td>
                <td style={CLIP} title={l.orgName ?? ''}>{l.orgName ?? <span className="sub">Esoqo pool</span>}</td>
                <td style={CLIP} title={l.itemDescription ?? ''}>{l.itemDescription ?? <span className="sub">—</span>}</td>
                <td style={CLIP} title={l.destination ?? ''}>{l.destination ?? <span className="sub">—</span>}</td>
                <td style={CLIP} title={l.senderName ?? ''}>{l.senderName ?? <span className="sub">—</span>}</td>
                <td className="sub" style={{ fontSize: '.8rem' }}>
                  {state === 'voided'
                    ? (l.voidedReason ?? 'Withdrawn')
                    : whenFor(l)}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {/* A spent label's real home is the parcel it became;
                      sending someone to the attach form for it would
                      only produce a refusal. */}
                  {l.usedAt ? (
                    <Link className="btn btn-o btn-sm" href={`/parcels?q=${encodeURIComponent(l.code)}` as Route}>
                      <Icon name="eye" size={13} />Parcel
                    </Link>
                  ) : !l.voidedAt ? (
                    <Link className="btn btn-o btn-sm" href={`/parcels/counter?code=${encodeURIComponent(l.code)}` as Route}>
                      <Icon name="send" size={13} />{l.infoAttachedAt ? 'Resume' : 'Fill in'}
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </>
        )}
    </div>
  );
}

/** The most recent thing that happened to this label, which is the
 *  only date worth a column. */
function whenFor(l: ParcelLabelRegisterRow): string {
  const stamp = l.usedAt ?? l.infoAttachedAt ?? l.createdAt;
  return new Date(stamp).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function whenStamp(l: ParcelLabelRegisterRow): number {
  return new Date(l.usedAt ?? l.infoAttachedAt ?? l.createdAt).getTime() || 0;
}

const CLIP = { maxWidth: 180, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const };
