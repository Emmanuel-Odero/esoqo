import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { SectionNav } from '@/components/Chrome';
import { ScrollSpy } from '@/components/ScrollSpy';
import { listTransportCompanies, type TransportCompany } from '@/app/buses/actions';

export const metadata: Metadata = {
  title: 'Transport',
  description: 'Bus seats, transport and tour tickets, and parking on Esoqo — book and pay by M-Pesa, no touts.',
};
export const dynamic = 'force-dynamic';

/**
 * The transport hub.
 *
 * Bus tickets, the transport companies behind them, parking and paying
 * a company were separate doors in the header; they now sit on one page,
 * because to a traveller they are the same question: how do I get there
 * and where do I leave the car. The company grid is the same onboarded
 * operators the /buses directory lists, so picking one here lands on its
 * routes and booking flow exactly as it does there — and paying a fare
 * to the company sits beside booking, as one "riding with them" job.
 */
const SECTIONS = [
  ['companies', 'Companies & tours'],
  ['parking', 'Parking'],
] as const;

/** One card per onboarded company: its logo if it has one, its name if
 *  not. Reused by both the bus-ticket and companies-and-tours sections
 *  so the two can never drift apart. */
function CompanyGrid({ companies }: { companies: TransportCompany[] }) {
  if (companies.length === 0) {
    return (
      <div className="note n-blue">
        <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
        <p>
          No companies are running transport yet. Operators open their routes from their Esoqo
          account — once they do, they appear here and in the bus directory.
        </p>
      </div>
    );
  }

  return (
    <div className="grid g3">
      {companies.map((c) => (
        <Link key={c.id} className="card" href={`/buses/${c.id}`} style={{ display: 'block' }}>
          {c.logoUrl ? (
            <img
              src={c.logoUrl}
              alt={c.name}
              style={{ height: 40, maxWidth: 140, objectFit: 'contain', marginBottom: 13 }}
            />
          ) : (
            <span className="icbox icbox-g" style={{ marginBottom: 13 }}>
              <Icon name="truck" size={20} />
            </span>
          )}
          <h3 style={{ marginBottom: 4 }}>{c.name}</h3>
          <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>View routes &amp; book</p>
        </Link>
      ))}
    </div>
  );
}

export default async function TransportHub() {
  const companies = await listTransportCompanies();

  return (
    <>
      <SectionNav items={SECTIONS} />
      <ScrollSpy />

      <section className="phead">
        <div className="wrap">
          <p className="kicker">Transport</p>
          <h1>Get where you’re going</h1>
          <p className="lead">
            Bus seats, transport and tour tickets, and parking — booked and paid by M-Pesa, with no
            tout at the stage and no haggling at the gate.
          </p>
        </div>
      </section>

      <section className="sec sec-tint" id="companies">
        <div className="wrap">
          <div className="shead" style={{ marginBottom: 18 }}>
            <span className="icbox icbox-b"><Icon name="users" size={20} /></span>
            <div>
              <h2 style={{ marginBottom: 2 }}>Transport companies &amp; tours</h2>
              <p className="sub" style={{ margin: 0 }}>
                Book a bus seat, pay a transport fare, or find a tour company selling trips direct.
              </p>
            </div>
          </div>

          <div className="grid g3">
            <Link href="/buses" className="acard">
              <span className="icbox icbox-g"><Icon name="truck" size={20} /></span>
              <h3>Get a bus ticket</h3>
              <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>
                Pick a company, choose your route, and reserve a seat by M-Pesa.
              </p>
              <span className="go">Get a bus ticket <Icon name="arrow-right" size={15} /></span>
            </Link>
            <Link href="/pay/transport" className="acard">
              <span className="icbox icbox-r"><Icon name="send" size={20} /></span>
              <h3>Pay a transport fare</h3>
              <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>
                Find the company by name or number plate and pay your fare.
              </p>
              <span className="go">Pay a fare <Icon name="arrow-right" size={15} /></span>
            </Link>
            <Link href="/tickets" className="acard">
              <span className="icbox icbox-b"><Icon name="map" size={20} /></span>
              <h3>Find a tour company</h3>
              <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>
                Transport and tour operators selling seats and trips direct.
              </p>
              <span className="go">Find a tour <Icon name="arrow-right" size={15} /></span>
            </Link>
          </div>

          <div style={{ marginTop: 30 }}>
            <h3 style={{ marginBottom: 12 }}>The operators behind the trips</h3>
            <CompanyGrid companies={companies} />
          </div>
        </div>
      </section>

      <section className="sec" id="parking">
        <div className="wrap">
          <div className="shead" style={{ marginBottom: 18 }}>
            <span className="icbox icbox-a"><Icon name="key" size={20} /></span>
            <div>
              <h2 style={{ marginBottom: 2 }}>Parking</h2>
              <p className="sub" style={{ margin: 0 }}>
                Find a car park before you set off, or settle the stay when you collect your car.
              </p>
            </div>
          </div>
          <div className="grid g2">
            <Link href="/parking" className="acard">
              <span className="icbox icbox-a"><Icon name="pin" size={20} /></span>
              <h3>Find parking</h3>
              <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>
                Search by area, or let us find the car parks near you — with each one’s rate
                before you choose.
              </p>
              <span className="go">Find parking <Icon name="arrow-right" size={15} /></span>
            </Link>
            <Link href="/pay/parking" className="acard">
              <span className="icbox icbox-a"><Icon name="key" size={20} /></span>
              <h3>Pay for parking</h3>
              <p className="sub" style={{ margin: 0, fontSize: '.93rem' }}>
                Scan the car park’s code or type your ticket to settle the stay by M-Pesa.
              </p>
              <span className="go">Pay for parking <Icon name="arrow-right" size={15} /></span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
