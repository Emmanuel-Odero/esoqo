import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { TicketBrowser } from './TicketBrowser';

const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

export const metadata: Metadata = {
  title: 'Events & transport',
  description: 'Events, tours and transport companies selling tickets on Esoko — browse and book directly.',
};
export const dynamic = 'force-dynamic';

interface GoListingSummary {
  ID: string;
  Slug: string;
  Title: string;
  Vertical: string;
  VenueOrRouteLabel?: string | null;
  FromPriceKES?: string | null;
  OrgName?: string | null;
  VenueCounty?: string | null;
  NextDepartAt?: string | null;
  ScheduleCount: number;
}

/**
 * The ticketing equivalent of /discover — a public directory, same job
 * for a fourth kind of Esoko business (event companies, tour operators,
 * transport companies) that /discover already does for shops. Unlike
 * /discover (which links out to apps/store for checkout), booking
 * itself also happens here — localhost:3000/tickets/[slug] — since
 * 3001 is reserved for signed-in dashboards, not public storefronts.
 * Directory reads come from core-go (GET /v1/listings).
 */
export default async function TicketsDirectory() {
  const listings: GoListingSummary[] = await fetch(`${CORE_GO_URL}/v1/listings?limit=100`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { listings: [] }))
    .then((j) => (j?.listings ?? []) as GoListingSummary[])
    .catch(() => []);

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Discover</p>
          <h1>Events &amp; transport on Esoko</h1>
          <p className="lead">
            Every listing here belongs to a real, registered Esoko business — an event company,
            tour operator, or transport company. Book directly, pay by M-Pesa, and get a QR ticket
            on your account.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          {listings.length === 0 ? (
            <div className="note n-blue">
              <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
              <p>
                No events or trips are published yet. Organisers open theirs from their Esoko
                account — once they do, it appears here automatically.
              </p>
            </div>
          ) : (
            <TicketBrowser
              listings={listings.map((l) => ({
                slug: l.Slug,
                title: l.Title,
                orgName: l.OrgName ?? '',
                vertical: l.Vertical as 'EVENTS' | 'TRANSPORT',
                where: l.VenueOrRouteLabel ?? null,
                county: l.VenueCounty ?? null,
                fromKes: l.FromPriceKES != null ? Number(l.FromPriceKES) : null,
                nextDepartAt: l.NextDepartAt ?? null,
                scheduleCount: l.ScheduleCount,
                detailUrl: `/tickets/${l.Slug}`,
              }))}
            />
          )}
        </div>
      </section>
    </>
  );
}
