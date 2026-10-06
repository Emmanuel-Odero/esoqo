import { listMyConsents } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { ConsentList } from './ConsentList';

export const dynamic = 'force-dynamic';

export default async function MyConsents() {
  const ctx = await requireSubject();
  const grants = await listMyConsents(ctx);
  const active = grants.filter((g) => !g.revokedAt && g.expiresAt > new Date());
  const totalAccesses = grants.reduce((sum, g) => sum + g._count.accesses, 0);

  return (
    <>
      <header className="hero" style={{ padding: '4px 0 14px' }}>
        <p className="kicker">Privacy</p>
        <h1>Who can see your information</h1>
        <p className="lead" style={{ maxWidth: 560 }}>
          Each permission names one institution and one reason, and runs for a period you set.
          Ending one takes effect immediately and the institution is told.
        </p>
      </header>

      {grants.length > 0 && (
        <div className="premium-stats" aria-label="Permissions at a glance">
          <div className="pstat">
            <span className="pstat-k">Allowed now</span>
            <span className="pstat-v">{active.length}</span>
            <span className="pstat-h">{active.length === 1 ? 'organisation' : 'organisations'}</span>
          </div>
          <div className="pstat">
            <span className="pstat-k">Ended</span>
            <span className="pstat-v">{grants.length - active.length}</span>
            <span className="pstat-h">Revoked or expired</span>
          </div>
          <div className="pstat">
            <span className="pstat-k">Looked at</span>
            <span className="pstat-v">{totalAccesses}</span>
            <span className="pstat-h">Times, all time</span>
          </div>
        </div>
      )}

      <ConsentList
        grants={grants.map((g) => ({
          id: g.id,
          grantee: g.grantee.name,
          purpose: g.purpose.replace(/_/g, ' ').toLowerCase(),
          scope: g.scope,
          wording: g.wordingShown,
          grantedAt: g.grantedAt.toISOString(),
          expiresAt: g.expiresAt.toISOString(),
          revokedAt: g.revokedAt?.toISOString() ?? null,
          channel: g.channel,
          accesses: g._count.accesses,
        }))}
      />
    </>
  );
}
