import { Icon } from '@esoko/ui';
import { listAuditEvents, getAuditActionCounts, verifyChain } from '@esoko/db';
import { requireStaff } from '@/lib/session';
import { RankedBarChart } from '@/components/charts';
import { AuditFilters } from './AuditFilters';
import { Pager } from './Pager';

export const dynamic = 'force-dynamic';

const ACTOR_PILL: Record<string, string> = {
  SYSTEM: 'p-info', STAFF: 'p-ok', SUBJECT: 'p-mute', AGENT: 'p-warn', ISSUER: 'p-bad',
};

/**
 * The audit log, exactly as a regulator would be shown it — filterable
 * by action, actor type and date range, page-based rather than a
 * fixed top-60 with no way to see anything older. Chain status is
 * verified on every load, not cached.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actorType?: string; from?: string; to?: string; page?: string }>;
}) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const take = 50;

  const actorType = ['SUBJECT', 'STAFF', 'AGENT', 'SYSTEM', 'ISSUER'].includes(sp.actorType ?? '')
    ? (sp.actorType as 'SUBJECT' | 'STAFF' | 'AGENT' | 'SYSTEM' | 'ISSUER')
    : undefined;
  const from = sp.from ? new Date(`${sp.from}T00:00:00.000Z`) : undefined;
  // Inclusive of the whole "to" day, not just its midnight instant.
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999Z`) : undefined;

  const [{ rows, total }, counts, chain] = await Promise.all([
    listAuditEvents(ctx, { action: sp.action, actorType, from, to, take, skip: (page - 1) * take }),
    getAuditActionCounts(ctx),
    verifyChain(),
  ]);

  return (
    <>
      <div className="head">
        <h1>Audit log</h1>
        <p>Append-only and hash-chained. {total.toLocaleString()} event{total === 1 ? '' : 's'} match this filter.</p>
      </div>

      <div className={`chain ${chain.ok ? 'ok' : 'bad'}`} role="status">
        <Icon name={chain.ok ? 'shield-check' : 'alert-triangle'} size={18} />
        {chain.ok
          ? `Chain verified end to end — ${chain.checked.toLocaleString()} events, no gaps or alterations`
          : `CHAIN BROKEN at event ${chain.brokenAtId} (${chain.brokenAtTime?.toISOString()}). Every report after this point is suspect. Run "pnpm --filter @esoko/db repair:audit-chain" if this is a known hashing-algorithm fix, otherwise treat this as a real incident.`}
      </div>

      <AuditFilters action={sp.action ?? ''} actorType={sp.actorType ?? ''} from={sp.from ?? ''} to={sp.to ?? ''} />

      <div className="grid2">
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Events</h2>
          {rows.length === 0 ? (
            <p className="empty">No events match this filter.</p>
          ) : (
            <>
              <table className="tbl">
                <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Hash</th></tr></thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td className="mono" style={{ fontSize: '.82rem', color: 'var(--tx-2)', whiteSpace: 'nowrap' }}>
                        {e.occurredAt.toISOString().slice(0, 19).replace('T', ' ')}
                      </td>
                      <td>
                        <span className={`pill ${ACTOR_PILL[e.actorType] ?? 'p-mute'}`}>{e.actorType}</span>
                        {e.actorId && (
                          <span className="sub mono" style={{ display: 'block', fontSize: '.72rem', marginTop: 3 }}>
                            {e.actorId.length > 24 ? `${e.actorId.slice(0, 8)}…` : e.actorId}
                          </span>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: '.85rem' }}>{e.action}</td>
                      <td style={{ color: 'var(--tx-2)', fontSize: '.84rem' }}>
                        {e.targetType ? `${e.targetType} ${e.targetId?.slice(0, 8)}…` : '—'}
                      </td>
                      <td className="mono" style={{ fontSize: '.74rem', color: 'var(--tx-3)' }}>
                        {e.hash.slice(0, 12)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager page={page} pages={Math.max(1, Math.ceil(total / take))}
                filters={{ action: sp.action, actorType: sp.actorType, from: sp.from, to: sp.to }} />
            </>
          )}
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Most active actions, last 7 days</h2>
          {counts.length === 0 ? <p className="empty">No events in the last 7 days.</p> : (
            <RankedBarChart color="var(--navy-2)" rows={counts.map((c) => ({ label: c.action, value: c.count }))} />
          )}
        </div>
      </div>
    </>
  );
}
