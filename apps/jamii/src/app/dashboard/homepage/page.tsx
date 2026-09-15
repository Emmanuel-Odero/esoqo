import { getJamiiPageForManagement, getJamiiSitePageByKind, listJamiiPageBlocksForDashboard } from '@esoqo/db';
import { requireMyPage } from '@/lib/session';
import { BlockEditor } from '../_pages/BlockEditor';
import { DEFAULT_BLOCKS } from '../_pages/default-blocks';

export default async function HomepageScreen() {
  const { ctx, page: myPage } = await requireMyPage();
  const page = await getJamiiPageForManagement(ctx, myPage.organisationId);
  if (!page) return null;

  // SYSTEM_HOME always exists — every JamiiPage got one from the
  // generic-CMS backfill (or from page-creation, going forward).
  const home = await getJamiiSitePageByKind(page.organisationId, 'SYSTEM_HOME');
  const blocks = home ? await listJamiiPageBlocksForDashboard(ctx, page.organisationId, home.id) : [];

  return (
    <>
      <h1>Homepage</h1>
      <p className="sub">
        Reorder, hide, or add sections to your custom domain&rsquo;s homepage. Drag a row by its
        handle to move it. Nothing here affects your ourjamii.co.ke listing.
      </p>
      <BlockEditor
        pageId={page.organisationId}
        sitePageId={home!.id}
        photos={page.photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption }))}
        initialBlocks={blocks.length > 0
          ? blocks.map((b) => ({ id: b.id, type: b.type, visible: b.visible, data: b.data as Record<string, unknown> }))
          : DEFAULT_BLOCKS}
      />
    </>
  );
}
