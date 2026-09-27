import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';

export const metadata: Metadata = {
  title: 'Payment help — Esoqo',
  description: 'What to do when an Esoqo payment does not go through, a code will not scan, or you need a receipt again.',
  robots: { index: true, follow: true },
};

/**
 * /pay/help — the page a payment FAQ is supposed to be.
 *
 * Written for the four things that actually happen, in the order they
 * happen, and each one says what to do rather than only what went wrong.
 * Notably it does not promise a refund timescale, because a page that
 * invents one is worse than a page that admits it depends on the bank.
 */
const PROBLEMS = [
  {
    icon: 'clock' as const,
    tone: 'a',
    q: 'I approved the prompt but nothing happened',
    a: 'Check your M-Pesa statement before trying again — the money sometimes lands a minute after the prompt. If it is not there, wait five minutes and pay once more: a second payment is the one thing that can turn a delay into a double charge, so do not retry sooner than that.',
  },
  {
    icon: 'alert-circle' as const,
    tone: 'r',
    q: 'It said “payment failed”',
    a: 'Nothing has been taken, and you can safely try again. The usual causes are an insufficient M-Pesa balance, a PIN prompt that timed out, or Safaricom declining the push. If it fails twice, pay a smaller amount or use a different number.',
  },
  {
    icon: 'search' as const,
    tone: 'b',
    q: 'The code will not scan',
    a: 'You do not need a working camera. Every code on this site can be typed instead — a business ID, a car park code, or a parking ticket. They are printed under the QR for exactly this reason.',
  },
  {
    icon: 'document' as const,
    tone: 'g',
    q: 'I need the receipt again',
    a: 'Every completed payment sends a text receipt the moment it lands, so search your messages for “Esoqo”. If it did not arrive, the business can look it up from their Esoqo console using your number and the amount.',
  },
] as const;

export default function PayHelpPage() {
  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Help</p>
          <h1>When a payment does not go through</h1>
          <p className="lead">
            Almost every problem on this page is solved by one of the four things below. If yours is
            not, the business or group you were paying can see the payment on their side.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="grid g2">
            {PROBLEMS.map((p) => (
              <div className="card" key={p.q}>
                <span className={`icbox icbox-${p.tone}`} style={{ marginBottom: 12 }}>
                  <Icon name={p.icon} size={18} />
                </span>
                <h3 style={{ marginBottom: 8, fontSize: '1.02rem' }}>{p.q}</h3>
                <p className="sub" style={{ margin: 0, fontSize: '.92rem' }}>{p.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec sec-tint" style={{ paddingTop: 54 }}>
        <div className="wrap">
          <h2 style={{ marginBottom: 10 }}>What you can pay</h2>
          <p className="lead" style={{ marginBottom: 24 }}>
            Every one of these runs on the same M-Pesa prompt, and none of them needs an Esoqo account.
          </p>
          <div className="row">
            <Link href="/pay/business" className="btn btn-o">Pay a business</Link>
            <Link href="/pay/group" className="btn btn-o">Pay a group</Link>
            <Link href="/pay/transport" className="btn btn-o">Pay a transport company</Link>
            <Link href="/pay/parking" className="btn btn-o">Pay for parking</Link>
          </div>
        </div>
      </section>
    </>
  );
}
