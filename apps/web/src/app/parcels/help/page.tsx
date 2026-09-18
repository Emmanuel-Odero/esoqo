import type { Metadata } from 'next';
import type { Route } from 'next';
import Link from 'next/link';
import { Icon, type IconName } from '@esoqo/ui';

export const metadata: Metadata = {
  title: 'Parcel help',
  description: 'What to do if a delivery was missed, a parcel is waiting somewhere, or something was lost or damaged.',
};

/**
 * Static on purpose — this is the page someone opens when something has
 * already gone wrong, so it must not wait on a backend call to render.
 * Each entry says what happened and the single next action; nothing
 * here asks a worried person to read a policy.
 */

interface HelpItem {
  icon: IconName;
  tone: 'g' | 'b' | 'a' | 'r';
  title: string;
  body: string;
  action?: { label: string; href: Route };
}

const ITEMS: HelpItem[] = [
  {
    icon: 'search',
    tone: 'b',
    title: '“Where is my parcel?”',
    body: 'Enter the code from your text message, or scan the label. The tracker shows every hand-off with the time it happened, and tells you if a delivery was attempted.',
    action: { label: 'Track a parcel', href: '/parcels/track' },
  },
  {
    icon: 'clock',
    tone: 'a',
    title: 'A delivery was missed',
    body: 'The courier will try again — up to three attempts. If all three fail, the parcel goes back to the sender. If you know you won’t be in, choose a pickup point at booking time instead.',
  },
  {
    icon: 'shop',
    tone: 'a',
    title: 'It’s waiting at a shop',
    body: 'When a parcel is held at a pickup point, the tracker shows the shop, its opening hours and its phone number. Bring the delivery code texted to the receiver to collect it.',
  },
  {
    icon: 'alert-triangle',
    tone: 'r',
    title: 'Lost, damaged or wrong item',
    body: 'Report it as soon as you notice. Keep the parcel and any packaging until we tell you otherwise, and have the tracking code ready — it is what lets us open the case against the right shipment.',
    action: { label: 'Talk to a person', href: '/help#contact' },
  },
  {
    icon: 'phone',
    tone: 'b',
    title: 'The wrong phone number was entered',
    body: 'The receiver’s number is where their delivery code is texted. If it’s wrong, call us with the tracking code before the parcel reaches its destination so we can correct it in time.',
    action: { label: 'Talk to a person', href: '/help#contact' },
  },
  {
    icon: 'shield-check',
    tone: 'g',
    title: 'A label or message looks fake',
    body: 'Scan the label’s QR with the tracker — a genuine Esoqo label is confirmed on the spot. If a message asks you to pay online for a parcel, it is not from us: nothing on Esoqo is paid online.',
    action: { label: 'Report fraud', href: '/trust#fraud' },
  },
];

export default function ParcelHelpPage() {
  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Help &amp; problems</h1>
          <p className="lead">Find what happened, and what to do next. Nothing to read before you can act.</p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="grid g2">
            {ITEMS.map((item) => (
              <div className="card" key={item.title}>
                <span className={`icbox icbox-${item.tone}`} style={{ marginBottom: 12 }}>
                  <Icon name={item.icon} size={18} />
                </span>
                <h3 style={{ marginBottom: 8, fontSize: '1.02rem' }}>{item.title}</h3>
                <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>{item.body}</p>
                {item.action && (
                  <Link style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--green)', fontWeight: 600, fontSize: '.88rem' }}
                    href={item.action.href}>
                    {item.action.label} <Icon name="arrow-right" size={14} />
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div className="note n-amber" style={{ marginTop: 32 }}>
            <span className="icbox icbox-a icbox-sm"><Icon name="info" size={16} /></span>
            <p>
              <strong>Nothing on Esoqo is paid online.</strong> The fee is always settled in person —
              with the agent at a station, or the courier on collection or delivery. Anyone asking
              you to pay online for a parcel is not acting for us.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
