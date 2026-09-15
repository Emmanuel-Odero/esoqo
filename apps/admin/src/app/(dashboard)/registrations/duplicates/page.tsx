import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { findProbableDuplicates, listRegistrations } from '@esoqo/db';
import { maskMsisdn } from '@esoqo/domain';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Duplicate review.
 *
 * This is the agent-fraud control from the journey maps. Once institutions
 * pay per qualified referral, duplicate registration becomes a revenue
 * vector — so it needs a human queue, not just a unique index.
 */
export default async function DuplicatesPage() {
  const ctx = await requireStaff();
  const dupes = await findProbableDuplicates(ctx, 40);
  const canSeePii = ctx.capabilities.includes('*') || ctx.capabilities.includes('party.pii');

  const detail = await Promise.all(
    dupes.map(async (d) => {
      const { rows } = await listRegistrations(ctx, { search: d.msisdn, take: 10 });
      return { ...d, rows };
    }),
  );

  return (
    <>
      <div className="head">
        <div>
          <h1>Probable duplicates</h1>
          <p>
            Numbers that appear on more than one live registration. Most are honest re-attempts
            after a dropped session. Some are not — and once a lender pays per referral, the
            difference matters.
          </p>
        </div>
        <div className="actions">
          <Link className="btn btn-o" href="/registrations">
            <Icon name="arrow-left" size={15} />All registrations
          </Link>
        </div>
      </div>

      {detail.length === 0 ? (
        <div className="card">
          <div className="empty">
            <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
              <Icon name="check-circle" size={22} />
            </span>
            <h3>No duplicates found</h3>
            <p style={{ margin: 0 }}>Every live registration has a distinct phone number.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="chain bad" style={{ marginBottom: 20 }}>
            <Icon name="alert-triangle" size={18} />
            <span>
              {detail.length} {detail.length === 1 ? 'number appears' : 'numbers appear'} more than
              once. Void the extras with a reason — never hard-delete.
            </span>
          </div>

          {detail.map((d) => (
            <div className="card" key={d.msisdn} style={{ marginBottom: 16 }}>
              <h2>
                <Icon name="phone" size={17} />
                <span className="mono">{canSeePii ? d.msisdn : maskMsisdn(d.msisdn)}</span>
                <span className="pill p-bad" style={{ marginLeft: 8 }}>{d.count} registrations</span>
              </h2>
              <table className="tbl">
                <thead>
                  <tr><th>Name</th><th>County</th><th>Work</th><th>Status</th><th>Started</th><th /></tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.knownAs || r.officialName || '—'}</strong></td>
                      <td>{r.county ?? '—'}</td>
                      <td className="sub">{r.workRaw ?? '—'}</td>
                      <td>
                        <span className={`pill ${r.status === 'COMPLETE' ? 'p-ok' : 'p-mute'}`}>
                          {r.status.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </td>
                      <td className="mono sub" style={{ fontSize: '.79rem' }}>
                        {r.startedAt.toISOString().slice(0, 16).replace('T', ' ')}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Link className="btn btn-o btn-sm" href={`/registrations?q=${encodeURIComponent(r.msisdn ?? '')}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
                Keep the earliest completed record. Void the rest from the registrations page with
                a reason such as “duplicate of the 14 March registration”.
              </p>
            </div>
          ))}
        </>
      )}
    </>
  );
}
