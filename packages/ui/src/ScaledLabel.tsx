'use client';

import { useEffect, useRef, useState } from 'react';
import { LABEL_HEIGHT_MM, LABEL_WIDTH_MM, PrintableLabel } from './ParcelLabel';

// The CSS spec's fixed mm→px ratio (96dpi ÷ 25.4mm/in) — not the
// device's actual pixel density, which is irrelevant here: this is
// converting the *same* unit the browser itself uses to lay out an
// element sized in `mm`, so the scale factor below lines up with what
// actually renders regardless of screen DPI.
const PX_PER_MM = 96 / 25.4;
const NATURAL_WIDTH_PX = LABEL_WIDTH_MM * PX_PER_MM;
const NATURAL_HEIGHT_PX = LABEL_HEIGHT_MM * PX_PER_MM;

/**
 * `PrintableLabel`, fitted to whatever container it's dropped into.
 *
 * PrintableLabel is deliberately a fixed physical size (90×50mm) —
 * right for a sticker, wrong for a chunk of on-screen UI: dropped
 * straight into a drawer or a card, it either overflows a narrow phone
 * (the drawer/panel is often under 340px of usable width once padding
 * is subtracted) or sits smaller than it should on a roomy desktop
 * panel. A static breakpoint can't track that — the same component
 * lands inside containers of very different widths across the portal.
 *
 * So this measures its own container with a ResizeObserver and scales
 * the label to fill it, up to `maxScale` so it doesn't balloon past a
 * sensible on-screen size just because the container is wide. Print
 * output is unaffected: PrintableLabel's own root carries
 * `.print-label`, and the transform this component applies is reset
 * to the real 90×50mm under `@media print` (see PrintStyles' own
 * comment) — a scaled-down preview on a narrow phone must never
 * become a scaled-down sticker.
 */
export function ScaledLabel({
  code, sig, route, orgName, orgLogoUrl, esoqoLogoUrl, maxScale = 1.15,
}: {
  code: string;
  sig?: string;
  route?: string;
  orgName?: string;
  orgLogoUrl?: string;
  esoqoLogoUrl?: string;
  /** Upper bound so a wide container (a desktop drawer) doesn't blow
   *  the label up far past its printed size. */
  maxScale?: number;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (!width) return;
      // Clamped below, too — a container narrower than we've ever
      // actually seen (an embed, a squeezed split view) should still
      // render a readable label rather than shrinking to nothing.
      setScale(Math.max(0.5, Math.min(maxScale, width / NATURAL_WIDTH_PX)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxScale]);

  return (
    <div ref={outerRef} style={{ width: '100%' }}>
      <div style={{ width: NATURAL_WIDTH_PX * scale, height: NATURAL_HEIGHT_PX * scale, margin: '0 auto' }}>
        <div
          className="esoqo-scaled-label"
          style={{
            width: `${LABEL_WIDTH_MM}mm`, height: `${LABEL_HEIGHT_MM}mm`,
            transform: `scale(${scale})`, transformOrigin: 'top left',
          }}
        >
          <PrintableLabel code={code} sig={sig} route={route} orgName={orgName} orgLogoUrl={orgLogoUrl} esoqoLogoUrl={esoqoLogoUrl} />
        </div>
      </div>
    </div>
  );
}
