import Link from 'next/link';
import { Icon } from '@esoko/ui';
import { listMyTicketOrgs, getMyRecord } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { CreateOrgForm } from './CreateOrgForm';

export const dynamic = 'force-dynamic';

/**
 * The switchboard between "I'm a customer" and "I run an organiser".
 * Every owned TicketOrg links out to its full console at /org/[orgId] —
 * this page itself stays a directory, same job Group's picker does for
 * treasury.
 */
export default async function MyOrganiser() {
  const ctx = await requireSubject();
  const [orgs, me] = await Promise.all([listMyTicketOrgs(ctx), getMyRecord(ctx)]);
  const enterprises = (me?.enterprises ?? []).map((e) => ({ id: e.id, workRaw: e.workRaw }));

  return (
    <>
      <div className="mehead">
        <h1>Sell tickets</h1>
        <p>Run an event company, tour operator, or transport company on Esoko.</p>
      </div>

      {orgs.length > 0 && (
        <div className="mcard" style={{ marginBottom: 16 }}>
          <h2><Icon name="building" size={18} />Your organisers</h2>
          {orgs.map((org) => (
            <div className="mrow" key={org.id}>
              <span className="k">{org.name}</span>
              <span className="v">
                {org.vertical === 'TRANSPORT' ? 'Transport' : 'Events'} · {org.status.toLowerCase()}
                {' — '}
                <Link href={`/org/${org.id}`}>Open console</Link>
              </span>
            </div>
          ))}
        </div>
      )}

      <CreateOrgForm enterprises={enterprises} />
    </>
  );
}
