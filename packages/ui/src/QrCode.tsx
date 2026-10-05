'use client';
import { useEffect, useState } from 'react';

/**
 * A plain QR code, client-rendered onto a canvas — the same
 * dynamic-import-`qrcode`-onto-`<canvas>` pattern ParcelLabel already
 * uses, pulled out so anything that just needs "a QR for this string"
 * (an Esoqo ID, a share link) doesn't have to reinvent it.
 */
export function QrCode({ value, size = 200, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = document.createElement('canvas');
    import('qrcode').then((QRCode) => QRCode.toCanvas(canvas, value, { width: size, margin: 1 })).then(() => {
      if (!cancelled) setSrc(canvas.toDataURL('image/png'));
    });
    return () => { cancelled = true; };
  }, [value, size]);

  if (!src) {
    return <div className={className} style={{ width: size, height: size, background: 'var(--paper)', borderRadius: 8 }} aria-hidden="true" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- a data: URL, not a remote image; next/image has nothing to optimise here.
  return <img src={src} width={size} height={size} alt="" className={className} />;
}
