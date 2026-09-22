'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LABEL_GAP_MM, LABEL_HEIGHT_MM, LABEL_WIDTH_MM, PrintableLabel, PrintStyles } from './ParcelLabel';
import { Icon } from './Icon';

// Same fixed mm→px ratio ScaledLabel uses — see its own comment on why
// this (not device pixel density) is the right conversion.
const PX_PER_MM = 96 / 25.4;

export interface PrintLabelItem {
  code: string;
  sig?: string;
  /** This label's own route text, if it has one — see ParcelLabel's
   *  own doc on the route band. Per-item because a batch being printed
   *  together can span several routes. */
  route?: string;
}

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

/** The sheet's own w×h in mm, orientation applied — one place both the
 *  fit check and the print preview read it from, so they can't drift. */
export function paperDimsMm(layout: PrintLayout): { w: number; h: number } {
  const sheet = PAPER_MM[layout.paper];
  return layout.orientation === 'portrait'
    ? { w: sheet.w, h: sheet.h }
    : { w: sheet.h, h: sheet.w };
}

/**
 * How big a label actually prints, given the chosen grid.
 *
 * Labels don't have one fixed physical size — the point of choosing
 * columns × rows is to say how many go on a sheet, and each one grows
 * or shrinks to fill its share of the page: fewer per page means
 * bigger stickers, not more blank paper around small ones. `cellW`/
 * `cellH` is that share (page, minus margin, divided evenly with gaps
 * subtracted); `fillScale` is how much the label's native 90×50mm
 * design has to scale to fit inside it without distorting — capped by
 * whichever dimension is tighter, so a cell that's proportionally
 * wider or taller than 90:50 leaves a little breathing room on one
 * axis rather than stretching the QR code into an oval.
 */
export interface PrintSizing {
  cellW: number; cellH: number; fillScale: number;
  /** The label's actual printed footprint, aspect preserved. */
  printedW: number; printedH: number;
}

export function computePrintSizing(layout: PrintLayout): PrintSizing {
  const { w: pw, h: ph } = paperDimsMm(layout);
  const columns = Math.max(1, layout.columns);
  const rows = Math.max(1, layout.rows);
  const availW = pw - MARGIN_MM * 2;
  const availH = ph - MARGIN_MM * 2;
  const cellW = (availW - (columns - 1) * LABEL_GAP_MM) / columns;
  const cellH = (availH - (rows - 1) * LABEL_GAP_MM) / rows;
  const fillScale = Math.max(0.1, Math.min(cellW / LABEL_WIDTH_MM, cellH / LABEL_HEIGHT_MM));
  return { cellW, cellH, fillScale, printedW: LABEL_WIDTH_MM * fillScale, printedH: LABEL_HEIGHT_MM * fillScale };
}

// Below this, the QR and barcode are still technically decodable but
// small enough that a phone camera starts struggling in anything but
// good light — worth a nudge rather than a silent surprise at the
// printer.
const SMALL_PRINT_THRESHOLD = 0.32;

/**
 * Print studio: columns × rows per sheet on a paper size, with a live
 * WYSIWYG preview of exactly how stickers fall on each page.
 *
 * One component backs both the Esoqo dashboard and the courier portal
 * so "20 labels per page" means the same grid in both places. A label
 * has no fixed print size — see computePrintSizing — so there's
 * nothing here to "overflow" the page; the grid always fits by
 * construction, it just makes the stickers bigger or smaller.
 */
export function PrintLayoutControls({
  layout, onChange,
}: {
  layout: PrintLayout; onChange: (l: PrintLayout) => void;
}) {
  const perPage = labelsPerPage(layout);
  const sizing = computePrintSizing(layout);
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
        {perPage} per page · prints at ~{sizing.printedW.toFixed(0)}×{sizing.printedH.toFixed(0)}mm
      </span>
      {sizing.fillScale < SMALL_PRINT_THRESHOLD && (
        <span role="alert" style={{ fontSize: '.8rem', color: 'var(--red)', maxWidth: 300 }}>
          That's small enough the QR/barcode may be hard to scan — reduce rows or columns to print bigger.
        </span>
      )}
    </div>
  );
}

