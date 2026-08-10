import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { anonCtx, listPricesForDate, listCounties } from '@esoko/db';
import { Finder } from '@/components/Finder';
import { Board, type Quote } from '@/components/Board';
import { SectionNav } from '@/components/Chrome';
import { ScrollSpy } from '@/components/ScrollSpy';
import { RotatingWord } from '@/components/RotatingWord';

/** Who this line speaks to, in rotation — a chama or sacco running
 *  group money, a duka or biashara running trade. Kept to words already
 *  used elsewhere in this copy (see MoreAboutYou's group question and
 *  the "Getting paid"/"Group money" cards below) rather than inventing
 *  new vocabulary just for the headline. */
const HERO_WORDS = ['chama', 'sacco', 'duka', 'biashara'] as const;

export const dynamic = 'force-dynamic'; // the board moves once a morning

const SECTIONS = [
  ['for-me', 'Is Esoko for me?'], ['does', 'What Esoko does'], ['daily', 'Every day'],
  ['papers', 'Papers & certificates'], ['institutions', 'Who is connected'],
  ['counties', 'Where we work'], ['join', 'How to join'],
] as const;

const DOES = [
  ['tag', 'g', 'Today’s prices', 'What your goods are selling for at markets near you, checked before you buy or sell. Ask by dialling any time, or switch on a morning SMS if you want one.'],
  ['send', 'g', 'Getting paid', 'Take payment where you trade, send money to a supplier, and have a buyer’s money held until you deliver. Every fee is shown before you confirm.'],
  ['users', 'g', 'Group money', 'Weekly contributions, merry-go-round turns, who has paid and who has not, loan votes, and a register your treasurer can print for the meeting.'],
  ['chart', 'b', 'Your trading record', 'Every sale, contribution and repayment builds a record of what you actually earn. It belongs to you and nobody else sees it unless you say so.'],
  ['certificate', 'b', 'Papers and certificates', 'Registrations, permits and licences from the bodies that issue them — kept together, checked for expiry, printable and verifiable.'],
  ['key', 'r', 'What it opens', 'Credit, insurance and buyers who will contract you. Offered when your record qualifies, never before, and only if you agree to share it.'],
] as const;

const PAPERS = [
  ['Group registration', 'Ministry of Labour & Social Protection', 'KES 1,000'],
  ['Business registration', 'Business Registration Service', 'KES 1,050'],
  ['KRA PIN', 'Kenya Revenue Authority', 'Free'],
  ['eTIMS registration', 'Kenya Revenue Authority', 'Free'],
  ['Mediation certificate', 'Judiciary Mediation Directorate', 'Free'],
  ['Single business permit', 'County governments', 'By county'],
  ["Food handler's certificate", 'County governments', 'KES 500'],
  ['Trading record', 'Esoko', 'Free'],
] as const;

