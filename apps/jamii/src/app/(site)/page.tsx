import Link from 'next/link';
import { listJamiiPages, getCampaignStats } from '@esoqo/db';
import { Icon } from '@esoqo/ui';
import { DiscoverFilters } from '@/components/DiscoverFilters';
import { isVerified, orgInitials } from '@/lib/data';
import { orgExternalUrl } from '@/lib/org-external-url';

export const dynamic = 'force-dynamic';

export default async function DiscoverPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; cause?: string }> }) {
  const sp = await searchParams;
  const pages = await listJamiiPages({ search: sp.q, cause: sp.cause });
  const raisedByCampaign = new Map(
    await Promise.all(
      pages
        .flatMap((p) => p.campaigns.slice(0, 1))
        .map(async (c) => [c.id, (await getCampaignStats(c.id)).raisedKes] as const),
    ),
  );

  return (
    <>
      <div className="hero">
        <div className="wrap">
          <p className="kick">CECF Community Pages</p>
          <h1>Find Kenya&rsquo;s community groups.<br /><em>Fund what they&rsquo;re doing.</em></h1>
          <p className="lead">
            Every table-banking group, youth collective and CBO gets a page: who they are, what
            they&rsquo;re raising for, and a receipt for every shilling given — sent straight to the
            donor&rsquo;s phone.
          </p>
          <div className="actions">
            <Link href="/start" className="btn btn-stamp">Start your organisation&rsquo;s page</Link>
            <a href="#orgs" className="btn btn-outline">Browse organisations</a>
          </div>
        </div>
      </div>

      <div className="statband">
        <div className="wrap">
          <div className="st"><b>{pages.length}</b><span>Organisations with a page</span></div>
          <div className="st"><b>47</b><span>Counties represented</span></div>
        </div>
      </div>

      <DiscoverFilters />

      <div className="wrap" id="orgs">
        {pages.length === 0 ? (
          <div className="emptystate">
            <p>No organisations match yet — be the first to publish a page.</p>
          </div>
        ) : (
          <div className="grid-orgs">
            {pages.map((page) => {
              const org = page.organisation;
              const campaign = page.campaigns[0];
              const externalUrl = orgExternalUrl(page);
              return (
                <article key={page.organisationId} className="card orgcard">
                  <div className="oc-top">
                    <div className="oc-avatar" aria-hidden="true">{orgInitials(org.officialName)}</div>
                    <div>
                      <div className="oc-name">
                        {org.officialName}
                        {isVerified(org) && (
                          <span className="stampmark"><Icon name="shield-check" size={12} />Verified</span>
                        )}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <span className="pill pill-county">{org.party.county}</span>
                        {externalUrl && (
                          <a
                            href={externalUrl.href}
                            target="_blank"
                            rel="noreferrer"
                            className="pill pill-link"
                          >
                            {externalUrl.label} ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  {page.tagline && <p className="oc-mission">{page.tagline}</p>}
                  {campaign && (() => {
                    const raised = raisedByCampaign.get(campaign.id) ?? 0;
                    const goal = Number(campaign.goalKes);
                    const pct = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;
                    return (
                      <div className="oc-campaign">
                        <div className="ocn">{campaign.title}</div>
                        <div className="ledgerbar"><div className="fill" style={{ width: `${pct}%` }} /></div>
                        <div className="meta">
                          <span>KES {raised.toLocaleString('en-KE')} of {goal.toLocaleString('en-KE')}</span>
                          <span>{pct}%</span>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="oc-foot">
                    {isVerified(org)
                      ? <span className="verified-inline"><Icon name="check" size={12} /> Verified</span>
                      : <span className="verified-inline" style={{ color: '#8a8368' }}>Unverified</span>}
                    <Link className="btn btn-outline btn-sm" href={`/o/${page.slug}`}>View page →</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
