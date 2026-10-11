import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon, type IconName } from '@esoqo/ui';
import { PayClient } from './PayClient';
import { actionLookupBusiness, type BusinessLookup } from './actions';

/**
 * The payments hub.
 *
 * Two different pages share this route, which is the one compromise
 * worth explaining. With ?to=<ID> — a printed QR, a texted link — the
 * customer is on their way to paying one specific business and must see
 * the pay screen immediately; a menu of five options in the way would be
 * a wrong turn on a bad connection. Without it, there is no destination
 * yet, so the useful thing is to say what can be paid and let them
 * choose. Both are handled here rather than in a redirect, because a
 * redirect would cost a round trip on the phone camera path that most
 * customers arrive by.
 */

export const metadata: Metadata = {
  title: 'Pay on Esoqo',
  description: 'Pay a business or a savings group with M-Pesa, no account needed.',
  robots: { index: true, follow: true },
};

type Card = { href: `/${string}`; icon: IconName; tone: string; title: string; body: string; cta: string };

/**
 * Transport and parking are no longer listed here. They are transport
 * jobs to the person doing them, so they live on the /transport hub;
 * leaving them here too was the duplication this reorganisation set out
 * to remove. The routes still exist and still work — a plate scan or a
 * car park QR lands on them directly — they are just not advertised as
 * part of the payments menu any more.
 */
const WAYS = [
  {
    href: '/pay/business', icon: 'shop', tone: 'g', title: 'Pay a business',
    body: 'Scan the stand at the counter, or type an Esoqo ID. Choose the amount and authorise on your phone.',
    cta: 'Pay a business',
  },
  {
    href: '/pay/group', icon: 'users', tone: 'b', title: 'Pay into a group',
    body: 'Chamas, table-banking groups, SACCOs and co-operatives. Pay by group name or by their Esoqo ID.',
    cta: 'Pay a group',
  },
] as const satisfies readonly Card[];

const STEPS: readonly [IconName, string, string, string][] = [
  ['search', 'g', 'Find who you are paying', 'Scan the code, or search by name, plate, phone number or Esoqo ID.'],
  ['keypad', 'b', 'Enter the amount', 'Type the amount and the M-Pesa number the money should come from.'],
  ['phone', 'r', 'Authorise on your phone', 'Approve the M-Pesa prompt. You get a text receipt the moment it lands.'],
];

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string | string[]; amount?: string | string[] }>;
}) {
  const params = await searchParams;
  const to = first(params.to);
  const amount = first(params.amount);

  // A scanned or texted link wins outright: the customer already knows
  // who they are paying, and anything between them and the amount screen
  // is a page they did not ask for.
  if (to && to.trim()) {
    let initialLookup: BusinessLookup | null = null;
    try {
      initialLookup = await actionLookupBusiness(to);
    } catch {
      // A lookup that throws is a lookup that found nothing, as far as
      // the payer is concerned; the page falls back to the lookup step
      // with the code still in hand.
      initialLookup = { status: 'NOT_FOUND' };
    }
    return (
      <PayClient
        initialLookup={initialLookup}
        prefillAmount={amount && /^\d+(\.\d{1,2})?$/.test(amount) ? amount : null}
      />
    );
  }

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Payments</p>
          <h1>Pay anyone on Esoqo</h1>
          <p className="lead">
            Shops and savings groups — all settled by M-Pesa from your phone. No account, no app,
            and a text receipt the moment the money lands. Looking to pay a transport company or a
            car park? That is on <Link href="/transport" style={{ color: 'var(--green)', fontWeight: 600 }}>Transport</Link>.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="grid g2">
            {WAYS.map((w) => (
              <Link key={w.href} href={w.href} className="acard">
                <span className={`icbox icbox-${w.tone}`}>
                  <Icon name={w.icon} size={20} />
                </span>
                <h3>{w.title}</h3>
                <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>{w.body}</p>
                <span className="go">
                  {w.cta} <Icon name="arrow-right" size={15} />
                </span>
              </Link>
            ))}

            <Link href="/pay/help" className="acard">
              <span className="icbox icbox-a">
                <Icon name="info" size={20} />
              </span>
              <h3>Something went wrong</h3>
              <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>
                A payment that did not go through, a code that does not scan, or a receipt you need
                again. Start here.
              </p>
              <span className="go">
                Get help <Icon name="arrow-right" size={15} />
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="sec sec-tint" style={{ paddingTop: 54 }}>
        <div className="wrap">
          <div className="grid g3">
            {STEPS.map(([icon, tone, title, body]) => (
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

      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="wrap" style={{ maxWidth: 640 }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <h3 style={{ marginBottom: 8 }}>Know exactly who you are paying?</h3>
            <p className="sub" style={{ margin: '0 auto 20px', maxWidth: 420 }}>
              If you have an Esoqo ID, skip the search and go straight to the amount screen.
            </p>
            <Link href="/pay/business" className="btn btn-p">
              <Icon name="qr" size={16} /> Scan or enter an ID
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function first(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
