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
const QR_PIXELS = 380; // → displayed at 24mm (~4x downscale)
const BARCODE_HEIGHT_PIXELS = 110; // → displayed at 11mm

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

/** How many characters of a drop point survive onto the label. Enough
 *  for "MACHAKOS JUNCTION", short enough to stay legible at 5.5mm. */
const DROP_POINT_MAX = 18;

/**
 * The drop point, as it is safe and useful to print large.
 *
 * A counter clerk types `destinationLabel` as free prose, because prose
 * is what a courier actually reads — "Westlands, opposite Sarit". Two
 * things follow, and they pull in opposite directions:
 *
 *   - A handler with no scanner sorting eleven boxes at a stage needs to
 *     know which come off *here*, at arm's length, in bad light. That
 *     argues for printing it big.
 *   - That same prose can be most of a street address, and a label rides
 *     in the open on a box. Printing it verbatim and large would put a
 *     receiver's location on adhesive — exactly the exposure this
 *     component's header comment removed sender/receiver details to
 *     avoid.
 *
 * So only the leading locality survives: the text up to the first comma
 * or dash, uppercased and capped. "Westlands, opposite Sarit" prints
 * WESTLANDS. That is the routing decision a handler makes — which is
 * operational information — with the navigational detail left behind the
 * scan, where the person who needs it already has to look.
 *
 * Returns undefined for anything that reduces to nothing, so the caller
 * prints the blank write-on rule rather than an empty band.
 */
