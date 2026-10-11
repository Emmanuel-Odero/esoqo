import type { Metadata } from 'next';
import type { Route } from 'next';
import Link from 'next/link';
import { Icon, type IconName } from '@esoqo/ui';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Verify a certificate, find what your county requires, get help using *483*77#, and talk to a person.',
};

interface Card {
  href: Route;
  icon: IconName;
  tone: 'g' | 'b' | 'a' | 'r';
  title: string;
  body: string;
  cta: string;
}

/**
 * The support hub.
 *
 * Verify, counties, institutions, help and trust were five separate
 * header entries aimed at the same moment — a visitor who has a question
 * Esoqo's daily tools do not answer. Grouping them here keeps the
 * primary nav about doing things, while the paperwork-and-questions side
 * stays one tap away instead of crowding the top row.
 *
 * WCAG 2.2 · 3.2.6 Consistent Help is why the "talk to a person" entry
 * is on this page rather than buried: the same help route, in the same
 * place, whatever page you are on.
 */
const CARDS: Card[] = [
  {
    href: '/verify',
    icon: 'certificate',
    tone: 'b',
    title: 'Verify a receipt or certificate',
    body: 'Type the code from any Esoqo receipt or certificate and see who issued it, when, and whether it is still in force.',
    cta: 'Check a code',
  },
  {
    href: '/help',
    icon: 'keypad',
    tone: 'g',
    title: 'Help & using *483*77#',
    body: 'The whole dial menu, the SMS commands, and what to do if your phone or PIN is gone. Print the card and keep it where you trade.',
    cta: 'Open help',
  },
  {
    href: '/counties',
    icon: 'pin',
    tone: 'a',
    title: 'What your county requires',
    body: 'Permits, licences, fees and issuing offices for the counties where Esoqo field officers work today.',
    cta: 'See your county',
  },
  {
    href: '/institutions',
    icon: 'building',
    tone: 'b',
    title: 'Institutions',
    body: 'Lenders, insurers, buyers and government bodies that work with Esoqo records — and exactly what each one requires.',
    cta: 'Who is connected',
  },
  {
    href: '/trust',
    icon: 'shield-check',
    tone: 'g',
    title: 'Trust & your data',
    body: 'Who runs Esoqo, what we hold about you, who can see it, and how to report fraud or complain.',
    cta: 'Read more',
  },
  {
    href: '/help#contact',
    icon: 'phone-call',
    tone: 'r',
    title: 'Talk to a person',
    body: 'Call 0709 000 000, 8am to 6pm Monday to Saturday. Fraud can be reported at any time.',
    cta: 'Contact us',
  },
];

export default function SupportPage() {
  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Support</p>
          <h1>Questions, paperwork and problems</h1>
          <p className="lead">
            Everything Esoqo’s daily tools do not cover in one place — checking a code, your county’s
            requirements, who is connected, and how to reach a person when you need one.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="grid g2">
            {CARDS.map((c) => (
              <Link key={c.href} href={c.href} className="acard">
                <span className={`icbox icbox-${c.tone}`}>
                  <Icon name={c.icon} size={20} />
                </span>
                <h3>{c.title}</h3>
                <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>{c.body}</p>
                <span className="go">
                  {c.cta} <Icon name="arrow-right" size={15} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
