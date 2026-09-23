import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { actionGetCounterTicket } from '../../counter-ticket-actions';
import { CounterTicketStatus } from './CounterTicketStatus';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Your ticket — Esoqo',
    // Same reasoning /t and /p follow: a code (here, an id) that acts
    // as a bearer credential must never end up in a search index.
    robots: { index: false, follow: false },
  };
}

export default async function CounterTicketStatusPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await actionGetCounterTicket(id);

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Parcels</p>
          <h1>Your ticket</h1>
        </div>
      </section>
      <section className="sec">
        <div className="wrap" style={{ maxWidth: 480 }}>
          {ticket ? (
            <CounterTicketStatus initial={ticket} />
          ) : (
            <div className="card" style={{ padding: 20, textAlign: 'center' }}>
              <Icon name="alert-circle" size={28} />
              <p style={{ margin: '10px 0 2px', fontWeight: 700 }}>No ticket found</p>
              <p className="sub" style={{ margin: 0 }}>It may have already been served, or the link is wrong.</p>
              <p style={{ marginTop: 14 }}>
                <Link className="btn btn-o btn-sm" href="/parcels">Back to Parcels</Link>
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
