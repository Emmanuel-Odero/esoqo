import type { Metadata } from 'next';
import type { Route } from 'next';
import Link from 'next/link';
import { Icon, type IconName } from '@esoqo/ui';

export const metadata: Metadata = {
  title: 'Parcels',
  description: 'Send, track and collect parcels across Kenya — no account needed, the fee is settled in person.',
};

/**
 * The Parcels hub.
 *
 * Deliberately static: no data is fetched here, so the page ships as
 * plain HTML and opens immediately even on a slow connection. Each card
 * is a whole-card link to the one page that does the job, and nothing on
 * this page asks anyone to read a wall of text before they can act.
 *
 * The heavier, data-driven work (booking, live tracking) lives behind
 * the cards, so the front door stays fast for everyone.
 */

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';

interface Action {
  href: Route;
  icon: IconName;
  tone: 'g' | 'b' | 'a' | 'r';
  title: string;
  body: string;
  cta: string;
}

const ACTIONS: Action[] = [
  {
    href: '/parcels/send',
    icon: 'send',
    tone: 'g',
    title: 'Send a parcel',
    body: 'Tell us what you’re sending and where it’s going. No account, no online payment — the fee is settled in person.',
    cta: 'Start a booking',
  },
  {
    href: '/parcels/track',
    icon: 'search',
    tone: 'b',
    title: 'Track a parcel',
    body: 'Follow any parcel with its code, or scan the label. See every hand-off from collection to delivery.',
    cta: 'Track by code',
  },
  {
    href: '/parcels/points',
    icon: 'pin',
    tone: 'a',
    title: 'Find a drop-off or pickup point',
    body: 'Hand your parcel in at a station, or have the receiver collect it from a nearby shop instead of waiting at home.',
    cta: 'See points near you',
  },
  {
    href: '/parcels/help',
    icon: 'info',
    tone: 'r',
    title: 'Help & problems',
    body: 'A missed delivery, a parcel waiting somewhere, or something lost or damaged — here is what to do next.',
    cta: 'Get help',
  },
];

export default function ParcelsHubPage() {
  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Send it, follow it, collect it</h1>
          <p className="lead">
            Parcels across Kenya — scanned into custody at every hand-off, released only with the
            receiver’s delivery code. No account needed, and nothing to pay online.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="grid g2">
            {ACTIONS.map((a) => (
              <Link key={a.href} href={a.href} className="acard">
                <span className={`icbox icbox-${a.tone}`}>
                  <Icon name={a.icon} size={20} />
                </span>
                <h3>{a.title}</h3>
                <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>{a.body}</p>
                <span className="go">
                  {a.cta} <Icon name="arrow-right" size={15} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="sec sec-tint" style={{ paddingTop: 54 }}>
        <div className="wrap">
          <div className="grid g3">
            {([
              ['box', 'g', 'Booked in seconds', 'Just the item, the two places and both phone numbers. Nothing else to fill in.'],
              ['qr', 'b', 'Scanned at every step', 'Each hand-off is recorded, so a parcel is never “somewhere on a bus”.'],
              ['key', 'r', 'Released by code only', 'The receiver’s one-time delivery code is the only thing that releases it.'],
            ] as const).map(([icon, tone, title, body]) => (
              <div className="card" key={title}>
                <span className={`icbox icbox-${tone}`} style={{ marginBottom: 12 }}>
                  <Icon name={icon} size={18} />
                </span>
                <h3 style={{ marginBottom: 7, fontSize: '1rem' }}>{title}</h3>
                <p className="sub" style={{ margin: 0, fontSize: '.9rem' }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec" id="business">
        <div className="wrap">
          <div className="grid g2" style={{ alignItems: 'center' }}>
            <div>
              <p className="kicker">For businesses</p>
              <h2 style={{ marginBottom: 10 }}>Shipping in bulk</h2>
              <p className="sub" style={{ maxWidth: '52ch' }}>
                Shops, chamas and companies send in volume — and a store or pickup point of your own
                becomes a collection point for your customers. Open an Esoqo business account to get
                set up.
              </p>
            </div>
            <div className="card">
              <h3 style={{ marginBottom: 8 }}>Ship on Esoqo</h3>
              <p className="sub" style={{ margin: '0 0 16px', fontSize: '.93rem' }}>
                One account covers your store, your cashiers and your parcel desk — with every
                shipment on the same records.
              </p>
              <div className="row">
                <a className="btn btn-p" href={`${APP}/join`}>
                  <Icon name="arrow-right" size={15} />Open a business account
                </a>
                <a className="btn btn-o" href={`${APP}/signin`}>Sign in</a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
