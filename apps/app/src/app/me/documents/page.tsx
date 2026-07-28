import { Icon, type IconName } from '@esoko/ui';
import { getMyRecord } from '@esoko/db';
import { requireSubject } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = {
  PENDING_REVIEW: ['b-warn', 'Being checked'],
  ACCEPTED: ['b-ok', 'Accepted'],
  REJECTED: ['b-bad', 'Not accepted'],
  SUPERSEDED: ['b-mute', 'Replaced'],
};

function icon(mime: string): IconName {
  if (mime.startsWith('image/')) return 'certificate';
  if (mime.includes('sheet') || mime.includes('excel')) return 'grid';
  return 'document';
}

export default async function MyDocuments() {
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  const docs = me?.documents ?? [];

  return (
    <>
      <div className="mehead">
        <h1>Your documents</h1>
        <p>Papers you have given Esoko. Only staff reviewing your record can open them.</p>
      </div>

      {docs.length === 0 ? (
        <div className="mcard">
          <div className="mempty">
            <span className="ico"><Icon name="document" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>Nothing here yet</h2>
            <p style={{ margin: 0 }}>
              You can add a document at any time — dial *483*77# and choose 6, or ask a field
              officer.
            </p>
          </div>
        </div>
      ) : (
        <div className="mcard">
          {docs.map((d) => {
            const [cls, label] = STATUS[d.status] ?? ['b-mute', d.status];
            return (
              <div className="mrow" key={d.id}>
                <span className="k" style={{ width: 40 }}>
                  <Icon name={icon(d.mimeType)} size={20} style={{ color: 'var(--blue)' }} />
                </span>
                <span style={{ flex: 1 }}>
                  <span className="v" style={{ display: 'block' }}>{d.title}</span>
                  <span className="hint" style={{ margin: 0 }}>
                    Added {d.uploadedAt.toLocaleDateString('en-KE')} ·{' '}
                    {Math.round(d.sizeBytes / 1024)} KB
                    {d.reviewNote && d.status === 'REJECTED' && ` · ${d.reviewNote}`}
                  </span>
                </span>
                <span className={`badge ${cls}`}>{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
