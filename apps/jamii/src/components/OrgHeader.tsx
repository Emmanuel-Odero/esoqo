import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { isVerified, orgInitials } from '@/lib/data';
import { orgHref, type OrgLinkMode } from '@/lib/org-links';
import { orgExternalUrl } from '@/lib/org-external-url';
import type { getJamiiPageBySlug } from '@esoqo/db';

type OrgPage = NonNullable<Awaited<ReturnType<typeof getJamiiPageBySlug>>>;

export function OrgHeader({ page, mode }: { page: OrgPage; mode: OrgLinkMode }) {
  const org = page.organisation;
  const activeCampaign = page.campaigns.find((c) => c.status === 'ACTIVE');
  const externalUrl = orgExternalUrl(page);

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
              {externalUrl && (
                <a href={externalUrl.href} target="_blank" rel="noreferrer" className="pill pill-link">
                  {externalUrl.label} ↗
                </a>
              )}
            </div>
          </div>
          {activeCampaign && (
            <div className="oh-actions">
              <Link href={orgHref(mode, `c/${activeCampaign.slug}`)} className="btn btn-stamp">
                View active campaign
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
