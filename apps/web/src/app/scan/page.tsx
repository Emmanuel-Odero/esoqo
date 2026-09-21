import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';

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
        <div className="wrap" style={{ textAlign: 'center' }}>
          <span className="icbox" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', width: 52, height: 52, borderRadius: 13, margin: '0 auto 16px' }}>
            <Icon name="qr" size={28} />
          </span>
          <p className="kicker" style={{ justifyContent: 'center' }}>Scan</p>
          <h1 style={{ margin: '0 auto' }}>Scan an Esoqo code</h1>
          <p className="lead" style={{ margin: '12px auto 0' }}>
            A parcel label, a ticket, a shop shelf, a pickup code — point your camera at it,
            or type the code. No account needed.
          </p>
        </div>
      </section>
      <section className="sec">
        <div className="wrap" style={{ maxWidth: 680 }}>
          <ScanClient />

          <h2 style={{ margin: '44px 0 16px', textAlign: 'center' }}>What can you scan?</h2>
          <div className="grid g3">
            {([
              ['package', 'g', 'Parcels & pickup', 'Every parcel label and counter pickup slip. Parcels open full tracking — status, map and timeline.'],
              ['tag', 'b', 'Tickets & fares', 'Event tickets and bus fare receipts. This page confirms they are real; check-in still happens at the gate.'],
              ['shop', 'a', 'Shops & tables', 'Shelf tags, shop codes and table QRs jump straight to the shop or its menu with the table attached.'],
            ] as const).map(([icon, tone, title, body]) => (
              <div className="card" key={title}>
                <span className={`icbox icbox-${tone}`} style={{ marginBottom: 13 }}>
                  <Icon name={icon} size={20} />
                </span>
                <h3 style={{ marginBottom: 8 }}>{title}</h3>
                <p className="sub" style={{ fontSize: '.91rem', margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>

          <div className="note n-blue" style={{ marginTop: 22 }}>
            <Icon name="info" size={18} />
            <p>
              <strong>At a counter with no camera?</strong> Every code is printed under its QR —
              type it exactly as shown. Voucher and trip codes open in the Esoqo app wallet instead.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
