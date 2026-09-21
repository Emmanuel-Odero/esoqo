'use client';

import { useMemo, useState } from 'react';
import { LABEL_GAP_MM, LABEL_HEIGHT_MM, LABEL_WIDTH_MM, PrintableLabel, PrintStyles } from './ParcelLabel';
import { Icon } from './Icon';

export interface PrintLabelItem { code: string; sig?: string }

export type PrintPaper = 'A4' | 'Letter' | 'A5';

export interface PrintLayout {
  columns: number;
  rows: number;
  paper: PrintPaper;
  orientation: 'portrait' | 'landscape';
}

export const DEFAULT_PRINT_LAYOUT: PrintLayout = { columns: 2, rows: 5, paper: 'A4', orientation: 'portrait' };

export function labelsPerPage(layout: PrintLayout): number {
  return Math.max(1, layout.columns) * Math.max(1, layout.rows);
}

const PAPER_MM: Record<PrintPaper, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
  A5: { w: 148, h: 210 },
};

const MARGIN_MM = 10;

function fitsPaper(layout: PrintLayout): { fits: boolean; needW: number; needH: number; availW: number; availH: number } {
  const sheet = PAPER_MM[layout.paper];
  const pw = layout.orientation === 'portrait' ? sheet.w : sheet.h;
  const ph = layout.orientation === 'portrait' ? sheet.h : sheet.w;
  const availW = pw - MARGIN_MM * 2;
  const availH = ph - MARGIN_MM * 2;
  const needW = layout.columns * LABEL_WIDTH_MM + (layout.columns - 1) * LABEL_GAP_MM;
  const needH = layout.rows * LABEL_HEIGHT_MM + (layout.rows - 1) * LABEL_GAP_MM;
  return { fits: needW <= availW + 0.01 && needH <= availH + 0.01, needW, needH, availW, availH };
}

/**
 * Print studio: columns × rows per sheet on a paper size, with a live
 * WYSIWYG preview of exactly how stickers fall on each page.
 *
 * One component backs both the Esoqo dashboard and the courier portal
 * so "20 labels per page" means the same grid in both places. Labels
 * are fixed 90×50mm physical stickers; the grid only changes how many
 * fit per sheet, never the sticker size.
 */
export function PrintLayoutControls({
  layout, onChange,
}: {
  layout: PrintLayout; onChange: (l: PrintLayout) => void;
}) {
  const perPage = labelsPerPage(layout);
  const fit = fitsPaper(layout);
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label className="sub">Columns
        <input type="number" min={1} max={6} value={layout.columns}
          onChange={(e) => onChange({ ...layout, columns: clampNum(Number(e.target.value) || 1, 1, 6) })}
          style={box} aria-label="Labels across each page" />
      </label>
      <label className="sub">Rows
        <input type="number" min={1} max={12} value={layout.rows}
          onChange={(e) => onChange({ ...layout, rows: clampNum(Number(e.target.value) || 1, 1, 12) })}
          style={box} aria-label="Labels down each page" />
      </label>
      <label className="sub">Paper
        <select value={layout.paper} onChange={(e) => onChange({ ...layout, paper: e.target.value as PrintPaper })} style={{ ...box, minWidth: 110 }}>
          <option value="A4">A4</option>
          <option value="Letter">Letter</option>
          <option value="A5">A5</option>
        </select>
      </label>
      <label className="sub">Orientation
        <select value={layout.orientation} onChange={(e) => onChange({ ...layout, orientation: e.target.value as PrintLayout['orientation'] })} style={{ ...box, minWidth: 120 }}>
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </label>
      <span className="sub" style={{ fontWeight: 700 }} aria-live="polite">
        {perPage} per page
      </span>
      {!fit.fits && (
        <span role="alert" style={{ fontSize: '.8rem', color: 'var(--red)', maxWidth: 300 }}>
          {layout.columns}×{layout.rows} needs {fit.needW.toFixed(0)}×{fit.needH.toFixed(0)}mm but {layout.paper} {layout.orientation} fits {fit.availW.toFixed(0)}×{fit.availH.toFixed(0)}mm — labels will overflow. Reduce rows or columns.
        </span>
      )}
    </div>
  );
}

