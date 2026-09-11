'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { actionGenerateParcelLabels, type ParcelLabelStockRow } from '../actions';
import { LABEL_GAP_MM, LABEL_WIDTH_MM, PrintableLabel, PrintStyles } from '../ParcelLabelPrint';
import { LabelInfoModal } from './LabelInfoModal';

export function LabelStockPanel({
  canGenerate, unused,
}: { canGenerate: boolean; unused: ParcelLabelStockRow[] }) {
  const [count, setCount] = useState(20);
  const [freshlyMinted, setFreshlyMinted] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The label a click opened the info modal for — undefined means
  // closed, '' means opened via the manual "type any code" entry
  // point instead of clicking a specific label. See LabelInfoModal's
  // own comment on the initialCode distinction.
  const [modalCode, setModalCode] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await actionGenerateParcelLabels(count);
      if (!result.ok) { setError(result.error); return; }
      setFreshlyMinted(result.codes);
    });
  }

  function openModal(code?: string) {
    setModalCode(code);
    setModalOpen(true);
  }

  // Freshly-generated codes print first (the whole point of just
  // having clicked "Generate") — falls back to the existing unused
  // pool so re-opening this page still has something to reprint.
  const toPrint = freshlyMinted ?? unused.map((u) => u.code);

  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
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
          {error && <span className="sub" style={{ color: 'var(--red)' }}>{error}</span>}
        </div>
        {!canGenerate && (
          <p className="sub" style={{ margin: '10px 0 0' }}>Generating a new batch needs the parcels.assign capability.</p>
        )}
        <p className="sub" style={{ margin: '10px 0 0' }}>
          {unused.length} unused label{unused.length === 1 ? '' : 's'} currently in the pool
          {freshlyMinted && ` · ${freshlyMinted.length} just generated, shown below first`}.
        </p>
      </div>

      {toPrint.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong>
              {freshlyMinted ? 'New batch' : 'Unused pool'} — {toPrint.length} label{toPrint.length === 1 ? '' : 's'}
              {' '}· {Math.ceil(toPrint.length / LABELS_PER_PAGE)} page{Math.ceil(toPrint.length / LABELS_PER_PAGE) === 1 ? '' : 's'} at {LABELS_PER_PAGE}/page
            </strong>
            <button className="btn btn-o btn-sm" onClick={() => window.print()}>
              <Icon name="print" size={13} />Print all
            </button>
          </div>
          <p className="sub" style={{ margin: '0 0 10px' }}>Click a label to attach info to it.</p>
          <LabelSheet codes={toPrint} onSelect={openModal} />
        </div>
      )}
      <PrintStyles />
      {modalOpen && <LabelInfoModal initialCode={modalCode} onClose={() => setModalOpen(false)} />}
    </>
  );
}

// 2 across, 5 down — 10 to a physical A4 portrait page, each label a
// fixed 90mm x 50mm shipping-label-style box (see ParcelLabelPrint's
// LABEL_WIDTH_MM/HEIGHT_MM). On screen this is just a grid that wraps
// naturally; in print each chunk of 10 gets its own page via
// page-break-after, so printing 20 codes genuinely comes out as two
// full sheets, not one overflowing one.
const LABELS_PER_PAGE = 10;
const LABELS_PER_ROW = 2;

function LabelSheet({ codes, onSelect }: { codes: string[]; onSelect: (code: string) => void }) {
  const pages: string[][] = [];
  for (let i = 0; i < codes.length; i += LABELS_PER_PAGE) {
    pages.push(codes.slice(i, i + LABELS_PER_PAGE));
  }
  return (
    <>
      {pages.map((page, i) => (
        <div
          key={i}
          className="print-label-page"
          style={{
            display: 'grid',
            // mm columns, not px/1fr — see ParcelLabelPrint's own
            // comment on why an absolute physical unit is what
            // actually fixed the sizing/alignment, not just a fixed
            // screen-pixel guess.
            gridTemplateColumns: `repeat(${LABELS_PER_ROW}, ${LABEL_WIDTH_MM}mm)`,
            gap: `${LABEL_GAP_MM}mm`,
            marginBottom: i < pages.length - 1 ? '10mm' : 0,
          }}
        >
          {page.map((code) => (
            // A plain <button> wrapper, not onClick on the label div
            // itself — keeps PrintableLabel purely presentational
            // (it's also used print-only, with no click handler of
            // its own) and gets keyboard/focus semantics for free.
            <button
              key={code}
              type="button"
              onClick={() => onSelect(code)}
              style={{ all: 'unset', cursor: 'pointer', display: 'block' }}
              aria-label={`Attach info to ${code}`}
            >
              <PrintableLabel code={code} />
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
