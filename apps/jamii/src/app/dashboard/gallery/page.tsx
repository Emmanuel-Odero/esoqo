import { getJamiiPageForManagement } from '@esoqo/db';
import { requireMyPage } from '@/lib/session';
import { GalleryManager } from './GalleryManager';

export default async function GalleryScreen() {
  const { ctx, page: myPage } = await requireMyPage();
  const page = await getJamiiPageForManagement(ctx, myPage.organisationId);
  if (!page) return null;

  return (
    <>
      <h1>Gallery</h1>
      <p className="sub">Photos shown on your public page&rsquo;s Gallery section.</p>
      <GalleryManager pageId={page.organisationId} photos={page.photos} />
    </>
  );
}
