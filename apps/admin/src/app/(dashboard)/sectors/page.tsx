import { Icon } from '@esoko/ui';
import { getRegistrationSegments, getOverview } from '@esoko/db';
import { SEGMENTS } from '@esoko/domain';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SectorsPage() {
  const ctx = await requireStaff();
  const [segments, overview] = await Promise.all([
    getRegistrationSegments(ctx, 30),
    getOverview(ctx),
  ]);

  const total = segments.reduce((n, s) => n + s.count, 0);
  const max = Math.max(1, ...segments.map((s) => s.count));
  const label = (key: string) => SEGMENTS.find((s) => s.key === key)?.name ?? key.replace(/-/g, ' ');

  return (
    <>
      <div className="head">
        <div>
          <h1>Sectors</h1>
          <p>
            What people who joined said they do, matched against Esoko&rsquo;s shared trade
            dictionary. Based on {overview.registrationsComplete.toLocaleString()} completed
            registrations.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi g">
          <span className="ico" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="tag" size={16} />
          </span>
          <span className="n">{segments.length}</span>
          <span className="l">Distinct sectors</span>
        </div>
        <div className="kpi b">
          <span className="ico" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
            <Icon name="star" size={16} />
          </span>
          <span className="n">{segments[0] ? label(segments[0].segment) : '—'}</span>
          <span className="l">Largest sector</span>
        </div>
        <div className="kpi a">
          <span className="ico" style={{ background: 'var(--amber-t)', color: 'var(--amber)' }}>
            <Icon name="users" size={16} />
          </span>
          <span className="n">{total}</span>
          <span className="l">People classified</span>
        </div>
      </div>

      <div className="card">
        <h2>Members by sector</h2>
        {segments.length === 0 ? (
          <p className="empty">No completed registrations have a matched trade yet.</p>
        ) : (
          <table className="tbl">
            <tbody>
              {segments.map((s) => (
                <tr key={s.segment}>
                  <td>{label(s.segment)}</td>
                  <td className="mono" style={{ width: 60 }}>{s.count}</td>
                  <td style={{ width: '45%' }}>
                    <div className="bar">
                      <span style={{ width: `${(s.count / max) * 100}%`, background: 'var(--blue)' }} />
                    </div>
                  </td>
                  <td className="sub mono" style={{ width: 60, textAlign: 'right' }}>
                    {total ? Math.round((s.count / total) * 1000) / 10 : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
