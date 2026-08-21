import Link from 'next/link';
import '@esoko/ui/tokens.css';
import '../jamii.css';
import { countNewJamiiContactMessages, listJamiiSitePagesForDashboard } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { DashSidebar } from '@/components/DashSidebar';
import { SignOutButton } from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

/** SYSTEM_* kinds that already have their own named, dedicated
 *  dashboard screen (Homepage/Posts/Programmes/Campaigns/Leadership/
 *  Gallery — each manages the real underlying content: individual
 *  posts, programmes, campaigns, team members, photos). Listing those
 *  same pages again under the sidebar's "Pages" dropdown just for
 *  their title/SEO fields reads as the same item twice; that content
 *  is still reachable from the full /dashboard/pages list, so nothing
 *  is lost by leaving them out of the dropdown specifically. About,
 *  FAQ, Contact and every CUSTOM page have no such existing entry
 *  point, so they stay. */
const KINDS_WITH_OWN_SCREEN = new Set([
  'SYSTEM_HOME', 'SYSTEM_POSTS', 'SYSTEM_PROGRAMS', 'SYSTEM_CAMPAIGNS', 'SYSTEM_LEADERSHIP', 'SYSTEM_GALLERY',
]);

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { ctx, page } = await requireMyPage();
  const [newMessageCount, sitePages] = await Promise.all([
    countNewJamiiContactMessages(ctx, page.organisationId),
    listJamiiSitePagesForDashboard(ctx, page.organisationId),
  ]);

  return (
    <div className="dash">
      <DashSidebar
        orgName={page.organisation.officialName}
        slug={page.slug}
        newMessageCount={newMessageCount}
        pages={sitePages
          .filter((p) => !KINDS_WITH_OWN_SCREEN.has(p.kind))
          .map((p) => ({ id: p.id, title: p.title }))}
      />
      <div className="dashmain">
        <div className="dashbar">
          <div className="l">
            Managing <b>{page.organisation.officialName}</b>
            {' · '}
            <span style={{ color: page.status === 'PUBLISHED' ? 'var(--ledger)' : '#8a8368', fontWeight: 700 }}>
              {page.status === 'PUBLISHED' ? 'Published' : 'Draft'}
            </span>
          </div>
          <div className="r">
            <Link href={`/o/${page.slug}`}>Visit page →</Link>
            <SignOutButton />
          </div>
        </div>
        <div className="dashcontent">{children}</div>
      </div>
    </div>
  );
}
