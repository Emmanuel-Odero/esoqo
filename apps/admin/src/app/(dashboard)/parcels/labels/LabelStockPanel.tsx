'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, ScaledLabel, SelectableLabelPrintBlock } from '@esoqo/ui';
import { actionGenerateParcelLabels, type ParcelLabelStockRow, type ParcelOrg } from '../actions';
import { LabelInfoModal } from './LabelInfoModal';
import { ESOQO_LOGO_URL } from './constants';

/**
 * Mint: generate new stock and print exactly what was just made.
 *
 * Browsing, sorting and reprinting the *standing* unused pool used to
 * live here too, in a table identical to the Register's own "Empty"
 * tab — the same rows, the same sort/filter/select/discard controls,
 * stacked directly on top of each other. That duplication is gone:
 * this tab only ever shows what a click on Generate just produced, and
 * the pool at large is the Register's job.
 */
export function LabelStockPanel({
  canGenerate, unused, openCode, orgs, activeOrgId, lockOrg, basePath = '/parcels/labels',
}: {
  canGenerate: boolean; unused: ParcelLabelStockRow[]; openCode?: string;
  orgs: (ParcelOrg & { logoUrl?: string | null })[]; activeOrgId?: string;
  /** True on a company's own drill-in page: the org is fixed by the
   *  URL, so the "stock belongs to" switcher (which would navigate
   *  away to the cross-company workspace) is replaced by static text. */
  lockOrg?: boolean;
  basePath?: string;
}) {
  const router = useRouter();
  const [count, setCount] = useState(20);
  const [freshlyMinted, setFreshlyMinted] = useState<{ code: string; sig?: string }[] | null>(null);
  // Generating already saves — a label row exists the instant it's
  // minted. What this tracks is only whether the print tools are
  // worth showing right now: "Print now" opens them, "Save for later"
  // dismisses the preview without losing the labels (they're exactly
  // as findable in Register → Empty either way).
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The label a click opened the info modal for — undefined means
  // closed, '' means opened via the manual "type any code" entry
  // point instead of clicking a specific label. See LabelInfoModal's
  // own comment on the initialCode distinction.
  const [modalCode, setModalCode] = useState<string | undefined>(openCode);
  const [modalOpen, setModalOpen] = useState(Boolean(openCode));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function generate() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      // Minted into whichever pool is being viewed — printing a pad
      // "for" a company you aren't looking at is a mistake nobody would
      // notice until the codes were already stuck to boxes.
      const result = await actionGenerateParcelLabels(count, activeOrgId);
      if (!result.ok) { setError(result.error); return; }
      // Signed labels come back ready to print as genuine.
      const fresh = (result.labels ?? []).map((l) => ({ code: l.code, sig: l.sig || undefined }));
      setFreshlyMinted(fresh);
      setSelected(new Set(fresh.map((l) => l.code)));
      setPreviewOpen(false);
      setNotice(`${fresh.length} new label${fresh.length === 1 ? '' : 's'} generated and saved.`);
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

  // Whose pad is on the printer — printed on every sticker as the
  // brand, so a box picked up anywhere reads who it belongs to and who
  // manages it. Undefined for the shared Esoqo pool, which brands as
  // Esoqo alone.
  const activeOrg = activeOrgId
    ? orgs.find((o) => o.id === activeOrgId)
    : undefined;
  const activeOrgName = activeOrg?.name;
  const activeOrgLogoUrl = (activeOrg as { logoUrl?: string | null } | undefined)?.logoUrl ?? undefined;

  const registerHref = (activeOrgId && basePath === '/parcels/labels'
    ? `${basePath}?tab=register&state=blank&org=${activeOrgId}`
    : `${basePath}?tab=register&state=blank`) as Route;

  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        {lockOrg ? (
          <p className="sub" style={{ margin: '0 0 12px' }}>
            Stock belongs to <strong>{activeOrgName ?? 'Esoqo pool (shared)'}</strong>
          </p>
        ) : (
          /* Whose pad this is. Changing it re-scopes the pool and any new
             mint together — see the page's own comment on why they
             can't move independently. */
          <label className="sub" style={{ display: 'block', marginBottom: 12 }}>Stock belongs to
            <select
              value={activeOrgId ?? ''}
              onChange={(e) => router.push((e.target.value ? `/parcels/labels?tab=mint&org=${e.target.value}` : '/parcels/labels?tab=mint') as Route)}
              style={{ display: 'block', minWidth: 240, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2 }}
            >
              <option value="">Esoqo pool (shared)</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
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
          {unused.length} unused label{unused.length === 1 ? '' : 's'} currently in the pool — browse, sort,
          reprint or discard them on the <Link href={registerHref}>Register</Link> tab.
        </p>
      </div>

      {freshlyMinted && freshlyMinted.length > 0 && !previewOpen && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="sub">{freshlyMinted.length} label{freshlyMinted.length === 1 ? '' : 's'} generated — here they are. Print now, or come back to them anytime in Register → Empty.</span>
            <button className="btn btn-p btn-sm" onClick={() => setPreviewOpen(true)}>
              <Icon name="print" size={13} />Print now
            </button>
            <button className="btn btn-o btn-sm" onClick={() => { setFreshlyMinted(null); setNotice('Saved for later — find them in Register → Empty.'); }}>
              Save for later
            </button>
          </div>
          {/* A visual confirmation, not just a count — a code in a
              sentence doesn't read as "this actually happened" the way
              seeing the sticker itself does. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {freshlyMinted.map((l) => (
              <ScaledLabel key={l.code} code={l.code} sig={l.sig} orgName={activeOrgName} orgLogoUrl={activeOrgLogoUrl} esoqoLogoUrl={ESOQO_LOGO_URL} maxScale={1} />
            ))}
          </div>
        </div>
      )}
      {freshlyMinted && freshlyMinted.length > 0 && previewOpen && (
        <SelectableLabelPrintBlock
          title="Just generated"
          labels={freshlyMinted}
          selected={selected}
          onToggle={toggle}
          onSelectAll={() => setSelected(new Set(freshlyMinted.map((l) => l.code)))}
          onClear={() => setSelected(new Set())}
          orgName={activeOrgName}
          orgLogoUrl={activeOrgLogoUrl}
          esoqoLogoUrl={ESOQO_LOGO_URL}
        />
      )}
      {modalOpen && <LabelInfoModal initialCode={modalCode} onClose={() => setModalOpen(false)} orgId={activeOrgId} />}
    </>
  );
}
