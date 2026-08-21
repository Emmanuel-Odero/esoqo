import { listJamiiNavItemsForDashboard, listJamiiSitePagesForDashboard } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { NavEditor } from './NavEditor';

export default async function NavigationScreen() {
  const { ctx, page } = await requireMyPage();
  const [items, sitePages] = await Promise.all([
    listJamiiNavItemsForDashboard(ctx, page.organisationId),
    listJamiiSitePagesForDashboard(ctx, page.organisationId),
  ]);

  return (
    <>
      <h1 style={{ marginBottom: 4 }}>Navigation</h1>
      <p className="sub">
        Choose what shows up in your menu, in what order. Home is always first and can&rsquo;t be
        removed; everything else — including built-in sections like About or FAQ — can be hidden,
        reordered, renamed, or removed from the menu without deleting the page itself.
      </p>
      <NavEditor
        pageId={page.organisationId}
        initialItems={items.map((i) => ({
          id: i.id,
          label: i.label,
          visible: i.visible,
          openInNewTab: i.openInNewTab,
          targetKind: i.targetKind,
          targetSitePageId: i.targetSitePageId ?? undefined,
          externalUrl: i.externalUrl ?? undefined,
        }))}
        sitePages={sitePages
          .filter((p) => p.kind !== 'SYSTEM_HOME')
          .map((p) => ({ id: p.id, title: p.title }))}
      />
    </>
  );
}