export function LabelPrintSheet({
  labels, layout, orgName, orgLogoUrl, esoqoLogoUrl, previewScale, onReadyChange,
}: {
  labels: PrintLabelItem[]; layout: PrintLayout; orgName?: string; orgLogoUrl?: string; esoqoLogoUrl?: string;
  /** 0..1 shrink for the on-screen preview so a full page fits the card. Print always uses real mm. */
  previewScale?: number;
  /** How many of `labels` have actually finished drawing their QR and
   *  barcode, called every time that count changes (starting at
   *  (0, labels.length) the moment this list of codes is set) — see
   *  PrintableLabel's own onReady doc on why a bulk print needs this:
   *  window.print() has no idea 50-100 canvas draws are still in
   *  flight, and used to reliably beat some of them to the printer. */
  onReadyChange?: (ready: number, total: number) => void;
}) {
  const perPage = labelsPerPage(layout);
  const codesKey = labels.map((l) => l.code).join(',');
  const readyCodesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    readyCodesRef.current = new Set();
    onReadyChange?.(0, labels.length);
    // Reset only when the actual set of codes changes — a fresh
    // selection means fresh drawing, not stale counts from the last
    // one. onReadyChange and labels.length are deliberately excluded:
    // including them would re-fire this on every parent re-render a
    // readiness tick itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey]);
  const pages = useMemo(() => {
    const out: PrintLabelItem[][] = [];
    for (let i = 0; i < labels.length; i += perPage) out.push(labels.slice(i, i + perPage));
    return out;
  }, [labels, perPage]);
  const { w: pw, h: ph } = paperDimsMm(layout);
  const scale = previewScale ?? 1;
  const { cellW, cellH, fillScale } = computePrintSizing(layout);
  // Cut-guide positions: the mm centre of each gutter between cells,
  // one dashed line per cut rather than two adjacent cell borders
  // touching (which is what a per-label border gave — a doubled,
  // slightly-off-centre edge instead of one clean line to cut along).
  // Read off the actual cell size, not the label's native 90×50mm —
  // the cell is whatever computePrintSizing decided fills the page.
  const colCuts = Array.from({ length: Math.max(0, layout.columns - 1) }, (_, i) =>
    i * (cellW + LABEL_GAP_MM) + cellW + LABEL_GAP_MM / 2);
  const rowCuts = Array.from({ length: Math.max(0, layout.rows - 1) }, (_, i) =>
    i * (cellH + LABEL_GAP_MM) + cellH + LABEL_GAP_MM / 2);

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
              an on-screen-only shrink (see `previewScale`'s own doc),
              separate from `fillScale` above (which decides the
              label's actual printed size and applies equally on screen
              and in print) — every mm dimension below reads `scale`
              through the CSS variable --lp-scale rather than baking it
              into a literal value, so PrintStyles' own `.lp-sheet-scale`
              rule can force it back to 1 under @media print. Without
              that reset this whole "paper" box printed at whatever
              fraction the on-screen preview happened to be shrunk to —
              a page that looks right on screen but comes out of the
              printer at a fraction of real size, cut lines included. */}
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
              margin: '0 auto',
            } as React.CSSProperties}
          >
            <div style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: `repeat(${layout.columns}, calc(${cellW}mm * var(--lp-scale)))`,
              gridAutoRows: `calc(${cellH}mm * var(--lp-scale))`,
              gap: `calc(${LABEL_GAP_MM}mm * var(--lp-scale))`,
              alignContent: 'start',
            }}>
              {page.map(({ code, sig, route }) => (
                <div key={code} style={{
                  width: `calc(${cellW}mm * var(--lp-scale))`,
                  height: `calc(${cellH}mm * var(--lp-scale))`,
                  overflow: 'hidden',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {/* The label always renders at its native 90×50mm and
                      scales up or down to fill the cell — fillScale
                      from computePrintSizing, combined with --lp-scale
                      (the separate, screen-preview-only shrink, reset
                      to 1 at print time). Centred rather than pinned to
                      a corner: fillScale preserves aspect ratio, so a
                      cell whose own proportions don't match 90:50
                      leaves slack on one axis, and centring is the
                      option that doesn't read as mis-cut. */}
                  <div style={{
                    transform: `scale(calc(${fillScale} * var(--lp-scale)))`, transformOrigin: 'center',
                    width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm`, flexShrink: 0,
                  }}>
                    <PrintableLabel code={code} sig={sig} route={route} orgName={orgName} orgLogoUrl={orgLogoUrl} esoqoLogoUrl={esoqoLogoUrl}
                      onReady={() => {
                        readyCodesRef.current.add(code);
                        onReadyChange?.(readyCodesRef.current.size, labels.length);
                      }} />
                  </div>
                </div>
              ))}
              {/* Cut guides — real trim lines through the gutters (see
                  colCuts/rowCuts above), not just each label's own edge. */}
              {colCuts.map((mm, i) => (
                <div key={`vcut${i}`} aria-hidden style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `calc(${mm}mm * var(--lp-scale))`,
                  borderLeft: '1px dashed #999', pointerEvents: 'none',
                }} />
              ))}
              {rowCuts.map((mm, i) => (
                <div key={`hcut${i}`} aria-hidden style={{
                  position: 'absolute', left: 0, right: 0,
                  top: `calc(${mm}mm * var(--lp-scale))`,
                  borderTop: '1px dashed #999', pointerEvents: 'none',
                }} />
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
  labels, selected, onToggle, onSelectAll, onClear, orgName, orgLogoUrl, esoqoLogoUrl, title, collapsible = false,
}: {
  labels: PrintLabelItem[];
  selected: Set<string>;
  onToggle: (code: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  orgName?: string; orgLogoUrl?: string; esoqoLogoUrl?: string;
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
  // See LabelPrintSheet's own onReadyChange doc — a bulk selection can
  // still be mid-draw when someone reaches for Print, which is what
  // actually printed blank QR/barcode boxes at 50-100 labels.
  const [ready, setReady] = useState(0);

  // Fills the card's own width instead of a fixed guess — the same
  // "measure the container, scale to fit" ScaledLabel already does for
  // a single label, applied here to the whole printed page so "too
  // small, not centred" isn't a magic previewScale number that happens
  // to work on one screen width and not another.
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(0.55);
  const { w: paperWidthMm } = paperDimsMm(layout);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (!width) return;
      setPreviewScale(Math.max(0.3, Math.min(1, width / (paperWidthMm * PX_PER_MM))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [paperWidthMm]);

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
          <button className="btn btn-o btn-sm" disabled={toPrint.length === 0 || ready < toPrint.length} onClick={() => window.print()}>
            <Icon name="print" size={13} />
            {toPrint.length === 0
              ? 'Print selected'
              : ready < toPrint.length
                ? `Preparing ${ready}/${toPrint.length}…`
                : `Print ${toPrint.length} selected`}
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
        <div ref={previewRef} style={{ width: '100%' }}>
          <LabelPrintSheet labels={toPrint} layout={layout} orgName={orgName} orgLogoUrl={orgLogoUrl} esoqoLogoUrl={esoqoLogoUrl}
            previewScale={previewScale} onReadyChange={(r) => setReady(r)} />
        </div>
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
