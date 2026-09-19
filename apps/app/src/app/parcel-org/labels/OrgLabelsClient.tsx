'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, SelectableLabelPrintBlock } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  attachOrgLabelInfo, voidOrgLabelBatch, voidOrgLabels,
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

/** What each tab's empty state is telling the reader. */
const EMPTY_COPY: Record<string, string> = {
  blank: 'Nothing sitting unused — everything issued has been written on or booked.',
  filled: 'No written-on-but-not-booked labels right now.',
  spent: 'No parcels are using your labels right now.',
  voided: 'No withdrawn labels — nothing has had to be retired yet.',
};

type SortKey = 'newest' | 'oldest' | 'code' | 'item' | 'destination';

export function OrgLabelsClient({
  labels, counts, batches, state, canManage, orgName, orgLogoUrl, baseHref = '/parcel-org/counter?tab=labels',
}: {
  labels: OrgLabelRow[]; counts: Record<string, number>;
  batches: OrgLabelBatchRow[]; state: string; canManage: boolean;
  /** The company's own name — printed on every reprint as the brand. */
  orgName: string;
  /** Company logo — centered in the label header; absent = Esoqo alone. */
  orgLogoUrl?: string;
  /** State filters stay in the Counter label workspace. */
  baseHref?: string;
}) {
  // Live filter over the fetched register — the tab is server-side, but
  // finding one code in the current list shouldn't be a round trip.
  // Any consecutive run matches (code, item or destination), so results
  // appear from the second keystroke.
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The one register row opened in place. Inline beats the old
  // "Details → re-load the top search" hop: every field the row knows
  // is already in memory, so the expansion is instant and never moves
  // off the list.
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [discardReason, setDiscardReason] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useAnnounce();
  const router = useRouter();

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
      {state === 'blank' && shown.length > 0 && (
        <SelectableLabelPrintBlock
          title="Unused labels"
          labels={shown.map((l) => ({ code: l.code, sig: l.sig || undefined }))}
          selected={selected}
          onToggle={toggle}
          onSelectAll={() => setSelected(new Set(shown.map((l) => l.code)))}
          onClear={() => setSelected(new Set())}
          orgName={orgName}
          orgLogoUrl={orgLogoUrl}
          collapsible
        />
      )}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <a key={t.state} href={`${baseHref}&state=${t.state}`}
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
            <button className="btn btn-o btn-sm" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <Icon name="print" size={13} />Go to print preview
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
          <div className="empty" style={{ padding: '28px 16px' }}>
            <span className="ico"><Icon name="qr" size={22} /></span>
            {labels.length === 0 ? (
              <>
                <h3>Nothing {TABS.find((t) => t.state === state)?.label.toLowerCase() ?? 'here'} yet.</h3>
                <p className="sub">{EMPTY_COPY[state] ?? 'The register is empty for now.'}</p>
              </>
            ) : (
              <>
                <h3>No matches for “{filter.trim()}”.</h3>
                <p className="sub">Try any consecutive characters from the {state === 'voided' ? 'withdrawal reason or code' : 'code, item or destination'} — the filter matches as you type.</p>
              </>
            )}
          </div>
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
                <Fragment key={l.code}>
                  <tr>
                    <td><input type="checkbox" checked={selected.has(l.code)} onChange={() => toggle(l.code)} aria-label={`Select ${l.code}`} /></td>
                    <td className="mono">{l.code}</td>
                    <td>{l.itemDescription ?? <span className="sub">—</span>}</td>
                    <td>{l.destination ?? <span className="sub">—</span>}</td>
                    <td className="sub" style={{ fontSize: '.8rem' }}>
                      {state === 'voided'
                        ? (l.voidedReason ?? 'Withdrawn')
                        : dateOf(l.usedAt ?? l.infoAttachedAt ?? l.createdAt)}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-o btn-sm"
                        onClick={() => setExpandedCode((c) => (c === l.code ? null : l.code))}
                        aria-expanded={expandedCode === l.code}
                      >
                        {expandedCode === l.code ? 'Close' : 'Details'}
                        <Icon name={expandedCode === l.code ? 'chevron-right' : 'chevron-down'} size={13} />
                      </button>{' '}
                      {(l.state === 'blank' || l.state === 'filled') && canManage && (
                        <a className="btn btn-o btn-sm" href={`/parcel-org/counter?code=${encodeURIComponent(l.code)}`}>
                          <Icon name="plus" size={13} />Book
                        </a>
                      )}
                    </td>
                  </tr>
                  {expandedCode === l.code && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--paper)' }}>
                        <LabelRowDetail l={l} batch={batches.find((b) => b.batchId === l.batchId) ?? null} />
                        {(l.state === 'blank' || l.state === 'filled') && canManage && (
                          <WriteLabelDetails code={l.code} initial={l} onDone={() => router.refresh()} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
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

/** "14 Jan" for the scatter of timestamps a label row carries. */
function dateOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}

/**
 * The in-place expansion under a register row. Every field the row
 * already has — sender, the write-on/used/withdrawn moments, which pad
 * it came from, whether reprints stay genuine — is shown here, so
 * "Details" never leaves the list.
 */
function LabelRowDetail({ l, batch }: { l: OrgLabelRow; batch: OrgLabelBatchRow | null }) {
  const rows: [string, string][] = [];
  if (l.itemDescription) rows.push(['Item', l.itemDescription]);
  if (l.destination) rows.push(['Destination', l.destination]);
  if (l.senderName) rows.push(['Sender', l.senderName]);
  if (l.infoAttachedAt) rows.push(['Details written on', dateOf(l.infoAttachedAt)]);
  if (l.usedAt) rows.push(['Used on a parcel', dateOf(l.usedAt)]);
  if (l.voidedAt) rows.push(['Withdrawn', `${dateOf(l.voidedAt)}${l.voidedReason ? ` — ${l.voidedReason}` : ''}`]);
  rows.push(['Pad', batch ? `printed ${dateOf(batch.createdAt)} · ${batch.live} still live` : 'issued by Esoqo']);
  rows.push(['Genuine reprint QR', l.sig ? 'Signed — reprints verify as genuine.' : 'Unsigned row.']);

  return (
    <dl className="dl-grid" style={{ margin: 0 }}>
      {rows.map(([dt, dd]) => (
        <Fragment key={dt}><dt className="sub">{dt}</dt><dd>{dd}</dd></Fragment>
      ))}
    </dl>
  );
}

const writeStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '8px 10px',
  border: '1.5px solid var(--line)', borderRadius: 6,
};

/**
 * Write what's on the box onto one of the company's blank labels —
 * item, destination, sender and receiver — without starting a booking.
 * The Counter tab's scanner opens booking; this is the "prep the
 * sticker out in the field, book it later" path. Refuses once spent.
 */
function WriteLabelDetails({
  code, initial, onDone,
}: { code: string; initial: OrgLabelRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState(initial.itemDescription ?? '');
  const [destination, setDestination] = useState(initial.destination ?? '');
  const [senderName, setSenderName] = useState(initial.senderName ?? '');
  const [senderMsisdn, setSenderMsisdn] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverMsisdn, setReceiverMsisdn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" className="btn btn-o btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        <Icon name="document" size={13} />Write details on this label
      </button>
    );
  }

  function save() {
    setError(null);
    if (!item.trim()) { setError('Describe the item — that is the one required field.'); return; }
    startTransition(async () => {
      const result = await attachOrgLabelInfo(code, {
        itemDescription: item, destination, senderName, senderMsisdn, receiverName, receiverMsisdn,
      });
      if (!result.ok) { setError(result.error); return; }
      setOpen(false);
      onDone();
    });
  }

  return (
    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      <label className="sub">What&apos;s on the box
        <input style={writeStyle} value={item} placeholder="e.g. Shoes, size 42"
          onChange={(e) => setItem(e.target.value)} />
      </label>
      <label className="sub">Destination
        <input style={writeStyle} value={destination} placeholder="e.g. Nakuru"
          onChange={(e) => setDestination(e.target.value)} />
      </label>
      <label className="sub">Sender name
        <input style={writeStyle} value={senderName} onChange={(e) => setSenderName(e.target.value)} />
      </label>
      <label className="sub">Sender phone
        <input style={writeStyle} className="mono" value={senderMsisdn} placeholder="07…"
          onChange={(e) => setSenderMsisdn(e.target.value)} />
      </label>
      <label className="sub">Receiver name
        <input style={writeStyle} value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
      </label>
      <label className="sub">Receiver phone
        <input style={writeStyle} className="mono" value={receiverMsisdn} placeholder="07…"
          onChange={(e) => setReceiverMsisdn(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 8, gridColumn: '1 / -1' }}>
        <button className="btn btn-p btn-sm" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save details'}
        </button>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--red)', margin: 0, gridColumn: '1 / -1' }}>{error}</p>}
    </div>
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
