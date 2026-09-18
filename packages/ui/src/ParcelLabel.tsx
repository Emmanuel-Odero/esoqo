'use client';

import { useEffect, useState } from 'react';

/**
 * A parcel label — just the code, its QR and its Code128 barcode.
 * Nothing else prints: sender/receiver/route/weight used to be on
 * here too, but a label rides in the open on a box in transit and
 * gets handled by people who never open the app — the actual
 * shipment details now live behind a scan instead. Shared across
 * every surface that needs to put a real sticker on a real box —
 * originally admin-only (a booked parcel's own label, and blank
 * pre-printed stock), and now a partner company's own front desk too
 * (see apps/app's parcel-org "receive" panel) — which is why this
 * lives here rather than under one app's own route tree.
 */
// Every dimension here is millimetres, not px — screen pixels don't
// map predictably onto a printed page (a browser's print engine
// applies its own page-fit/DPI scaling on top of whatever the CSS
// said), which is exactly what made an earlier pass at this look
// unevenly sized and spaced once actually printed. mm is an absolute
// physical unit: what's specified here is what comes out of the
// printer, full stop, regardless of screen resolution or print
// engine. Sized for a 2-across, 5-down A4 portrait sheet: 2 × 90mm +
// 6mm gap = 186mm width, 5 × 50mm + 4 × 6mm gaps = 274mm height —
// both comfortably inside A4 (210 × 297mm) less a 10mm margin.
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

/**
 * What the QR actually encodes: the public tracking URL, not the bare
 * code.
 *
 * A QR holding the string "PKG-ABC12X" is only useful to something
 * that already knows what a PKG- code is — our own app. Point any
 * ordinary phone camera at it and you get plain text and nowhere to
 * go, which is the common case for a label: it rides in the open on a
 * box, and the person who picks that box up is usually not holding our
 * app. Encoding the URL makes every label work for everyone, and costs
 * the same ~30 modules.
 *
 * The Code128 barcode below deliberately keeps the bare code — a
 * handheld scanner gun is wired into workflows expecting a code, not a
 * URL — so the two marks serve their two different readers. Our own
 * scanner accepts either, stripping a known origin before resolving.
 *
 * Falls back to the bare code when NEXT_PUBLIC_WEB_URL is unset, which
 * is the same judgement notify.withTrack makes about a tracking link
 * it can't build: a label with a code on it is still a working label,
 * whereas one pointing at "undefined/t/PKG-…" is worse than no link at
 * all — and unlike an SMS, this one is printed on adhesive and stuck
 * to a box before anyone notices.
 */
export function trackingUrlFor(code: string, sig?: string): string {
  const base = process.env.NEXT_PUBLIC_WEB_URL?.replace(/\/$/, '');
  if (!base) return code;
  // /p/ is the *label* resolver: it verifies the signature and renders
  // a trust verdict before showing the tracking panel. /t/ stays
  // exactly as it was for SMS, where every character counts against a
  // 160-char segment — see the /t/ page's own comment.
  return sig ? `${base}/p/${code}?k=${sig}` : `${base}/t/${code}`;
}

/**
 * The label as it prints.
 *
 * `sig` is the truncated MAC core-go computes for this code (see
 * fleetqr.SignLabel). It rides in the QR, never in the human-readable
 * text: the printed code is read aloud down phone lines and typed into
 * a tracking box by people standing in shops, and it has a checksum for
 * exactly that reason. Padding it with ten more characters would trade
 * a real, daily usability cost for a check that only matters when
 * somebody is scanning anyway.
 *
 * Without a `sig` the label still prints and still works — it just
 * points at /t/ and resolves as "unverified" rather than "genuine".
 * That is the correct behaviour for every label printed before signing
 * existed.
 */
