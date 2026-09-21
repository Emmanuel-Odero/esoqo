import type { Metadata } from 'next';
import Link from 'next/link';

import { ScanClient } from './ScanClient';

export const metadata: Metadata = {
  title: 'Scan an Esoqo code',
  description: 'Point your camera at any Esoqo QR or barcode — a parcel label, a ticket, a pickup code — and see what it is.',
  // Noindex for the same reason /t/[code] and /p/[code] carry it: a
  // scanned code is a bearer credential, and although this page holds
  // none itself, every URL a visitor reaches from here does.
  robots: { index: false, follow: false },
};

/**
 * The universal scanner, open to anyone.
 *
 * Static shell, no server data — the resolve happens on interaction, so
 * the page opens instantly on a phone at a counter, which is the only
 * place it will ever really be used.
 */
export default function ScanPage() {
  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Scan</p>
          <h1>Scan an Esoqo code</h1>
          <p className="lead">
            A parcel label, a ticket, a shop shelf, a pickup code — point your camera at it,
            or type the code. No account needed.
          </p>
        </div>
      </section>
      <section className="sec">
        <div className="wrap" style={{ maxWidth: 480 }}>
          <ScanClient />
          <p className="sub" style={{ textAlign: 'center', marginTop: 20, fontSize: '.88rem' }}>
            Expecting a parcel? <Link href="/parcels/track">Track it by code</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
