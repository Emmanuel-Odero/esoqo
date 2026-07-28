import { Icon } from '@esoko/ui';
import { listDocuments, getDocumentStats, DOCUMENT_KINDS } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { DocumentGrid } from './DocumentGrid';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; kind?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const [{ rows, total }, stats] = await Promise.all([
    listDocuments(ctx, { status: sp.status as never, kind: sp.kind, take: 48 }),
    getDocumentStats(ctx),
  ]);
  const by = (s: string) => stats.find((x) => x.status === s)?.count ?? 0;

  return (
    <>
      <div className="head">
        <div>
          <h1>Documents</h1>
          <p>
            Uploaded during registration or added later. Files are stored under opaque keys and
            served only through an authorised route — never as static assets.
          </p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['clock', 'a', by('PENDING_REVIEW'), 'Awaiting review'],
          ['check-circle', 'g', by('ACCEPTED'), 'Accepted'],
          ['ban', 'r', by('REJECTED'), 'Rejected'],
          ['document', 'b', total, 'Total held'],
        ] as const).map(([icon, tone, n, label]) => {
          const c = { g: 'green', b: 'blue', a: 'amber', r: 'red' }[tone];
          return (
            <div className={`kpi ${tone}`} key={label}>
              <span className="ico" style={{ background: `var(--${c}-t)`, color: `var(--${c})` }}>
                <Icon name={icon} size={16} />
              </span>
              <span className="n">{n}</span><span className="l">{label}</span>
            </div>
          );
        })}
      </div>

      <DocumentGrid
        docs={rows.map((d) => ({
          id: d.id, title: d.title, kind: d.kind, mimeType: d.mimeType,
          sizeBytes: d.sizeBytes, status: d.status,
          uploadedAt: d.uploadedAt.toISOString(),
          owner: d.registration?.knownAs || d.registration?.officialName
            || d.party?.person?.knownAs || d.party?.person?.officialName || 'Unattached',
          originalName: d.originalName,
        }))}
        kinds={DOCUMENT_KINDS as never}
        canReview={ctx.capabilities.includes('*') || ctx.capabilities.includes('document.review')}
        canDelete={ctx.capabilities.includes('*') || ctx.capabilities.includes('document.delete')}
      />
    </>
  );
}
