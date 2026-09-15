import type { Metadata } from 'next';
import { Icon, type IconName } from '@esoqo/ui';
import { SectionNav } from '@/components/Chrome';
import { ScrollSpy } from '@/components/ScrollSpy';

export const metadata: Metadata = {
  title: 'Help',
  description: 'The complete USSD menu, SMS commands, and what to do if your phone is lost.',
};

const SECTIONS = [
  ['menu', 'USSD menu'], ['sms', 'SMS commands'], ['lost', 'Lost phone or PIN'],
  ['contact', 'Talk to a person'], ['print', 'Printable card'],
] as const;

const MENU: [string, IconName, string, string, string[]][] = [
  ['1', 'tag', 'Bei za leo', 'Prices', ['1 Chagua soko', '2 Bei zangu kwa SMS', '0 Rudi']],
  ['2', 'send', 'Tuma pesa', 'Send money', ['Weka namba', 'Weka kiasi', 'Thibitisha', '0 Rudi']],
  ['3', 'coins', 'Salio', 'Balance', ['Salio tayari', 'Escrow', 'Akiba ya kikundi']],
  ['4', 'users', 'Kikundi', 'Group', ['1 Salio la kikundi', '2 Lipa mchango', '3 Kura ya mkopo', '4 Nani hajalipa']],
  ['5', 'eye', 'Ruhusa', 'Who can see your data', ['1 Nani anaona', '2 Ondoa ruhusa', '0 Rudi']],
  ['6', 'certificate', 'Vyeti', 'Certificates', ['1 Vyeti vyangu', '2 Kuhuisha cheti', '3 Omba cheti kipya']],
  ['7', 'alert-circle', 'Ripoti', 'Report a problem', ['1 Bei si sahihi', '2 Malalamiko', '3 Ripoti udanganyifu']],
  ['8', 'message', 'Lugha', 'Language', ['1 Kiswahili', '2 English', '3 Ekitirikana', '4 Kalenjin']],
];

const SMS: [string, string][] = [
  ['BEI', "Today's prices for your markets"],
  ['BEI [soko]', 'Prices for one market, e.g. BEI GIKOMBA'],
  ['SALIO', 'Your balance'],
  ['KIKUNDI', "Your group's balance and your contribution status"],
  ['VYETI', 'Your certificates and when each expires'],
  ['RUHUSA', 'Who can currently see your record'],
  ['SIMAMA', 'Freeze your account immediately'],
  ['STOP', 'Stop all SMS from Esoqo'],
];

