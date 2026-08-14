import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { isVerified, orgInitials } from '@/lib/data';
import type { getJamiiPageBySlug } from '@esoko/db';

type OrgPage = NonNullable<Awaited<ReturnType<typeof getJamiiPageBySlug>>>;

export function OrgHeader({ page }: { page: OrgPage }) {
  const org = page.organisation;
  const activeCampaign = page.campaigns.find((c) => c.status === 'ACTIVE');

  return (
    <>
      <div className="orgcover">
        {page.coverUrl && <img src={page.coverUrl} alt="" />}
      </div>
      <div className="orghead-wrap">
        <div className="orghead">
          <div className="org-avatar-lg" aria-label={`${org.officialName} logo`}>
            {page.logoUrl ? <img src={page.logoUrl} alt="" /> : orgInitials(org.officialName)}
          </div>
          <div className="oh-info">
            <h1>
              {org.officialName}
              {isVerified(org) && (
                <span className="stampmark"><Icon name="shield-check" size={13} />Verified</span>
              )}
            </h1>
            <div className="oh-meta">
              <span className="pill pill-county">{org.party.county}</span>
              {org.tags.map((tag) => <span key={tag} className="pill pill-cause">{tag}</span>)}
            </div>
          </div>
          {activeCampaign && (
            <div className="oh-actions">
              <Link href={`/o/${page.slug}/c/${activeCampaign.slug}`} className="btn btn-stamp">
                View active campaign
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
