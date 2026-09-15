import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import { DonutChart } from '@/components/charts';
import { OrgTable } from './OrgTable';
import { adminGo, type GoAdminOrg } from '@/lib/go-ticketing';

export const dynamic = 'force-dynamic';

/**
 * Every ticketing organiser platform-wide — event companies, tour/travel
 * operators, transport (bus/matatu SACCO) companies. The counterpart to
 * apps/app's self-service /org/[orgId] (which only ever shows an owner
 * their own organiser). Directory + counts come from core-go.
 */
export default async function TicketingPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; vertical?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const params = new URLSearchParams({
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.vertical ? { vertical: sp.vertical } : {}),
    ...(sp.q ? { search: sp.q } : {}),
    take: '100',
  });
  const [{ rows }, counts] = await Promise.all([
    adminGo<{ rows: GoAdminOrg[]; total: number }>(`/v1/admin/ticketorgs?${params}`),
    adminGo<{ total: number; active: number; events: number; transport: number }>('/v1/admin/ticketorgs/counts'),
  ]);
  const canModerate = ctx.capabilities.includes('*') || ctx.capabilities.includes('ticketorg.moderate');
  const canManageStaff = ctx.capabilities.includes('*') || ctx.capabilities.includes('ticketorgstaff.write');

  return (
    <>
      <div className="head">
        <div>
          <h1>Ticketing — organisers</h1>
          <p>
            Event companies, tour operators and transport companies selling through Esoqo. Add their
            first ticket sellers and gate staff here while you&rsquo;re onboarding them — day-to-day
            staffing stays with the organiser&rsquo;s own team afterwards.
          </p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['tag', 'b', counts.total, 'Total organisers'],
          ['check-circle', 'g', counts.active, 'Active'],
          ['calendar', 'a', counts.events, 'Events & tours'],
          ['truck', 'a', counts.transport, 'Transport'],
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

      {counts.total > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2><Icon name="tag" size={17} />By vertical</h2>
          <DonutChart size={150} centerLabel={{ value: String(counts.total), sub: 'organisers' }} segments={[
            { label: 'Events & tours', value: counts.events, color: 'var(--amber)' },
            { label: 'Transport', value: counts.transport, color: 'var(--blue)' },
          ].filter((s) => s.value > 0)} />
        </div>
      )}

      <OrgTable
        rows={rows.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          vertical: o.vertical,
          status: o.status,
          owner: o.ownerName || '—',
          staffCount: o.staffCount,
          listingCount: o.listingsCount,
          createdAt: new Date(o.createdAt).toISOString(),
        }))}
        canModerate={canModerate}
        canManageStaff={canManageStaff}
        q={sp.q ?? ''}
        status={sp.status ?? ''}
      />
    </>
  );
}