export function LabelPrintSheet({
  labels, layout, orgName, orgLogoUrl, previewScale,
}: {
  labels: PrintLabelItem[]; layout: PrintLayout; orgName?: string; orgLogoUrl?: string;
  /** 0..1 shrink for the on-screen preview so a full page fits the card. Print always uses real mm. */
  previewScale?: number;
}) {
  const perPage = labelsPerPage(layout);
  const pages = useMemo(() => {
    const out: PrintLabelItem[][] = [];
    for (let i = 0; i < labels.length; i += perPage) out.push(labels.slice(i, i + perPage));
    return out;
  }, [labels, perPage]);
  const sheet = PAPER_MM[layout.paper];
  const pw = layout.orientation === 'portrait' ? sheet.w : sheet.h;
  const ph = layout.orientation === 'portrait' ? sheet.h : sheet.w;
  const scale = previewScale ?? 1;

  if (labels.length === 0) return null;
  return (
    <>
      <style>{`@media print { .print-page-caption { display: none !important; } }`}</style>
      {/* Everywhere this renders, it sits behind other content in the
          DOM — a "stock belongs to" card, layout controls, the code
          chips — that print's `visibility: hidden` hack (see
          PrintStyles) hides but does NOT remove from layout:
          `visibility: hidden` preserves an element's box, it just
          stops painting it. Left alone, that hidden content still
          pushes these pages down from the true top of the sheet by
          however tall it is, so the first page prints with a large
          blank gap (or starts partway down, or off the bottom of page
          one entirely) instead of flush at the paper's edge — the
          other half of "labels land in the wrong place on the page."
          `.print-sheet-root` (see PrintStyles) pulls the whole group
          out of that flow via `position: absolute; top: 0; left: 0`,
          so pagination starts at the physical page origin regardless
          of what precedes it. It stays a single wrapper — not one
          escape per page — because pages must remain in normal flow
          RELATIVE TO EACH OTHER for `page-break-after` to keep
          separating them; a `position: fixed` per page would instead
          repeat every page's content on every sheet (paged media's
          defined behaviour for fixed-positioned boxes), which is the
          one thing this data structure never wants. */}
      <div className="print-sheet-root">
      {pages.map((page, i) => (
        <figure key={i} className="print-label-page" style={{ margin: '0 0 14px' }}>
          <figcaption className="sub print-page-caption" style={{ marginBottom: 6 }}>
            Page {i + 1} of {pages.length} — {page.length} label{page.length === 1 ? '' : 's'} · {layout.columns} across × {layout.rows} down on {layout.paper} {layout.orientation}
          </figcaption>
          {/* The paper itself: a bordered sheet at real aspect ratio so
              what you see is where stickers land on screen. `scale` is
              an on-screen-only shrink (see `previewScale`'s own doc) —
              every mm dimension below reads it through the CSS variable
              --lp-scale rather than baking it into a literal value, so
              PrintStyles' own `.lp-sheet-scale` rule can force it back
              to 1 under @media print. Without that reset this whole
              "paper" box — including the 90×50mm labels inside it —
              printed at 55% of its real physical size: exactly the
              "labels land in the wrong place on the sheet" bug this
              fixes, since a courier's pre-cut label stock is cut to the
              REAL 90×50mm, not 55% of it. */}
          <div
            className="lp-sheet-scale"
            style={{
              '--lp-scale': scale,
              width: `calc(${pw}mm * var(--lp-scale))`, maxWidth: '100%',
              aspectRatio: `${pw} / ${ph}`,
              border: '1.5px solid var(--line)', borderRadius: 8, background: '#fff',
              boxShadow: '0 2px 10px rgba(0,0,0,.08)',
              padding: `calc(${MARGIN_MM}mm * var(--lp-scale))`,
              boxSizing: 'border-box', overflow: 'hidden',
            } as React.CSSProperties}
          >
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${layout.columns}, calc(${LABEL_WIDTH_MM}mm * var(--lp-scale)))`,
              gridAutoRows: `calc(${LABEL_HEIGHT_MM}mm * var(--lp-scale))`,
              gap: `calc(${LABEL_GAP_MM}mm * var(--lp-scale))`,
              alignContent: 'start',
            }}>
              {page.map(({ code, sig }) => (
                <div key={code} style={{
                  width: `calc(${LABEL_WIDTH_MM}mm * var(--lp-scale))`,
                  height: `calc(${LABEL_HEIGHT_MM}mm * var(--lp-scale))`,
                  overflow: 'hidden',
                }}>
                  <div style={{ transform: 'scale(var(--lp-scale))', transformOrigin: 'top left', width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm` }}>
                    <PrintableLabel code={code} sig={sig} orgName={orgName} orgLogoUrl={orgLogoUrl} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </figure>
      ))}
      </div>
      <PrintStyles />
    </>
  );
}

