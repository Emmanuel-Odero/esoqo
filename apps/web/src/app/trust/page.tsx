import type { Metadata } from 'next';
import { Icon } from '@esoqo/ui';
import { SectionNav } from '@/components/Chrome';
import { ScrollSpy } from '@/components/ScrollSpy';

export const metadata: Metadata = {
  title: 'Trust',
  description: 'Who runs Esoqo, your data rights, and how to complain.',
};

const SECTIONS = [
  ['who', 'Who runs Esoqo'], ['data', 'Your data'], ['sees', 'Who sees it'],
  ['fraud', 'Report fraud'], ['complaints', 'Complaints'],
] as const;

export default function TrustPage() {
  return (
    <>
      <SectionNav items={SECTIONS} />
      <ScrollSpy />

      <section className="phead">
        <div className="wrap">
          <p className="kicker">Trust</p>
          <h1>Who runs Esoqo, and how to hold us to it</h1>
          <p className="lead">
            Who we are, what we will never do, what we hold about you, and how to complain —
            including how to go over our heads.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="notice" id="fraud" style={{ marginBottom: 34 }}>
            <span className="icbox icbox-r"><Icon name="alert-triangle" size={19} /></span>
            <div>
              <h2>Esoqo will never ask you for your PIN</h2>
              <p>
                Not by call, not by SMS, not by anyone claiming to be staff or a field officer.
                Joining is free and stays free — nobody from Esoqo will ever ask you to pay to
                register. If someone does, it is not us. Call{' '}
                <strong className="mono">0709 000 000</strong>.
              </p>
            </div>
          </div>

          <div className="shead">
            <span className="icbox icbox-b"><Icon name="building" size={21} /></span>
            <div><h2 id="who">Who runs Esoqo</h2></div>
          </div>

          <div className="grid g2" style={{ marginBottom: 34 }}>
            <div className="card">
              <span className="icbox icbox-b" style={{ marginBottom: 13 }}><Icon name="gov" size={20} /></span>
              <h3 style={{ marginBottom: 12 }}>The company</h3>
              <div className="tbl" style={{ border: 0 }}>
                {([
                  ['Registered name', 'Esoqo Limited'],
                  ['Company number', '[to be added]'],
                  ['Data controller', 'ODPC/REG/[number]'],
                  ['Office', 'Nairobi, Kenya'],
                  ['Data Protection Officer', 'dpo@esoqo.co.ke'],
                ] as const).map(([k, v]) => (
                  <div className="tr" key={k} style={{ gridTemplateColumns: '160px 1fr', padding: '10px 0' }}>
                    <span className="sub">{k}</span><span className="mono">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <span className="icbox icbox-g" style={{ marginBottom: 13 }}><Icon name="handshake" size={20} /></span>
              <h3 style={{ marginBottom: 12 }}>Esoqo and CECF</h3>
              <p className="sub" style={{ fontSize: '.93rem' }}>
                Esoqo is a separate company that runs alongside the Child &amp; Elder Care
                Foundation and works under the relationships CECF holds with the Ministry of
                Labour, the Business Registration Service, the Kenya Revenue Authority and the
                Judiciary.
              </p>
              <p className="sub" style={{ fontSize: '.93rem', margin: 0 }}>
                <strong style={{ color: 'var(--tx)' }}>CECF registers and trains. Esoqo holds the
                record.</strong> If you are unsure which one you are dealing with, ask — and either
                can tell you.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec sec-green" id="data">
        <div className="wrap">
          <div className="shead">
            <span className="icbox icbox-g"><Icon name="shield" size={21} /></span>
            <div><h2>What Esoqo holds about you</h2></div>
          </div>
          <p className="lead" style={{ marginBottom: 20 }}>
            Your name and phone number, your county, what you do, the certificates you have added,
            and the record of what you trade and save through Esoqo. Nothing more.
          </p>
          <div className="grid g4" style={{ marginBottom: 16 }}>
            {([
              ['eye', 'See it', 'Ask for everything Esoqo holds about you. We reply within 14 days, free.'],
              ['refresh', 'Correct it', 'Anything wrong gets fixed. Certificates are corrected with the body that issued them.'],
              ['download', 'Take it', 'Get your record in a form you can give to someone else.'],
              ['ban', 'Delete it', 'Close your account and have your record removed, except where the law requires us to keep it.'],
            ] as const).map(([icon, title, body]) => (
              <div className="card" key={title}>
                <span className="icbox icbox-g icbox-sm" style={{ marginBottom: 11 }}>
                  <Icon name={icon} size={16} />
                </span>
                <h3 style={{ fontSize: '1rem', marginBottom: 7 }}>{title}</h3>
                <p className="sub" style={{ fontSize: '.9rem', margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>
          <p className="sub">
            Write to <strong style={{ color: 'var(--navy)' }}>dpo@esoqo.co.ke</strong> or dial
            *483*77# and choose 7. These are your rights under the Data Protection Act, 2019, and
            exercising them costs nothing.
          </p>
        </div>
      </section>

      <section className="sec" id="sees">
        <div className="wrap">
          <div className="shead">
            <span className="icbox icbox-b"><Icon name="eye" size={21} /></span>
            <div><h2>Who sees your record</h2></div>
          </div>
          <div className="tbl" style={{ marginBottom: 34 }}>
            {([
              ['Nobody, unless you grant it.', 'Not a bank, not a buyer, not a county, not CECF.'],
              ['Each grant names one institution and one reason.', 'It runs for a period you set, and it does not pass to anyone else.'],
              ['You can end a grant at any time.', 'Dial *483*77# and choose 5. The institution is told; nothing else you hold changes.'],
              ['Every grant and every look is logged.', 'You can ask to see that log, and so can the Office of the Data Protection Commissioner.'],
            ] as const).map(([head, body]) => (
              <div className="tr" key={head} style={{ gridTemplateColumns: '1fr' }}>
                <strong>{head}</strong><span className="sub">{body}</span>
              </div>
            ))}
          </div>

          <div className="shead">
            <span className="icbox icbox-r"><Icon name="scales" size={21} /></span>
            <div><h2 id="complaints">Complaining</h2></div>
          </div>
          <div className="grid g3">
            {([
              ['message', 'b', '1 · Tell us', 'Call 0709 000 000, write to malalamiko@esoqo.co.ke, or dial *483*77# and choose 7. We acknowledge within 2 working days and answer within 14.'],
              ['refresh', 'a', '2 · Ask for a review', 'If the answer does not satisfy you, ask for it to be reviewed by someone who was not involved. Say so in writing and we will name that person.'],
              ['scales', 'r', '3 · Go over our heads', 'You do not need our permission. Data complaints go to the Office of the Data Protection Commissioner. Money complaints go to your provider and the Central Bank of Kenya. We will give you the contacts if you ask.'],
            ] as const).map(([icon, tone, title, body]) => (
              <div className="card" key={title} style={tone === 'r' ? { borderLeft: '4px solid var(--blue)' } : undefined}>
                <span className={`icbox icbox-${tone}`} style={{ marginBottom: 12 }}>
                  <Icon name={icon} size={20} />
                </span>
                <h3 style={{ marginBottom: 8 }}>{title}</h3>
                <p className="sub" style={{ fontSize: '.92rem', margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
