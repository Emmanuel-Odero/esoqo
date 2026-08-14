import Link from 'next/link';
import '@esoko/ui/tokens.css';
import '../jamii.css';
import { requireMyPage } from '@/lib/session';
import { DashSidebar } from '@/components/DashSidebar';
import { SignOutButton } from '@/components/SignOutButton';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { page } = await requireMyPage();

  return (
    <div className="dash">
      <DashSidebar orgName={page.organisation.officialName} slug={page.slug} />
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
