'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@esoqo/ui';

/**
 * Camera-based QR/barcode scanner for any Esoqo code — the web
 * equivalent of the mobile app's scan flow, for anyone scanning from a
 * laptop/phone browser instead of the app. Decodes whatever
 * html5-qrcode's underlying ZXing decoder recognises (QR and Code128
 * both, the two formats every printed parcel label carries — see
 * ParcelLabelScreen/ParcelLabelPrint) and hands the raw decoded text
 * straight back: every Esoqo QR/barcode encodes either the bare code
 * (e.g. "PKG-T7HZ967") or an esoqo:// payload, and deciding which is
 * which belongs to core-go's resolver, not here.
 *
 * Deliberately knows nothing about parcels, despite having been born
 * in the parcel tracking form. It is a camera that returns a string —
 * /scan, /parcels/track and the staff panel all want exactly that, and
 * three copies of the dynamic-import and teardown dance is three
 * chances to leak a camera stream.
 *
 * Inline, not a full-screen overlay — neither page has an existing
 * modal pattern to lean on, and a scanner that expands in place under
 * the input is simpler to get right (focus trap, Esc-to-close, backdrop
 * click) than inventing one just for this.
 */
export function CodeScanner({
  onScan,
  hint = "Point your camera at the parcel's QR or barcode label.",
}: {
  onScan: (code: string) => void;
  /** What to aim at. Overridden on /scan, where the answer is "any
   *  Esoqo code", not specifically a parcel label. */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // A plain alphanumeric id — Html5Qrcode looks this up via
  // getElementById itself, and useId()'s raw value (":r0:") has
  // colons that are valid HTML but not worth risking against a
  // third-party lookup.
  const viewId = `esoqo-scan-view-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // Html5Qrcode instance, typed loosely — the package ships its own
  // types but importing them at module scope would pull the whole
  // library (and its camera/worker setup) into the initial bundle;
  // dynamic import below keeps that cost to "only once someone
  // actually clicks Scan".
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (cancelled || !containerRef.current) return;
      const scanner = new Html5Qrcode(viewId);
      scannerRef.current = scanner;
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            onScan(decodedText.trim());
            setOpen(false);
          },
          undefined, // per-frame decode failures are normal (nothing in view yet) — not an error to surface
        )
        .catch(() => {
          if (!cancelled) setError("Couldn't access the camera — check your browser's camera permission and try again.");
        });
    });

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        scanner.stop().catch(() => {}).finally(() => scanner.clear());
      }
    };
  }, [open, onScan, viewId]);

  return (
    <>
      <button type="button" className="btn btn-o btn-sm" onClick={() => { setError(null); setOpen((v) => !v); }}>
        <Icon name="qr" size={14} />{open ? 'Close scanner' : 'Scan code'}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div id={viewId} ref={containerRef} style={{ width: '100%', maxWidth: 320, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }} />
          <p className="sub" style={{ margin: '8px 0 0' }}>{hint}</p>
          {error && (
            <p role="alert" style={{ color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 0' }}>
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
