'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, SelectableLabelPrintBlock } from '@esoqo/ui';
import { actionGenerateParcelLabels, actionVoidParcelLabels, type ParcelLabelStockRow, type ParcelOrg } from '../actions';
import { LabelInfoModal } from './LabelInfoModal';

type SortKey = 'code' | 'newest' | 'oldest';

export function LabelStockPanel({
  canGenerate, unused, openCode, orgs, activeOrgId,
}: {
  canGenerate: boolean; unused: ParcelLabelStockRow[]; openCode?: string;
  orgs: (ParcelOrg & { logoUrl?: string | null })[]; activeOrgId?: string;
}) {
  const router = useRouter();
  const [count, setCount] = useState(20);
  const [freshlyMinted, setFreshlyMinted] = useState<{ code: string; sig?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The label a click opened the info modal for — undefined means
  // closed, '' means opened via the manual "type any code" entry
  // point instead of clicking a specific label. See LabelInfoModal's
  // own comment on the initialCode distinction.
  const [modalCode, setModalCode] = useState<string | undefined>(openCode);
  const [modalOpen, setModalOpen] = useState(Boolean(openCode));
  // Print selection + list controls. Sorted/filtered views share one
  // selection so "sort, tick three, print" works in any order.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>('newest');
  const [filter, setFilter] = useState('');
  const [discardReason, setDiscardReason] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function generate() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      // Minted into whichever pool is being viewed — printing a pad
      // "for" a company you aren't looking at is a mistake nobody would
      // notice until the codes were already stuck to boxes.
      const result = await actionGenerateParcelLabels(count, activeOrgId);
      if (!result.ok) { setError(result.error); return; }
      // Signed labels come back ready to print as genuine; refresh in
      // the background so the pool + register counts catch up too.
      const fresh = (result.labels ?? []).map((l) => ({ code: l.code, sig: l.sig || undefined }));
      setFreshlyMinted(fresh);
      setSelected(new Set(fresh.map((l) => l.code)));
      setNotice(`${fresh.length} new label${fresh.length === 1 ? '' : 's'} generated and pre-selected below — set columns/rows and print.`);
      router.refresh();
    });
  }

  function openModal(code?: string) {
    setModalCode(code);
    setModalOpen(true);
  }

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  // Freshly-generated codes print first (the whole point of just
  // having clicked "Generate") — falls back to the existing unused
  // pool so re-opening this page still has something to reprint.
  const pool: { code: string; sig?: string; createdAt?: string }[] = useMemo(() => {
    if (freshlyMinted) return freshlyMinted;
    return unused.map((u) => ({ code: u.code, sig: u.sig }));
  }, [freshlyMinted, unused]);

  const createdAtOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of unused) m.set(u.code, u.createdAt);
    return m;
  }, [unused]);

  const visible = useMemo(() => {
    const needle = filter.trim().toUpperCase();
    let rows = needle ? pool.filter((l) => l.code.toUpperCase().includes(needle)) : [...pool];
    rows = [...rows].sort((a, b) => {
      if (sort === 'code') return a.code.localeCompare(b.code);
      const ta = createdAtOf.get(a.code) ?? '';
      const tb = createdAtOf.get(b.code) ?? '';
      return sort === 'newest' ? tb.localeCompare(ta) : ta.localeCompare(tb);
    });
    return rows;
  }, [pool, filter, sort, createdAtOf]);

  function discardSelected() {
    if (selected.size === 0 || !discardReason.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await actionVoidParcelLabels([...selected], discardReason.trim(), activeOrgId);
      if (!res.ok) { setError(res.error); return; }
      setNotice(`Withdrew ${res.voided} label${res.voided === 1 ? '' : 's'}.`);
      setSelected(new Set());
      setConfirmDiscard(false);
      setDiscardReason('');
      setFreshlyMinted(null);
      router.refresh();
    });
  }

  // Whose pad is on the printer — printed on every sticker as the
  // brand, so a box picked up anywhere reads who it belongs to and who
  // manages it. Undefined for the shared Esoqo pool, which brands as
  // Esoqo alone.
  const activeOrg = activeOrgId
    ? orgs.find((o) => o.id === activeOrgId)
    : undefined;
  const activeOrgName = activeOrg?.name;
  const activeOrgLogoUrl = (activeOrg as { logoUrl?: string | null } | undefined)?.logoUrl ?? undefined;

  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        {/* Whose pad this is. Changing it re-scopes the pool, the
            batches and any new mint together — see the page's own
            comment on why they can't move independently. */}
        <label className="sub" style={{ display: 'block', marginBottom: 12 }}>Stock belongs to
          <select
            value={activeOrgId ?? ''}
            onChange={(e) => router.push(e.target.value ? `/parcels/labels?org=${e.target.value}` : '/parcels/labels')}
            style={{ display: 'block', minWidth: 240, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2 }}
          >
            <option value="">Esoqo pool (shared)</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {canGenerate && (
            <>
              <label className="sub">How many
                <input type="number" min={1} max={500} value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                  style={{ display: 'block', width: 100, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
              </label>
              <button className="btn btn-p btn-sm" disabled={pending} onClick={generate}>
                {pending ? 'Generating…' : `Generate ${count} label${count === 1 ? '' : 's'}`}
              </button>
            </>
          )}
          <button className="btn btn-o btn-sm" onClick={() => openModal(undefined)}>
            <Icon name="qr" size={13} />Attach info to a label
          </button>
          {error && <span role="alert" className="sub" style={{ color: 'var(--red)' }}>{error}</span>}
          {notice && <span className="sub" style={{ color: 'var(--green, #1a7f37)' }}>{notice}</span>}
        </div>
        {!canGenerate && (
          <p className="sub" style={{ margin: '10px 0 0' }}>Generating a new batch needs the parcels.assign capability.</p>
        )}
        <p className="sub" style={{ margin: '10px 0 0' }}>
          {unused.length} unused label{unused.length === 1 ? '' : 's'} currently in the pool
          {freshlyMinted && ` · ${freshlyMinted.length} just generated, shown below first`}.
        </p>
      </div>

      {pool.length > 0 && (
        <SelectableLabelPrintBlock
          title={freshlyMinted ? 'New batch' : 'Unused pool'}
          labels={visible}
          selected={selected}
          onToggle={toggle}
          onSelectAll={() => setSelected(new Set(visible.map((l) => l.code)))}
          onClear={() => setSelected(new Set())}
          orgName={activeOrgName}
          orgLogoUrl={activeOrgLogoUrl}
        />
      )}

      {pool.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <strong style={{ marginRight: 'auto' }}>Unused labels — sort, pick, attach or discard</strong>
            <label className="sub">Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
                style={{ display: 'block', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2 }}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="code">Code A–Z</option>
              </select>
            </label>
            <label className="sub">Find
              <input value={filter} onChange={(e) => setFilter(e.target.value.toUpperCase())} placeholder="PKG-…"
                aria-label="Filter unused labels by code"
                className="mono"
                style={{ display: 'block', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2, minWidth: 160 }} />
            </label>
          </div>
          <p className="sub" style={{ margin: '0 0 10px' }}>
            Tick rows to choose exactly which stickers print above. Click a code to write what it is stuck on.
            Discarding withdraws stickers (misprints, damaged strips) — spent labels are never touched.
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th aria-label="Select"><input type="checkbox" aria-label="Select all listed labels"
                  checked={visible.length > 0 && visible.every((l) => selected.has(l.code))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((l) => l.code)) : new Set())} /></th>
                <th>Code</th><th>Added</th><th />
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr key={l.code}>
                  <td><input type="checkbox" checked={selected.has(l.code)} onChange={() => toggle(l.code)} aria-label={`Select ${l.code}`} /></td>
                  <td className="mono">{l.code}</td>
                  <td className="sub" style={{ fontSize: '.8rem' }}>
                    {createdAtOf.get(l.code) ? new Date(createdAtOf.get(l.code) as string).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : 'just now'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-o btn-sm" onClick={() => openModal(l.code)}>Fill in</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="sub" style={{ marginBottom: 0 }}>No unused labels match “{filter.trim()}”.</p>}

          {canGenerate && selected.size > 0 && (
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
              {!confirmDiscard ? (
                <button className="btn btn-o btn-sm" onClick={() => setConfirmDiscard(true)}>
                  Discard {selected.size} selected…
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={discardReason} onChange={(e) => setDiscardReason(e.target.value)}
                    placeholder="Why — e.g. misprinted strip"
                    aria-label="Why these labels are being discarded"
                    style={{ flex: 1, minWidth: 220, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }} />
                  <button className="btn btn-p btn-sm" disabled={pending || !discardReason.trim()} onClick={discardSelected}>
                    {pending ? 'Discarding…' : `Discard ${selected.size}`}
                  </button>
                  <button className="btn btn-o btn-sm" onClick={() => { setConfirmDiscard(false); setDiscardReason(''); }}>Cancel</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {modalOpen && <LabelInfoModal initialCode={modalCode} onClose={() => setModalOpen(false)} />}
    </>
  );
}