export function dropPointFor(label?: string | null): string | undefined {
  if (!label) return undefined;
  // Split on the separators people actually use between "where" and
  // "where exactly" — a comma, a dash, or a slash.
  const head = label.split(/[,\-/(]/)[0]?.trim() ?? '';
  if (!head) return undefined;
  const upper = head.toUpperCase().replace(/\s+/g, ' ');
  return upper.length > DROP_POINT_MAX
    ? `${upper.slice(0, DROP_POINT_MAX - 1).trimEnd()}…`
    : upper;
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
  /** Where this box is going — "KISUMU ▸ NAIROBI" from an admin print,
   *  or a bare drop point like "NAKURU" from a counter booking. The
   *  single most useful thing to someone sorting a pile of boxes at 5am
   *  is where each one comes off, readable at arm's length without
   *  scanning anything, so this gets its own band rather than competing
   *  with the logos in the header.
   *
   *  Pass a counter's free-text `destinationLabel` through dropPointFor
   *  first — it is prose that can contain a street address, and this
   *  band is printed large on something that rides in the open.
   *
   *  Blank stock prints an empty rule to be written on by hand, which is
   *  the honest workflow. */
  route?: string;
  /** The courier company this pad was issued to, when it was issued to
   *  one. Prints centred in the header, alongside its logo — the pad
   *  owner's own mark and name are what someone picking up the box
   *  should see first. Omitted for shared-pool stock, which belongs to
   *  no company. */
  orgName?: string;
  /** Company logo URL (served via /img/:key). Rendered centred in the
   *  header band next to the company name, at a fixed mm size — never
   *  overlaid on the QR or barcode pixels, so scannability is
   *  unaffected. */
  orgLogoUrl?: string;
  /** Esoqo's own full-name logo (not just a mark — the wordmark image
   *  itself). Prints twice, at two different sizes for two different
   *  jobs: small, top-left in the header, as Esoqo's own constant
   *  signature regardless of whose pad this is; and again, larger, in
   *  the header's centred slot whenever the company has no logo of its
   *  own on file, standing in next to the company name so that slot
   *  isn't empty. It also prints centred in the trust footer, between
   *  "Managed by Esoqo" and the tracking link. Falls back to the BRAND
   *  wordmark as plain text wherever it's absent. */
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
        display: 'flex', flexDirection: 'column', gap: '1mm',
        width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm`,
        padding: '2.5mm 3mm', boxSizing: 'border-box',
        borderRadius: '2mm',
      }}
    >
      {/* Brand band, three zones. Left: Esoqo's own small mark, always
          present — Esoqo's own signature on every label regardless of
          whose pad it is. Centre: the pad owner — its logo and name
          together when it has a logo on file; when it doesn't, Esoqo's
          logo steps in next to the company name so that slot still
          reads as branded rather than empty. Right: an empty spacer
          the same width as the left cell, so the centre column is
          actually centred in the label rather than pushed off-centre
          by the left mark's own width. */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '1.5mm',
        borderBottom: '0.4mm solid #111', paddingBottom: '1mm', minHeight: '7mm',
      }}>
        <span style={{ justifySelf: 'start' }}>
          {esoqoLogoUrl ? (
            <img src={esoqoLogoUrl} alt={BRAND}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              style={{ height: '6mm', maxWidth: '17mm', objectFit: 'contain' }} />
          ) : (
            <strong style={{ fontSize: '2.6mm', letterSpacing: '.02em', lineHeight: 1 }}>{BRAND}</strong>
          )}
        </span>
        <span style={{ justifySelf: 'center', display: 'flex', alignItems: 'center', gap: '1.2mm', minWidth: 0, maxWidth: '46mm' }}>
          {orgLogoUrl ? (
            <img src={orgLogoUrl} alt={orgName ?? 'Company logo'}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              style={{ height: '6.5mm', maxWidth: '20mm', objectFit: 'contain', flexShrink: 0 }} />
          ) : esoqoLogoUrl && orgName && (
            <img src={esoqoLogoUrl} alt="" aria-hidden="true"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              style={{ height: '5.5mm', maxWidth: '15mm', objectFit: 'contain', flexShrink: 0 }} />
          )}
          <strong style={{
            fontSize: orgLogoUrl ? '2.9mm' : '3.4mm', letterSpacing: '.02em', lineHeight: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{orgName ?? BRAND}</strong>
        </span>
        <span />
      </div>

      {/* The drop-point band.
          Full width, 5.5mm, the largest type on the label — because
          "which of these boxes comes off here" is the decision made a
          hundred times a trip, by someone holding a torch rather than a
          scanner. Deliberately the drop point alone and never the full
          address (see dropPointFor): routing information, not a
          receiver's location.
          Blank stock prints an empty rule to be written on in the field,
          which is what actually happens rather than pretending the
          destination is known at print time. */}
      <div style={{
        fontSize: route ? '5.5mm' : '3mm', fontWeight: 800, letterSpacing: '.02em',
        lineHeight: 1.05, minHeight: '6mm', display: 'flex', alignItems: 'center',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        borderBottom: route ? 'none' : '0.3mm solid #bbb',
      }}>
        {route ?? ' '}
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '3mm', flex: 1, minHeight: 0 }}>
        {/* 22mm, down from 24mm, to fund a properly-legible footer logo
            below without pushing the label past its fixed 50mm height.
            Still comfortably scannable: QR_PIXELS is 380, so this is
            still roughly a 4x downscale at 96dpi and the modules stay
            crisp through a 300dpi print engine. */}
        <div style={{ width: '21mm', height: '21mm', flexShrink: 0 }}>
          {qrSrc && <img src={qrSrc} alt={`Tracking QR code for ${code}`} width={QR_PIXELS} height={QR_PIXELS}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1.5mm', minWidth: 0, flex: 1 }}>
          <strong className="mono" style={{ fontSize: '4.6mm', lineHeight: 1 }}>{code}</strong>
          <div style={{ width: '100%', height: '10mm' }}>
            {barcodeSrc && <img src={barcodeSrc} alt={`Barcode for ${code}`}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
          </div>
          <span style={{ fontSize: '2.4mm', color: '#555', lineHeight: 1 }}>Scan to track</span>
        </div>
      </div>

      {/* The trust footer — three parts. Left: the genuineness check and
          "Managed by Esoqo", as plain text (who stands behind the label,
          and whether that's checkable). Centre: Esoqo's own full-name
          logo — sized to be legible without crowding the text either
          side of it, which is why it's capped small even though it's
          the one full wordmark image on the whole label. Right: the
          tracking link. Text sides get `flex: 1` so they share the
          remaining width evenly and don't crush the centred logo. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderTop: '0.3mm solid #ddd', paddingTop: '0.8mm', fontSize: '2.1mm', color: '#555', lineHeight: 1, gap: '1.5mm',
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sig ? '✓ genuine' : 'unverified'} · Managed by {BRAND}
        </span>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {esoqoLogoUrl ? (
            <img src={esoqoLogoUrl} alt={BRAND}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              style={{ height: '6mm', maxWidth: '28mm', objectFit: 'contain' }} />
          ) : (
            <strong style={{ fontSize: '2.6mm' }}>{BRAND}</strong>
          )}
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
          {TRACK_HOST}
        </span>
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
        body { position: relative; }
        body * { visibility: hidden; }
        .print-label, .print-label *,
        .print-label-page, .print-label-page *,
        .print-sheet-root, .print-sheet-root *,
        .print-modal-escape, .print-modal-escape * { visibility: visible; }
        .print-modal-escape { position: fixed; top: 0; left: 0; }
        /* visibility:hidden hides everything else without removing
           it from layout, so whatever precedes a print target in the
           DOM (page chrome, cards, controls) still reserves its own
           height and pushes the target down from the sheet's true top
           edge. A single position:fixed escape (above) is fine for
           one always-one-page label, but is wrong for a POSSIBLY
           multi-page batch: fixed-positioned boxes are defined to
           repeat on every printed page rather than paginate, which
           would print every page's labels stacked on page one. Using
           position:absolute instead — anchored to body, made
           positioned just above — keeps the group's pages in normal
           flow relative to EACH OTHER (so page-break-after below still
           separates them) while pulling the whole group to start at
           the sheet's real top-left regardless of what's hidden above
           it. */
        .print-sheet-root { position: absolute; top: 0; left: 0; width: 100%; }
        .print-label-page { page-break-after: always; break-after: page; }
        .print-label-page:last-child { page-break-after: auto; break-after: auto; }
        .print-label { break-inside: avoid; page-break-inside: avoid; }
        /* ScaledLabel fits a preview to whatever on-screen container
           it's in — including shrinking below 90×50mm on a narrow
           phone. That transform must never reach paper: a preview
           scaled down to fit a small screen is not a smaller sticker. */
        .esoqo-scaled-label { transform: none !important; }
        /* LabelPrintSheet's on-screen "paper" framing — a bordered,
           shadowed box pre-shrunk by previewScale so a whole page
           fits a card — is exactly that: an on-screen affordance. Print
           already gets a real page with a real margin from @page
           above; printing this box verbatim would shrink every label to
           a fraction of its true 90×50mm size AND double up the page
           margin (a literal 210mm-wide box, complete with its own
           padding standing in for that margin, inside a canvas @page
           already inset by 10mm). Resetting --lp-scale to 1 restores
           true size (every mm dimension in LabelPrintSheet reads the
           scale through this variable); stripping the frame's own
           box model lets the grid flow naturally inside the page's own
           margin instead of nesting a second one inside it. */
        .lp-sheet-scale {
          --lp-scale: 1 !important;
          width: auto !important; height: auto !important; aspect-ratio: auto !important;
          max-width: none !important; border: none !important; box-shadow: none !important;
          padding: 0 !important; background: none !important; overflow: visible !important;
        }
      }
    `,
    }} />
  );
}
