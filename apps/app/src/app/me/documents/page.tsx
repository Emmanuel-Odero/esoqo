import { Icon, type IconName } from '@esoqo/ui';
import { getMyRecord } from '@esoqo/db';
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
        <p className="kicker">Your record</p>
        <h1>Your documents</h1>
        <p>
          Files you have given Esoqo. Only staff reviewing your record can open them.
          Esoqo&apos;s confirmations on your record (phone, ID, group, business, KRA) are summarised
          on your <a href="/me">Record home</a>.
        </p>
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
          <ul className="papers">
            {docs.map((d) => {
              const [cls, label] = STATUS[d.status] ?? ['b-mute', d.status];
              return (
                <li className="paper" key={d.id}>
                  <span className="ps" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
                    <Icon name={icon(d.mimeType)} size={16} />
                  </span>
                  <span className="pt">
                    <span className="t">{d.title}</span>
                    <span className="s">
                      Added {d.uploadedAt.toLocaleDateString('en-KE')} ·{' '}
                      {Math.round(d.sizeBytes / 1024)} KB
                      {d.reviewNote && d.status === 'REJECTED' && ` · ${d.reviewNote}`}
                    </span>
                  </span>
                  <span className={`badge ${cls}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