export default function HelpPage() {
  return (
    <>
      <SectionNav items={SECTIONS} />
      <ScrollSpy />

      <section className="phead">
        <div className="wrap">
          <p className="kicker">Help</p>
          <h1>Using Esoqo from any phone</h1>
          <p className="lead">
            The complete menu, the SMS commands, and what to do if your phone is lost. Print the
            card below and keep it where you trade.
          </p>
        </div>
      </section>

      <section className="sec" id="menu">
        <div className="wrap">
          <div className="shead">
            <span className="icbox icbox-g"><Icon name="keypad" size={21} /></span>
            <div>
              <h2>The whole menu, on one page</h2>
              <p className="lead">A 182-character screen cannot show you the tree. This can.</p>
            </div>
          </div>
          <p className="lead" style={{ marginBottom: 20 }}>
            Dial <strong style={{ color: 'var(--navy)' }}>*483*77#</strong>. Press <strong>0</strong>{' '}
            to go back and <strong>00</strong> to return to the start, from anywhere in the menu.
            A session closes after two minutes — if it closes while you are part-way through, dial
            again and Esoqo puts you back where you were.
          </p>

          <div className="tbl">
            {MENU.map(([key, icon, sw, en, next]) => (
              <div className="tr" key={key} style={{ gridTemplateColumns: '60px 1.1fr 1.2fr 1.6fr', alignItems: 'start' }}>
                <span className="mono" style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--navy)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600 }}>
                  {key}
                </span>
                <span className="ib"><span style={{ color: 'var(--blue)' }}><Icon name={icon} size={17} /></span>
                  <strong>{sw}</strong></span>
                <span className="sub">{en}</span>
                <span className="mono sub" style={{ fontSize: '.79rem' }}>
                  {next.map((n) => <span key={n} style={{ display: 'block', padding: '1px 0' }}>{n}</span>)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec sec-blue" id="sms">
        <div className="wrap">
          <div className="shead">
            <span className="icbox icbox-b"><Icon name="message" size={21} /></span>
            <div><h2>SMS commands</h2></div>
          </div>
          <p className="lead" style={{ marginBottom: 18 }}>
            Send any of these to <strong style={{ color: 'var(--navy)' }}>40277</strong>. Esoqo
            never sends you a link, and will never ask you to tap one.
          </p>
          <div className="tbl">
            <div className="th" style={{ gridTemplateColumns: '170px 1fr' }}>
              <span>Send</span><span>You get back</span>
            </div>
            {SMS.map(([cmd, desc]) => (
              <div className="tr" key={cmd} style={{ gridTemplateColumns: '170px 1fr' }}>
                <span className="mono ib" style={{ fontWeight: 600 }}>
                  <Icon name="send" size={14} />{cmd}
                </span>
                <span className="sub">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec" id="lost">
        <div className="wrap">
          <div className="shead">
            <span className="icbox icbox-r"><Icon name="key" size={21} /></span>
            <div><h2>If your phone or PIN is gone</h2></div>
          </div>
          <div className="grid g3">
            {([
              ['ban', 'r', '1 · Freeze it now', 'From any phone, send SIMAMA to 40277 with your registered number, or call 0709 000 000. Your balance is frozen straight away. Nobody can move money while it is frozen.'],
              ['phone', 'b', '2 · Replace the line', 'Get a replacement SIM with the same number from your operator. Your Esoqo record is tied to the number, not the handset.'],
              ['lock', 'g', '3 · Set a new PIN', 'Dial *483*77# and follow the prompts. Esoqo asks questions only you can answer. A field officer can help in person if that fails.'],
            ] as const).map(([icon, tone, title, body]) => (
              <div className="card" key={title} style={tone === 'r' ? { borderLeft: '4px solid var(--red)' } : undefined}>
                <span className={`icbox icbox-${tone}`} style={{ marginBottom: 12 }}>
                  <Icon name={icon} size={20} />
                </span>
                <h3 style={{ marginBottom: 8 }}>{title}</h3>
                <p className="sub" style={{ fontSize: '.92rem', margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>

          <div className="notice" style={{ marginTop: 20 }}>
            <span className="icbox icbox-r"><Icon name="alert-triangle" size={19} /></span>
            <div>
              <h2>Esoqo will never ask you for your PIN</h2>
              <p>
                Not by call, not by SMS, not by anyone claiming to be staff or a field officer. If
                someone asks, they are not from Esoqo. Hang up and call 0709 000 000.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec sec-tint" id="contact">
        <div className="wrap">
          <div className="shead">
            <span className="icbox icbox-g"><Icon name="phone-call" size={21} /></span>
            <div><h2>Talking to a person</h2></div>
          </div>
          <div className="tbl">
            {([
              ['phone-call', 'Call', '0709 000 000 · 8am to 6pm, Monday to Saturday'],
              ['alert-triangle', 'Report fraud', '0709 000 000 · any time'],
              ['scales', 'Complaints', 'malalamiko@esoqo.co.ke'],
              ['shield', 'Your data', 'dpo@esoqo.co.ke · reply within 14 days'],
            ] as const).map(([icon, label, value]) => (
              <div className="tr" key={label} style={{ gridTemplateColumns: '220px 1fr' }}>
                <strong className="ib"><Icon name={icon} size={17} />{label}</strong>
                <span className="mono">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sec" id="print">
        <div className="wrap">
          <div className="shead">
            <span className="icbox icbox-b"><Icon name="print" size={21} /></span>
            <div>
              <h2>Card to print and keep</h2>
              <p className="lead">
                Print it, fold it, and pin it where you trade. It works when the phone is dead.
              </p>
            </div>
          </div>
          <div className="card" style={{ border: '2px solid var(--navy)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, borderBottom: '2px solid var(--navy)', paddingBottom: 14, marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: '1.3rem' }}>ESOQO · *483*77#</h3>
                <p className="sub" style={{ margin: '2px 0 0', fontSize: '.87rem' }}>
                  Bei, pesa, kikundi na vyeti · simu yoyote
                </p>
              </div>
            </div>
            <div className="grid g2" style={{ gap: 26 }}>
              <div>
                <h4 className="mono" style={{ fontSize: '.68rem', letterSpacing: '.13em', color: 'var(--tx-3)', margin: '0 0 8px' }}>MENU</h4>
                <div className="mono" style={{ fontSize: '.88rem', lineHeight: 2 }}>
                  {MENU.map(([k, , sw, en]) => (
                    <div key={k}><strong>{k}</strong>&nbsp;&nbsp;{sw}&nbsp;&nbsp;
                      <span style={{ color: 'var(--tx-2)' }}>{en}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mono" style={{ fontSize: '.68rem', letterSpacing: '.13em', color: 'var(--tx-3)', margin: '0 0 8px' }}>SMS → 40277</h4>
                <div className="mono" style={{ fontSize: '.88rem', lineHeight: 2 }}>
                  {SMS.slice(0, 5).map(([c]) => <div key={c}><strong>{c}</strong></div>)}
                </div>
                <p style={{ fontSize: '.84rem', margin: '14px 0 0', paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <strong>0</strong> = rudi nyuma &nbsp;&nbsp; <strong>00</strong> = anza upya<br />
                  Msaada: <strong className="mono">0709 000 000</strong>
                </p>
              </div>
            </div>
            <p style={{ fontSize: '.83rem', margin: '16px 0 0', paddingTop: 12, borderTop: '1px solid var(--line)', color: 'var(--tx-2)' }}>
              <strong style={{ color: 'var(--red)' }}>Esoqo haitakuuliza PIN yako kamwe.</strong>{' '}
              Esoqo will never ask you for your PIN. Kujiunga ni bure · joining is free.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
