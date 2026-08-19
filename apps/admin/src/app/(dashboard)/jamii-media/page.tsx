import { listMediaAssetsForStaff } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { MediaLibraryTable } from './MediaLibraryTable';

export const dynamic = 'force-dynamic';

/**
 * The platform-wide "no photo yet" placeholder library — see
 * @esoko/db's JamiiMediaAsset. Every custom-domain page with no cover
 * photo, gallery upload or post image falls back to one of these,
 * picked automatically per page/post; this screen is where staff
 * curate which patterns are on offer, their labels and their order.
 * The patterns themselves are code-authored (apps/jamii's illustration
 * registry) — this table can only enable/disable/relabel/reorder them,
 * never inject new SVG content, so there's no stored-content risk here.
 */
export default async function JamiiMediaPage() {
  const ctx = await requireStaff();
  const rows = await listMediaAssetsForStaff(ctx);
  const canWrite = ctx.capabilities.includes('*') || ctx.capabilities.includes('jamii-media.manage');

  return (
    <>
      <div className="head">
        <div>
          <h1>Our Jamii — media library</h1>
          <p>
            Placeholder patterns shown on a custom-domain page when it has no cover photo, gallery
            photos or post image yet. Toggle which ones are in rotation, or rename them.
          </p>
        </div>
      </div>

      <MediaLibraryTable
        rows={rows.map((r) => ({
          id: r.id,
          key: r.key,
          label: r.label,
          category: r.category,
          patternKey: r.patternKey,
          active: r.active,
        }))}
        canWrite={canWrite}
      />
    </>
  );
}
