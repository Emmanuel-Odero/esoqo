import { listMyConsents } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { ConsentList } from './ConsentList';

export const dynamic = 'force-dynamic';

export default async function MyConsents() {
  const ctx = await requireSubject();
  const grants = await listMyConsents(ctx);

  return (
    <>
      <div className="mehead">
        <h1>Who can see your information</h1>
        <p>
          Each permission names one institution and one reason, and runs for a period you set.
          Ending one takes effect immediately and the institution is told.
        </p>
      </div>

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