export default async function Home() {
  const ctx = anonCtx();
  const [quotes, counties] = await Promise.all([
    listPricesForDate(ctx, new Date()),
    listCounties(ctx),
  ]);

  const board: Quote[] = quotes.slice(0, 5).map((q) => ({
    commodity: q.commodity.name, unit: q.commodity.unit,
    market: q.market.name, county: q.market.county.name,
    price: Number(q.priceKes), change: null,
  }));

  const live = counties.filter((c) => c.hasFieldOfficer);
  const soon = counties.filter((c) => !c.hasFieldOfficer);

  return (
    <>
      <SectionNav items={SECTIONS} />
      <ScrollSpy />

      <section className="hero">
        <div className="wrap">
          <div className="hero-g">
            <div>
              <h1>Everything your <RotatingWord words={HERO_WORDS} /> runs on.</h1>
              <p className="hsub">One number. Any phone. Free to start.</p>
              <p className="fact">
                Prices, money, savings, records and papers, kept in one place and reached by
                dialling. Works on every handset sold in Kenya. Start this morning, registered or not.
              </p>
              <div className="row">
                <span className="dial"><Icon name="keypad" size={18} />Dial <b>*483*77#</b></span>
                <a className="btn btn-p" href={`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'}/join`}>
                  <Icon name="arrow-right" size={16} />Join free
                </a>
                <a className="btn btn-w" href="#for-me">Is it for my work?</a>
              </div>
            </div>
            {board.length > 0
              ? <Board rows={board} />
              : <div className="board"><div className="bh"><span className="dot" /><span>Market prices</span></div>
                  <div className="br"><span style={{ color: '#9FC0D6' }}>
                    No prices collected yet today. They arrive by 5am on trading days.
                  </span></div></div>}
          </div>
        </div>
      </section>

      <div className="wrap"><Finder /></div>

      <section className="sec" id="does">
        <div className="wrap">
          <p className="kicker">What Esoko does</p>
          <h2 style={{ marginBottom: 12 }}>You choose what you use it for.</h2>
          <p className="lead" style={{ marginBottom: 30 }}>
            Each one works on its own and none of them requires another. Open what you need,
            leave the rest closed, and add to it whenever you want.
          </p>
          <div className="grid g3">
            {DOES.map(([icon, tone, title, body]) => (
              <div className="card" key={title}>
                <span className={`icbox icbox-${tone}`} style={{ marginBottom: 14 }}>
                  <Icon name={icon} size={19} />
                </span>
                <h3 style={{ marginBottom: 9 }}>{title}</h3>
                <p style={{ color: 'var(--tx-2)', fontSize: '.94rem', margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec sec-tint" id="daily">
        <div className="wrap">
          <p className="kicker">Every day</p>
          <h2 style={{ marginBottom: 12 }}>What works from the first day</h2>
          <p className="lead" style={{ marginBottom: 30 }}>
            Prices, payments and your group’s money are available as soon as you join, at no
            charge, with nothing to fill in and nothing to bring.
          </p>
          <div className="grid g2">
            <div className="card">
              <h3 style={{ marginBottom: 10 }}>Payments in, payments out, and money held until delivery</h3>
              <p style={{ color: 'var(--tx-2)', fontSize: '.94rem' }}>
                Take payment where you trade. Send money to a supplier. When a buyer orders from
                you, their money sits in escrow where you can see it, and moves to you the day you
                deliver.
              </p>
              <p style={{ color: 'var(--tx-2)', fontSize: '.94rem', margin: 0 }}>
                <strong style={{ color: 'var(--tx)' }}>
                  If a payment does not confirm, Esoko says so plainly and tells you not to send it
                  twice.
                </strong>{' '}
                Somebody works on it and you get an SMS.
              </p>
            </div>
            <div className="card">
              <h3 style={{ marginBottom: 10 }}>Your group’s money, visible to the group</h3>
              <p style={{ color: 'var(--tx-2)', fontSize: '.94rem' }}>
                The treasurer posts contributions once; every member gets a receipt by SMS and can
                check the balance without asking anyone.
              </p>
              <p style={{ color: 'var(--tx-2)', fontSize: '.94rem', margin: 0 }}>
                Loan decisions go to a vote members can cast by dialling, so the ones without
                smartphones are not left out. Arrears are shown to the office-bearers only.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="papers">
        <div className="wrap">
          <p className="kicker">Papers &amp; certificates</p>
          <h2 style={{ marginBottom: 12 }}>When you are ready for paperwork — and not before</h2>
          <p className="lead" style={{ marginBottom: 28 }}>
            You can use everything above without registering anything. Esoko issues none of these:
            each comes from the body with the authority to issue it.
          </p>
          <div className="tbl">
            <div className="th" style={{ gridTemplateColumns: '1.35fr 1.75fr 105px' }}>
              <span>Record</span><span>Issued by</span><span>Government fee</span>
            </div>
            {PAPERS.map(([name, issuer, fee]) => (
              <div className="tr" key={name} style={{ gridTemplateColumns: '1.35fr 1.75fr 105px' }}>
                <strong>{name}</strong>
                <span style={{ color: 'var(--tx-2)' }}>{issuer}</span>
                <span className="mono">{fee}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '.89rem', color: 'var(--tx-2)', marginTop: 16 }}>
            These are the ones most people need.{' '}
            <strong style={{ color: 'var(--tx)' }}>Esoko will hold any certificate you have</strong>{' '}
            — NEMA, KEBS, PSV, liquor, health, export, professional body, whatever your work
            requires. Government fees go to the issuing body at its published rate.
          </p>
        </div>
      </section>

      <section className="sec sec-navy" id="institutions">
        <div className="wrap">
          <p className="kicker">Institutions</p>
          <h2 style={{ marginBottom: 10 }}>Bodies and institutions connected to Esoko</h2>
          <p style={{ marginBottom: 24 }}>
            <Link href="/institutions" style={{ color: '#7FD3A8', fontWeight: 600, borderBottom: '1px solid rgba(127,211,168,.4)' }}>
              See what each one requires →
            </Link>
          </p>
          <p className="lead" style={{ maxWidth: 'none' }}>
            These bodies issue; Esoko holds and proves. Nothing on a certificate is Esoko’s word —
            it is the issuer’s, recorded with the date it was given and the date it runs out. A
            verifier checks the code and sees the issuer’s name, not ours.
          </p>
        </div>
      </section>

      <section className="sec" id="counties">
        <div className="wrap">
          <p className="kicker">Counties</p>
          <h2 style={{ marginBottom: 14 }}>Anywhere in Kenya, from any phone</h2>
          <p className="lead" style={{ marginBottom: 14 }}>
            <strong style={{ color: 'var(--tx)' }}>Esoko works in all 47 counties.</strong> Wherever
            you are, you can join, hold your record, keep your papers and use your group’s money by
            dialling.
          </p>
          <p className="lead" style={{ marginBottom: 20 }}>
            The counties below are where field officers sit with people in person and where daily
            market prices are collected so far. Everything else does not depend on the list.
          </p>
          <div className="chips">
            {live.map((c) => (
              <span className="chip on" key={c.code}>{c.name}</span>
            ))}
            {soon.map((c) => <span className="chip" key={c.code}>{c.name}</span>)}
            <span className="chip">+ {47 - counties.length} more counties</span>
          </div>
          <p style={{ marginTop: 16 }}>
            <Link href="/counties" style={{ color: 'var(--green)', fontWeight: 600 }}>
              See what your county requires →
            </Link>
          </p>
        </div>
      </section>

      <section className="sec sec-tint" id="join">
        <div className="wrap">
          <p className="kicker">How to join</p>
          <h2 style={{ marginBottom: 16 }}>A few minutes, five questions, no documents.</h2>
          <div className="grid g3">
            {([
              ['keypad', 'Dial *483*77#', 'Or open esoko.co.ke. Pick English or Kiswahili first; everything after follows your choice.', 'var(--green)'],
              ['user', 'Name, number, county, what you do', 'Plus where you stand today — registered or not, in a group or not. Your identity card and any papers come later.', 'var(--blue)'],
              ['message', 'Choose what you want sent', 'Prices, receipts, expiry warnings — pick which of these you want, and nothing else arrives.', 'var(--red)'],
            ] as const).map(([icon, title, body, colour], i) => (
              <div key={title} style={{ borderTop: `3px solid ${colour}`, paddingTop: 18 }}>
                <div className="ib mono" style={{ fontSize: '.7rem', letterSpacing: '.15em', color: 'var(--tx-2)', marginBottom: 8 }}>
                  <Icon name={icon} size={14} />STEP {i + 1}
                </div>
                <h3>{title}</h3>
                <p style={{ color: 'var(--tx-2)', fontSize: '.94rem', margin: '7px 0 0' }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="notice">
            <span className="icbox icbox-r"><Icon name="alert-triangle" size={19} /></span>
            <div>
              <h2>Esoko will never ask you for your PIN</h2>
              <p>
                Joining is free and stays free. Nobody from Esoko will call or text you asking for
                your PIN, or ask you to pay anything to register. If someone does, it is not us —
                call 0709 000 000 and tell us.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
