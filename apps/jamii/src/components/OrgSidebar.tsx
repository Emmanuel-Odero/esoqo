import Link from 'next/link';
import { orgHref, crossToPrimaryHref, type OrgLinkMode } from '@/lib/org-links';
import type { getJamiiPageBySlug } from '@esoqo/db';

type OrgPage = NonNullable<Awaited<ReturnType<typeof getJamiiPageBySlug>>>;

export function OrgSidebar({ page, mode }: { page: OrgPage; mode: OrgLinkMode }) {
  const activeCampaign = page.campaigns.find((c) => c.status === 'ACTIVE');
  const org = page.organisation;

  return (
    <aside className="sidebar">
      <div className="card">
        <h3>Support {org.officialName}</h3>
        <div className="statrow"><span>Campaigns run</span><b>{page.campaigns.length}</b></div>
        <div className="statrow"><span>County</span><b>{org.party.county}</b></div>
        {activeCampaign ? (
          <Link href={orgHref(mode, `c/${activeCampaign.slug}`)} className="btn btn-stamp btn-block" style={{ marginTop: 14 }}>
            Support with M-Pesa
          </Link>
        ) : (
          <p style={{ fontSize: '.82rem', color: '#6b6552', marginTop: 14 }}>No active campaign right now.</p>
        )}
        <a href={crossToPrimaryHref(mode, 'dashboard')} style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: '.78rem', color: '#8a8368', textDecoration: 'underline' }}>
          Represent this organisation? Manage this page →
        </a>
      </div>
    </aside>
  );
}
