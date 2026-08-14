import Link from 'next/link';
import type { getJamiiPageBySlug } from '@esoko/db';

type OrgPage = NonNullable<Awaited<ReturnType<typeof getJamiiPageBySlug>>>;

export function OrgSidebar({ page }: { page: OrgPage }) {
  const activeCampaign = page.campaigns.find((c) => c.status === 'ACTIVE');
  const org = page.organisation;

  return (
    <aside className="sidebar">
      <div className="card">
        <h3>Support {org.officialName}</h3>
        <div className="statrow"><span>Campaigns run</span><b>{page.campaigns.length}</b></div>
        <div className="statrow"><span>County</span><b>{org.party.county}</b></div>
        {activeCampaign ? (
          <Link href={`/o/${page.slug}/c/${activeCampaign.slug}`} className="btn btn-stamp btn-block" style={{ marginTop: 14 }}>
            Support with M-Pesa
          </Link>
        ) : (
          <p style={{ fontSize: '.82rem', color: '#6b6552', marginTop: 14 }}>No active campaign right now.</p>
        )}
        <Link href="/dashboard" style={{ display: 'block', textAlign: 'center', marginTop: 10, fontSize: '.78rem', color: '#8a8368', textDecoration: 'underline' }}>
          Represent this organisation? Manage this page →
        </Link>
      </div>
    </aside>
  );
}