export function PrintableLabel({
  code, sig, route, orgName, orgLogoUrl, esoqoLogoUrl,
}: {
  code: string; sig?: string;
  /** "KISUMU ▸ NAIROBI", when it's known. The single most useful thing
   *  to someone sorting a pile of boxes at 5am is where each one is
   *  going, readable at arm's length without scanning anything. Blank
   *  stock prints an empty band to be written on by hand, which is the
   *  honest workflow. */
  route?: string;
  /** The courier company this pad was issued to, when it was issued to
   *  one. Prints as "{company} · Managed by Esoqo" under the route
   *  band, so anyone holding the box — scanner or not — sees whose
   *  label it is and who stands behind it. Omitted for shared-pool
   *  stock, which belongs to no company. */
  orgName?: string;
  /** Company logo URL (served via /img/:key). Rendered centered in the
   *  header brand band at a fixed mm size — never overlaid on the QR or
   *  barcode pixels, so scannability is unaffected. Falls back to text
   *  orgName when absent; Esoqo branding always remains. */
  orgLogoUrl?: string;
  /** Esoqo master logo URL. Falls back to the BRAND wordmark when
   *  absent (no logo configured yet), so labels print with our branding
   *  by default. */
  esoqoLogoUrl?: string;
}) {
  const qrSrc = useCodeImage(async (canvas) => {
    const QRCode = await import('qrcode');
    await QRCode.toCanvas(canvas, trackingUrlFor(code, sig), { width: QR_PIXELS, margin: 1 });
  }, [code, sig]);
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
        display: 'flex', flexDirection: 'column', gap: '1.5mm',
        width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm`,
        padding: '2.5mm 3mm', boxSizing: 'border-box',
        // A dashed cut-guide, not a solid box — this is what actually
        // gets cut apart into individual stickers, so the border
        // itself needs to read as "cut along here", not as part of
        // the label's own design.
        border: '1px dashed #999', borderRadius: '2mm',
      }}
    >
      {/* Brand + route band. Logos live here in the header — fixed mm
          sizes, never touching QR/barcode pixels — so a phone camera or
          gun reads clean codes. Company logo centered (the pad owner),
          Esoqo mark left (who stands behind it). Text fallbacks keep
          every label printable with Esoqo branding alone. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '0.4mm solid #111', paddingBottom: '1mm', gap: '2mm',
        minHeight: '7mm',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '1.5mm', minWidth: 0 }}>
          {esoqoLogoUrl ? (
            <img src={esoqoLogoUrl} alt="Esoqo"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              style={{ height: '5.5mm', maxWidth: '18mm', objectFit: 'contain' }} />
          ) : (
            <strong style={{ fontSize: '3.6mm', letterSpacing: '.02em', lineHeight: 1 }}>{BRAND}</strong>
          )}
          {orgLogoUrl && (
            <img src={orgLogoUrl} alt={orgName ?? 'Company logo'}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              style={{ height: '6.5mm', maxWidth: '30mm', objectFit: 'contain' }} />
          )}
        </span>
        <span style={{
          fontSize: '3.4mm', fontWeight: 700, letterSpacing: '.04em', lineHeight: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          // Blank stock prints an empty rule to be written on in the
          // field — which is what actually happens, rather than
          // pretending the route is known at print time.
          borderBottom: route ? 'none' : '0.3mm solid #bbb', minWidth: '28mm', textAlign: 'right',
        }}>
          {route ?? ' '}
        </span>
      </div>
      {/* Company band. Only on company-issued stock: whose pad this is
          and who manages it, readable without scanning anything. */}
      {orgName && (
        <div style={{
          fontSize: '2.8mm', fontWeight: 700, letterSpacing: '.03em', lineHeight: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {orgName} · Managed by {BRAND}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '3mm', flex: 1, minHeight: 0 }}>
        <div style={{ width: '27mm', height: '27mm', flexShrink: 0 }}>
          {qrSrc && <img src={qrSrc} alt={`Tracking QR code for ${code}`} width={QR_PIXELS} height={QR_PIXELS}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2mm', minWidth: 0, flex: 1 }}>
          <strong className="mono" style={{ fontSize: '4.6mm', lineHeight: 1 }}>{code}</strong>
          <div style={{ width: '100%', height: '11mm' }}>
            {barcodeSrc && <img src={barcodeSrc} alt={`Barcode for ${code}`}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
          </div>
          <span style={{ fontSize: '2.4mm', color: '#555', lineHeight: 1 }}>Scan to track</span>
        </div>
      </div>

      {/* The trust footer. Small, always present, and the only thing on
          the label that makes the signature visible to a person — "scan
          it, and if it isn't ours it says so" is a claim worth printing
          precisely because it is checkable. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '0.3mm solid #ddd', paddingTop: '0.8mm', fontSize: '2.3mm', color: '#555', lineHeight: 1,
      }}>
        <span>{sig ? `✓ genuine ${BRAND} label` : `${BRAND} label`}</span>
        <span>{TRACK_HOST}</span>
      </div>
    </div>
  );
}

/**
 * The wordmark, in one place.
 *
 * A rename of the product (Esoko → Esoqo) reaches the label surface
 * long before it reaches package names, deep-link schemes or the `PKG-`
 * code prefix — those are registries with live values in the wild, and
 * renaming them is a migration rather than a rebrand. The public never
 * sees them. This is the string they do see, so it lives alone and
 * changes alone.
 */
const BRAND = 'Esoqo';

/** Printed under the trust line so someone holding a box with no phone
 *  to hand still knows where to go. Derived from the same env var the
 *  QR is built from, so the two can't drift. */
const TRACK_HOST = (process.env.NEXT_PUBLIC_WEB_URL ?? '')
  .replace(/^https?:\/\//, '').replace(/\/$/, '') || 'esoqo.co.ke';

/** The standard "hide everything but what we want" trick — no popup
 * window to fight a blocker on, inherits the calling page's fonts/CSS
 * free. `.print-label` alone just toggles visibility (right for a
 * batch grid already at the page's top level); `.print-modal-escape`
 * additionally repositions to the page's top-left, for one nested
 * inside a modal's own clipping/positioning. `.print-label-page`
 * forces one physical sheet per chunk of 10 — without it the browser
 * would just flow labels across a page break wherever they happen to
 * land, splitting rows raggedly across two sheets instead of a clean
 * 10-per-page batch.
 *
 * The 10mm page margin here is load-bearing, not decorative — it's
 * what LABEL_WIDTH_MM's own comment sizes the 2-across, 5-down grid
 * against (186mm wide, 274mm tall, both inside A4 only once 2 × 10mm
 * margins are subtracted). Changing one without the other reintroduces
 * the exact overflow/misalignment this was fixing.
 *
 * A plain global <style> tag, not styled-jsx's `<style jsx global>` —
 * this component ships from a shared package consumed as raw source by
 * more than one app's own Next build, and a plain tag needs no
 * per-consumer transform to work identically everywhere.
 */
export function PrintStyles() {
  return (
    <style dangerouslySetInnerHTML={{
      __html: `
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
    `,
    }} />
  );
}
