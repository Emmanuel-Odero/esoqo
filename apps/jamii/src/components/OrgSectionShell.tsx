import { notFound } from 'next/navigation';
import { OrgHeader } from './OrgHeader';
import { OrgSubnav } from './OrgSubnav';
import { OrgSidebar } from './OrgSidebar';
import { loadOrgPage } from '@/lib/data';

export async function loadOrgOr404(slug: string) {
  const page = await loadOrgPage(slug);
  if (!page) notFound();
  return page;
}

export async function OrgSectionShell({
  slug, noSidebar = false, children,
}: { slug: string; noSidebar?: boolean; children: React.ReactNode }) {
  const page = await loadOrgOr404(slug);

  return (
    <>
      <OrgHeader page={page} />
      <OrgSubnav slug={slug} />
      <div className={`wrap orgtop${noSidebar ? ' nosidebar' : ''}`}>
        <div id="orgPanels">{children}</div>
        {!noSidebar && <OrgSidebar page={page} />}
      </div>
    </>
  );
}
