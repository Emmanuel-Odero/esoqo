'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, LabelPrintSheet, PrintLayoutControls, DEFAULT_PRINT_LAYOUT, type PrintLayout } from '@esoqo/ui';
import type { ParcelLabelRegisterRow } from '../actions';
import { actionVoidParcelLabels, actionDeleteParcelLabels } from '../actions';
import { batchShortCode } from './batchTitle';
import { LabelCard } from './LabelCard';
import { LabelDetailModal } from './LabelDetailModal';
import { ESOQO_LOGO_URL } from './constants';

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

// Colours the active tab by what the lifecycle stage means — same
// green/amber/red semantics .pill already carries in this app, so
// "Withdrawn" reads as a warning colour the same way it does
// everywhere else rather than the default green every other tab gets.
const STATE_TONE: Record<string, string> = { filled: 'warn', voided: 'bad' };

type SortKey = 'code' | 'newest' | 'oldest' | 'item' | 'destination';

export function RegisterPanel({
  labels, counts, state, orgId, batchFilter, basePath = '/parcels/labels',
}: {
  labels: ParcelLabelRegisterRow[]; counts: Record<string, number>;
  state: string; orgId?: string; batchFilter?: string; basePath?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function tabHref(s: string): Route {
    const params = new URLSearchParams({ state: s });
    if (orgId && basePath === '/parcels/labels') params.set('org', orgId);
    return `${basePath}?${params}` as Route;
  }

  // Client-side search over the loaded register page — finding one code
  // shouldn't be a round trip. Server tab still scopes the lifecycle.
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<PrintLayout>(DEFAULT_PRINT_LAYOUT);
  const [showPreview, setShowPreview] = useState(false);
  // See LabelPrintSheet's own onReadyChange doc — without this, a bulk
  // selection (50-100+) could still be mid-draw when Print is clicked,
  // which is what actually printed blank QR/barcode boxes at volume.
  const [printReady, setPrintReady] = useState(0);
  const [discardReason, setDiscardReason] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);

  // A batch's "View labels" link narrows straight to its rows — same
  // table, no separate query, since every register row already carries
  // its batchId.
  const scopedToBatch = useMemo(
    () => (batchFilter ? labels.filter((l) => l.batchId === batchFilter) : labels),
    [labels, batchFilter],
  );

  const needle = filter.trim().toUpperCase();
  const filtered = useMemo(() => {
    const rows = needle
      ? scopedToBatch.filter((l) =>
          l.code.toUpperCase().includes(needle) ||
          (l.itemDescription ?? '').toUpperCase().includes(needle) ||
          (l.destination ?? '').toUpperCase().includes(needle) ||
          (l.senderName ?? '').toUpperCase().includes(needle) ||
          (l.orgName ?? '').toUpperCase().includes(needle))
      : [...scopedToBatch];
    return rows.sort((a, b) => {
      switch (sort) {
        case 'code': return a.code.localeCompare(b.code);
        case 'oldest': return whenStamp(a) - whenStamp(b);
        case 'newest': return whenStamp(b) - whenStamp(a);
        case 'item': return (a.itemDescription ?? '').localeCompare(b.itemDescription ?? '');
        case 'destination': return (a.destination ?? '').localeCompare(b.destination ?? '');
      }
    });
  }, [scopedToBatch, needle, sort]);

  const selectedRows = useMemo(() => filtered.filter((l) => selected.has(l.code)), [filtered, selected]);
  const discardable = useMemo(() => selectedRows.filter((l) => !l.usedAt && !l.voidedAt), [selectedRows]);
  // Hard-delete only ever applies to labels with no history at all —
  // same "blank" predicate the server enforces, checked client-side
  // just to decide whether the button is worth offering.
  const deletable = useMemo(
    () => selectedRows.filter((l) => !l.usedAt && !l.voidedAt && !l.infoAttachedAt),
    [selectedRows],
  );
  const emptyCount = counts['blank'] ?? 0;
  const attachedCount = (counts['filled'] ?? 0) + (counts['spent'] ?? 0);
  const openLabel = openCode ? labels.find((l) => l.code === openCode) ?? null : null;
  // The bulk print preview brands the whole sheet as one company (see
  // LabelPrintSheet — it takes one orgName/orgLogoUrl for the page, not
  // per label), so when the register itself is scoped to one company
  // this reads it straight off the selection; an unscoped "all
  // companies" register just prints unbranded, which is correct — a
  // mixed-company sheet has no one company to brand it as.
  const previewOrgName = orgId ? selectedRows[0]?.orgName ?? undefined : undefined;

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

  function deleteSelected() {
    if (deletable.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await actionDeleteParcelLabels(deletable.map((l) => l.code), orgId);
      if (!res.ok) { setError(res.error); return; }
      setMessage(`Permanently deleted ${res.deleted} label${res.deleted === 1 ? '' : 's'}.`);
      setSelected(new Set());
      setConfirmDelete(false);
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
      {batchFilter && (
        <div className="chain" style={{ marginBottom: 12 }}>
          <Icon name="filter" size={15} />
          <span>Showing only batch <span className="mono">#{batchShortCode(batchFilter)}</span> ({scopedToBatch.length} label{scopedToBatch.length === 1 ? '' : 's'}).</span>
          <Link href={tabHref(state)} className="btn btn-o btn-sm" style={{ marginLeft: 'auto' }}>Clear</Link>
        </div>
      )}
      <div className="seg" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <Link key={t.state} href={tabHref(t.state)} title={t.hint}
            className={`seg-item${t.state === state ? ` active${STATE_TONE[t.state] ? ` ${STATE_TONE[t.state]}` : ''}` : ''}`}>
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
            {deletable.length > 0 && state !== 'spent' && !confirmDiscard && (
              !confirmDelete ? (
                <button className="btn btn-o btn-sm" onClick={() => setConfirmDelete(true)} style={{ color: 'var(--red)' }}>
                  Delete {deletable.length} permanently…
                </button>
              ) : (
                <>
                  <span className="sub" style={{ fontSize: '.8rem', color: 'var(--red)' }}>
                    Permanently removes {deletable.length} — unlike Withdraw, this cannot be undone.
                  </span>
                  <button className="btn btn-d btn-sm" disabled={pending} onClick={deleteSelected}>
                    {pending ? 'Deleting…' : `Delete ${deletable.length}`}
                  </button>
                  <button className="btn btn-o btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </>
              )
            )}
            {selectedRows.length !== discardable.length && (
              <span className="sub" style={{ fontSize: '.78rem' }}>
                Used/withdrawn labels print fine but are never discarded.
                {discardable.length !== deletable.length && ' Filled-in labels can be withdrawn but not deleted — delete only ever touches labels with nothing recorded on them yet.'}
              </span>
            )}
          </div>
        )}
        {showPreview && selectedRows.length > 0 && (
          <div style={{ marginBottom: 12, padding: 12, border: '1.5px dashed var(--line)', borderRadius: 8 }}>
            <PrintLayoutControls layout={layout} onChange={setLayout} />
            <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <button className="btn btn-p btn-sm" disabled={printReady < selectedRows.length} onClick={() => window.print()}>
                <Icon name="print" size={13} />
                {printReady < selectedRows.length
                  ? `Preparing ${printReady}/${selectedRows.length}…`
                  : `Print ${selectedRows.length} selected`}
              </button>
              <span className="sub">Preview below is how stickers fall on the page.</span>
            </div>
            <LabelPrintSheet
              labels={selectedRows.map((l) => ({ code: l.code, sig: l.sig || undefined, route: l.routeLabel ?? undefined }))}
              layout={layout} orgName={previewOrgName} esoqoLogoUrl={ESOQO_LOGO_URL} previewScale={0.55}
              onReadyChange={(r) => setPrintReady(r)}
            />
          </div>
        )}
        {filtered.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>No matches for “{filter.trim()}” in this list.</p>
        ) : (
        <>
        <label className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <input type="checkbox" aria-label="Select all listed labels"
            checked={filtered.length > 0 && filtered.every((l) => selected.has(l.code))}
            onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((l) => l.code)) : new Set())} />
          Select all {filtered.length} shown
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {filtered.map((l) => (
            <LabelCard key={l.code} label={l} selected={selected.has(l.code)}
              meta={state === 'voided' ? (l.voidedReason ?? 'Withdrawn') : whenFor(l)}
              onToggle={() => toggle(l.code)} onOpen={() => setOpenCode(l.code)} />
          ))}
        </div>
        </>
        )}
        </>
        )}
      {openLabel && (
        <LabelDetailModal
          label={openLabel} orgId={orgId}
          onClose={() => setOpenCode(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

/** The most recent thing that happened to this label, which is the
 *  only date worth a column. */
function whenFor(l: ParcelLabelRegisterRow): string {
  const stamp = l.usedAt ?? l.infoAttachedAt ?? l.createdAt;
  // Pinned to Africa/Nairobi rather than the machine's local zone: this
  // is a client component whose initial render is server-rendered, and
  // a bare toLocaleDateString picks up whatever zone each machine is
  // in — the container (often UTC) and the browser (Kenya) disagree
  // near midnight, which React then reports as a hydration mismatch.
  return new Date(stamp).toLocaleDateString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi',
  });
}

function whenStamp(l: ParcelLabelRegisterRow): number {
  return new Date(l.usedAt ?? l.infoAttachedAt ?? l.createdAt).getTime() || 0;
}

