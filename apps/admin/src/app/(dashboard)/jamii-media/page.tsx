import { Icon } from '@esoqo/ui';
import { listMediaAssetsForStaff } from '@esoqo/db';
import { requireStaff } from '@/lib/session';
import { RankedBarChart } from '@/components/charts';
import { MediaLibraryTable } from './MediaLibraryTable';

export const dynamic = 'force-dynamic';

/**
 * The platform-wide "no photo yet" placeholder library — see
 * @esoqo/db's JamiiMediaAsset. Every custom-domain page with no cover
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

  const active = rows.filter((r) => r.active).length;
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);

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

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="check-circle" size={16} /></span>
          <span className="n">{active}</span><span className="l">In rotation</span>
        </div>
        <div className="kpi">
          <span className="n">{rows.length - active}</span><span className="l">Disabled</span>
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="grid" size={16} /></span>
          <span className="n">{byCategory.size}</span><span className="l">Categories</span>
        </div>
      </div>

      {byCategory.size > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2>Patterns by category</h2>
          <RankedBarChart rows={[...byCategory.entries()].map(([label, value]) => ({ label, value }))} color="var(--blue)" />
        </div>
      )}

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