/**
 * One checkbox list + studio + preview block reused by both dashboards.
 * The caller owns selection state (so register tables can share it);
 * this owns only the print layout and the print action.
 */
export function SelectableLabelPrintBlock({
  labels, selected, onToggle, onSelectAll, onClear, orgName, orgLogoUrl, title, collapsible = false,
}: {
  labels: PrintLabelItem[];
  selected: Set<string>;
  onToggle: (code: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  orgName?: string; orgLogoUrl?: string;
  title: string;
  /** Lets dense operational screens keep the print studio out of the way until needed. */
  collapsible?: boolean;
}) {
  const [layout, setLayout] = useState<PrintLayout>(DEFAULT_PRINT_LAYOUT);
  const [open, setOpen] = useState(!collapsible);
  const chosen = labels.filter((l) => selected.has(l.code));
  const toPrint = chosen.length > 0 ? chosen : [];
  const perPage = labelsPerPage(layout);
  const pages = toPrint.length === 0 ? 0 : Math.ceil(toPrint.length / perPage);

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <strong>{title} — {labels.length} label{labels.length === 1 ? '' : 's'} · {selected.size} selected{pages > 0 && ` · ${pages} page${pages === 1 ? '' : 's'} at ${perPage}/page`}</strong>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {collapsible && <button className="btn btn-o btn-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? 'Hide print tools' : 'Print labels'}<Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
          </button>}
          {open && <>
          <button className="btn btn-o btn-sm" onClick={onSelectAll}><Icon name="check" size={13} />Select all</button>
          <button className="btn btn-o btn-sm" onClick={onClear}>Clear</button>
          <button className="btn btn-o btn-sm" disabled={toPrint.length === 0} onClick={() => window.print()}>
            <Icon name="print" size={13} />Print {toPrint.length > 0 ? `${toPrint.length} selected` : 'selected'}
          </button>
          </>}
        </div>
      </div>
      {open && <>
      <PrintLayoutControls layout={layout} onChange={setLayout} />
      {labels.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, marginBottom: 12 }} role="group" aria-label="Choose labels to print">
          {labels.map((l) => {
            const on = selected.has(l.code);
            return (
              <button key={l.code} type="button" onClick={() => onToggle(l.code)} aria-pressed={on}
                className="mono" title={on ? `Remove ${l.code} from the print selection` : `Add ${l.code} to the print selection`}
                style={{
                  padding: '5px 9px', borderRadius: 20, fontSize: '.78rem', cursor: 'pointer',
                  border: on ? '1.5px solid var(--ink)' : '1.5px solid var(--line)',
                  background: on ? 'var(--ink)' : 'transparent', color: on ? '#fff' : 'var(--tx)',
                }}>
                {on ? '✓ ' : ''}{l.code}
              </button>
            );
          })}
        </div>
      )}
      {toPrint.length > 0 ? (
        <LabelPrintSheet labels={toPrint} layout={layout} orgName={orgName} orgLogoUrl={orgLogoUrl} previewScale={0.55} />
      ) : (
        <p className="sub" style={{ margin: '4px 0 0' }}>Tick the labels above to preview exactly how they fall on the {layout.paper} page before printing.</p>
      )}
      </>}
    </div>
  );
}

const box: React.CSSProperties = {
  display: 'block', width: 90, padding: '6px 8px',
  border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2,
};

function clampNum(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n) || lo));
}
