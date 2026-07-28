import { Icon } from '@esoko/ui';
import { listAuditEvents, getAuditActionCounts, verifyChain } from '@esoko/db';
import { requireStaff } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The audit log, exactly as a regulator would be shown it.
 * Chain status is verified on every load, not cached.
 */
export default async function AuditPage() {
  const ctx = await requireStaff();
  const [{ rows, total }, counts, chain] = await Promise.all([
    listAuditEvents(ctx, { take: 60 }),
    getAuditActionCounts(ctx),
    verifyChain(),
  ]);

  return (
    <>
      <div className="head">
        <h1>Audit log</h1>
        <p>Append-only and hash-chained. {total.toLocaleString()} events recorded.</p>
      </div>

      <div className={`chain ${chain.ok ? 'ok' : 'bad'}`} role="status">
        <Icon name={chain.ok ? 'shield-check' : 'alert-triangle'} size={18} />
        {chain.ok
          ? `Chain verified end to end — ${chain.checked.toLocaleString()} events, no gaps or alterations`
          : `CHAIN BROKEN at event ${chain.brokenAtId} (${chain.brokenAtTime?.toISOString()}). Every report after this point is suspect.`}
      </div>

      <div className="grid2">
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Recent events</h2>
          <table className="tbl">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Hash</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="mono" style={{ fontSize: '.82rem', color: 'var(--tx-2)' }}>
                    {e.occurredAt.toISOString().slice(0, 19).replace('T', ' ')}
                  </td>
                  <td><span className="pill p-mute">{e.actorType}</span></td>
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
        </div>

        <div className="card">
          <h2>Actions this week</h2>
          <table className="tbl">
            <tbody>
              {counts.map((c) => (
                <tr key={c.action}>
                  <td className="mono" style={{ fontSize: '.85rem' }}>{c.action}</td>
                  <td className="mono">{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
