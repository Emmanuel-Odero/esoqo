import { Icon } from '@esoko/ui';
import { getRegistrationSegments, getOverview } from '@esoko/db';
import { SEGMENTS } from '@esoko/domain';
import { requireStaff } from '@/lib/session';
import { RankedBarChart, DonutChart } from '@/components/charts';

const DONUT_PALETTE = ['var(--green-2)', 'var(--blue)', 'var(--amber)', 'var(--navy-2)', 'var(--red)', 'var(--tx-3)'];

export const dynamic = 'force-dynamic';

export default async function SectorsPage() {
  const ctx = await requireStaff();
  const [segments, overview] = await Promise.all([
    getRegistrationSegments(ctx, 30),
    getOverview(ctx),
  ]);

  const total = segments.reduce((n, s) => n + s.count, 0);
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

      {segments.length > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2>Top 5, share of classified members</h2>
          {(() => {
            const top5 = segments.slice(0, 5);
            const rest = segments.slice(5).reduce((n, s) => n + s.count, 0);
            const segs = top5.map((s, i) => ({ label: label(s.segment), value: s.count, color: DONUT_PALETTE[i % DONUT_PALETTE.length]! }));
            if (rest > 0) segs.push({ label: 'Everyone else', value: rest, color: 'var(--tx-3)' });
            return <DonutChart size={160} centerLabel={{ value: String(total), sub: 'classified' }} segments={segs} />;
          })()}
        </div>
      )}

      <div className="card">
        <h2>Members by sector</h2>
        {segments.length === 0 ? (
          <p className="empty">No completed registrations have a matched trade yet.</p>
        ) : (
          <RankedBarChart color="var(--blue)"
            rows={segments.map((s) => ({ label: label(s.segment), value: s.count }))} />
        )}
      </div>
    </>
  );
}
