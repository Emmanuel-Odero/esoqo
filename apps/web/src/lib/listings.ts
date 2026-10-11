const CORE_GO_URL = process.env.CORE_GO_API_URL ?? 'http://localhost:4100';

/**
 * Public ticketing listings, read from core-go (GET /v1/listings).
 *
 * One reader for three pages: the combined /tickets directory, the
 * /events hub and the /transport hub. They differ only in the vertical
 * they keep, so the fetch and the field-mapping live here once rather
 * than being copied into each page and drifting.
 */

export type Vertical = 'EVENTS' | 'TRANSPORT';

export interface ListingRow {
  slug: string;
  title: string;
  orgName: string;
  vertical: Vertical;
  where: string | null;
  county: string | null;
  fromKes: number | null;
  nextDepartAt: string | null;
  scheduleCount: number;
  detailUrl: string;
}

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
 * Publish nothing rather than blow up the page: an unreachable listings
 * service means an empty directory and a friendly note, not a 500. Same
 * contract the old inline fetch on /tickets already followed.
 */
export async function fetchListings(vertical?: Vertical): Promise<ListingRow[]> {
  const all = await fetch(`${CORE_GO_URL}/v1/listings?limit=100`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { listings: [] }))
    .then((j) => (j?.listings ?? []) as GoListingSummary[])
    .catch(() => []);

  return all
    .filter((l) => !vertical || l.Vertical === vertical)
    .map((l) => ({
      slug: l.Slug,
      title: l.Title,
      orgName: l.OrgName ?? '',
      vertical: l.Vertical as Vertical,
      where: l.VenueOrRouteLabel ?? null,
      county: l.VenueCounty ?? null,
      fromKes: l.FromPriceKES != null ? Number(l.FromPriceKES) : null,
      nextDepartAt: l.NextDepartAt ?? null,
      scheduleCount: l.ScheduleCount,
      detailUrl: `/tickets/${l.Slug}`,
    }));
}
