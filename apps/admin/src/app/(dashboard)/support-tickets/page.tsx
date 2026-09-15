import { Icon } from '@esoqo/ui';
import { listSupportTicketsForStaff, getSupportTicketCountsForStaff } from '@esoqo/db';
import { requireStaff } from '@/lib/session';
import { DonutChart } from '@/components/charts';
import { SupportTicketsTable } from './SupportTicketsTable';

export const dynamic = 'force-dynamic';

/**
 * "Report an issue" — anyone signed in, anywhere in the product, hits
 * a problem they can't self-serve past. See SupportTicket's own doc
 * comment in schema.prisma; today the only app with a "Raise a ticket"
 * form is Our Jamii's dashboard, but this queue is platform-wide.
 */
export default async function SupportTicketsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const status = (sp.status || undefined) as never;
  const [{ rows }, counts] = await Promise.all([
    listSupportTicketsForStaff(ctx, { status, take: 200 }),
    getSupportTicketCountsForStaff(ctx),
  ]);
  const canWrite = ctx.capabilities.includes('*') || ctx.capabilities.some((c) => c.startsWith('support-ticket.'));

  return (
    <>
      <div className="head">
        <div>
          <h1>Support tickets</h1>
          <p>Issues reported from inside the product — bugs, questions, billing, account problems.</p>
        </div>
      </div>

      <div className="kpis">
        {([
          ['clock', 'a', counts.open, 'Open'],
          ['phone-call', 'b', counts.inProgress, 'In progress'],
          ['check-circle', 'g', counts.resolved, 'Resolved'],
          ['ban', 'r', counts.closed, 'Closed'],
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
          <h2><Icon name="message" size={17} />Status split</h2>
          <DonutChart size={150} centerLabel={{ value: String(counts.total), sub: 'tickets' }} segments={[
            { label: 'Open', value: counts.open, color: 'var(--amber)' },
            { label: 'In progress', value: counts.inProgress, color: 'var(--blue)' },
            { label: 'Resolved', value: counts.resolved, color: 'var(--green-2)' },
            { label: 'Closed', value: counts.closed, color: 'var(--tx-3)' },
          ].filter((s) => s.value > 0)} />
        </div>
      )}

      <SupportTicketsTable
        rows={rows.map((r) => ({
          id: r.id,
          status: r.status,
          category: r.category,
          categoryOther: r.categoryOther,
          subject: r.subject,
          message: r.message,
          staffNote: r.staffNote,
          reporterName: r.reporter.person?.knownAs || r.reporter.person?.officialName || 'Unknown',
          reporterEmail: r.reporter.person?.email ?? null,
          reporterMsisdn: r.reporter.person?.msisdn ?? null,
          pageSlug: r.page?.slug ?? null,
          orgName: r.page?.organisation.officialName ?? null,
          createdAt: r.createdAt.toISOString(),
        }))}
        canWrite={canWrite}
        status={sp.status ?? ''}
      />
    </>
  );
}
