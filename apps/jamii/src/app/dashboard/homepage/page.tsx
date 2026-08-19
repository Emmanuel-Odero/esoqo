import { getJamiiPageForManagement, listJamiiPageBlocksForDashboard } from '@esoko/db';
import { requireMyPage } from '@/lib/session';
import { BlockEditor } from './BlockEditor';
import { DEFAULT_BLOCKS } from './default-blocks';

export default async function HomepageScreen() {
  const { ctx, page: myPage } = await requireMyPage();
  const page = await getJamiiPageForManagement(ctx, myPage.organisationId);
  if (!page) return null;

  const blocks = await listJamiiPageBlocksForDashboard(ctx, page.organisationId);

  return (
    <>
      <h1>Homepage</h1>
      <p className="sub">
        Reorder, hide, or add sections to your custom domain&rsquo;s homepage. Drag a row by its
        handle to move it. Nothing here affects your ourjamii.co.ke listing.
      </p>
      <BlockEditor
        pageId={page.organisationId}
        photos={page.photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption }))}
        initialBlocks={blocks.length > 0
          ? blocks.map((b) => ({ id: b.id, type: b.type, visible: b.visible, data: b.data as Record<string, unknown> }))
          : DEFAULT_BLOCKS}
      />
    </>
  );
}
