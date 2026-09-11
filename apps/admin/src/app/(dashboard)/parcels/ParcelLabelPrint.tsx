'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@esoko/ui';

/**
 * A parcel label — just the code, its QR and its Code128 barcode.
 * Nothing else prints: sender/receiver/route/weight used to be on
 * here too, but a label rides in the open on a box in transit and
 * gets handled by people who never open the app — the actual
 * shipment details now live behind a scan instead (core-go's GET
 * /v1/parcels/:code/label, which mobile's scan flow resolves a PKG-
 * code through), so the paper itself stays small. Shared between a
 * booked parcel's own label (here) and a blank, not-yet-booked
 * pre-printed label (see the /parcels/labels page) — same rendering
 * either way, since a blank label has no shipment fields yet regardless.
 */
// Every dimension here is millimetres, not px — screen pixels don't
// map predictably onto a printed page (a browser's print engine
// applies its own page-fit/DPI scaling on top of whatever the CSS
// said), which is exactly what made an earlier pass at this look
// unevenly sized and spaced once actually printed. mm is an absolute
// physical unit: what's specified here is what comes out of the
// printer, full stop, regardless of screen resolution or print
// engine. Sized for a 2-across, 5-down A4 portrait sheet (see
// LabelStockPanel's LabelSheet): 2 × 90mm + 6mm gap = 186mm width,
// 5 × 50mm + 4 × 6mm gaps = 274mm height — both comfortably inside
// A4 (210 × 297mm) less this page's 10mm margins.
export const LABEL_WIDTH_MM = 90;
export const LABEL_HEIGHT_MM = 50;
export const LABEL_GAP_MM = 6;

// jsbarcode/qrcode still rasterize onto a <canvas> at a *pixel*
// resolution — that's fine and necessary (a canvas has no native
// physical unit), it just needs to be high enough that shrinking it
// down to the mm sizes above via CSS stays crisp instead of blurring.
// 3–4x the eventual display size at 96dpi covers a typical 300dpi
// print engine's upscaling without visibly softening either code.
const QR_PIXELS = 380; // → displayed at 32mm
const BARCODE_HEIGHT_PIXELS = 110; // → displayed at 16mm

// A real shipping-label layout, not a cramped grid cell: QR on the
// left (the thing someone's actually going to scan with a phone —
// give it the room), code + barcode stacked on the right. Two columns
// means real width to work with, so this uses it instead of just
// stretching the old stacked layout wider.
//
// Rendered as <img>, not live <canvas> elements in the DOM — a canvas
// resized via CSS is notoriously inconsistent across browsers'
// screen *and* print rendering paths (that inconsistency is what
// produced garbled, misaligned barcodes here), and a canvas inside a
// flex row can blow out its container with its own raw pixel size
// regardless of the CSS asked for. Drawing onto an *offscreen* canvas
// and converting to a PNG data URL sidesteps all of that: an <img>'s
// sizing behaviour is simple, uniform, and identical on screen and in
// print, and object-fit: contain guarantees the barcode's aspect
// ratio is preserved (never stretched into illegibility) when it's
// fit into the fixed box below.
function useCodeImage(
  draw: (canvas: HTMLCanvasElement) => Promise<void> | void,
  deps: unknown[],
) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement('canvas');
    Promise.resolve(draw(canvas)).then(() => {
      if (!cancelled) setSrc(canvas.toDataURL('image/png'));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return src;
}

export function PrintableLabel({ code }: { code: string }) {
  const qrSrc = useCodeImage(async (canvas) => {
    const QRCode = await import('qrcode');
    await QRCode.toCanvas(canvas, code, { width: QR_PIXELS, margin: 1 });
  }, [code]);
  const barcodeSrc = useCodeImage(async (canvas) => {
    const { default: JsBarcode } = await import('jsbarcode');
    JsBarcode(canvas, code, {
      format: 'CODE128', height: BARCODE_HEIGHT_PIXELS, width: 2.4, displayValue: false, margin: 6,
    });
  }, [code]);

  return (
    <div
      className="print-label"
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '4mm',
        width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm`,
        padding: '4mm', boxSizing: 'border-box',
        // A dashed cut-guide, not a solid box — this is what actually
        // gets cut apart into individual stickers, so the border
        // itself needs to read as "cut along here", not as part of
        // the label's own design.
        border: '1px dashed #999', borderRadius: '2mm',
      }}
    >
      <div style={{ width: '32mm', height: '32mm', flexShrink: 0 }}>
        {qrSrc && <img src={qrSrc} alt={`QR code for ${code}`} width={QR_PIXELS} height={QR_PIXELS}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3mm', minWidth: 0, flex: 1 }}>
        <strong className="mono" style={{ fontSize: '5mm', lineHeight: 1 }}>{code}</strong>
        <div style={{ width: '100%', height: '16mm' }}>
          {barcodeSrc && <img src={barcodeSrc} alt={`Barcode for ${code}`}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
        </div>
      </div>
    </div>
  );
}

/**
 * The single-parcel "Print label" panel opened from ParcelDetailModal
 * — no fetch needed, the code is already on hand (it's the row's own
 * `parcel.Code`, already-public info shown right above this panel).
 */
export function ParcelLabelPrint({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>Parcel label</strong>
      {/* print-modal-escape, not just print-label — this one label is
          buried inside the parcel detail modal's own positioning/
          overflow, so printing it needs to break out to the page's
          top-left. The batch page's labels (LabelStockPanel) are
          already at the page's top level and print in their normal
          flex-wrap layout instead — see PrintStyles. */}
      <div className="print-modal-escape">
        <PrintableLabel code={code} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-p btn-sm" onClick={() => window.print()}>
          <Icon name="print" size={13} />Print label
        </button>
        <button className="btn btn-o btn-sm" onClick={onClose}>Close</button>
      </div>
      <PrintStyles />
    </div>
  );
}

/** The standard "hide everything but what we want" trick — no popup
 * window to fight a blocker on, inherits this page's fonts/CSS free.
 * `.print-label` alone just toggles visibility (right for a batch grid
 * already at the page's top level); `.print-modal-escape` additionally
 * repositions to the page's top-left, for the one nested inside
 * ParcelDetailModal's own clipping/positioning. `.print-label-page`
 * forces one physical sheet per chunk of 10 (see LabelStockPanel's
 * LabelSheet) — without it the browser would just flow labels across
 * a page break wherever they happen to land, splitting rows raggedly
 * across two sheets instead of a clean 10-per-page batch.
 *
 * The 10mm page margin here is load-bearing, not decorative — it's
 * what LABEL_WIDTH_MM's own comment sizes the 2-across, 5-down grid
 * against (186mm wide, 274mm tall, both inside A4 only once 2 × 10mm
 * margins are subtracted). Changing one without the other reintroduces
 * the exact overflow/misalignment this was fixing. */
export function PrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        @page { size: portrait; margin: 10mm; }
        body * { visibility: hidden; }
        .print-label, .print-label *,
        .print-label-page, .print-label-page *,
        .print-modal-escape, .print-modal-escape * { visibility: visible; }
        .print-modal-escape { position: fixed; top: 0; left: 0; }
        .print-label-page { page-break-after: always; break-after: page; }
        .print-label-page:last-child { page-break-after: auto; break-after: auto; }
        .print-label { break-inside: avoid; page-break-inside: avoid; }
      }
    `}</style>
  );
}
