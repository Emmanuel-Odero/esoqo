import Link from 'next/link';
import { cookies } from 'next/headers';
import { Icon } from '@esoqo/ui';
import { getMyRecord } from '@esoqo/db';
import { SESSION_COOKIE } from '@esoqo/auth';
import { requireSubject } from '@/lib/session';
import { goUrl } from '@/lib/ticketing';
import { CreateOrgForm } from './CreateOrgForm';

export const dynamic = 'force-dynamic';

interface OrgRow {
  ID: string;
  Name: string;
  Slug: string;
  Vertical: string;
  Status: string;
}

/**
 * The switchboard between "I'm a customer" and "I run an organiser".
 * Every owned TicketOrg links out to its full console at /org/ticket/[orgId] —
 * this page itself stays a directory, same job Group's picker does for
 * treasury. The directory comes from core-go (GET /v1/me/orgs); the
 * enterprises picker still comes from the party record.
 */
export default async function MyOrganiser() {
  const ctx = await requireSubject();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const orgs: OrgRow[] = token
    ? await fetch(goUrl('/v1/me/orgs'), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : { orgs: [] }))
        .then((j) => (j?.orgs ?? []) as OrgRow[])
        .catch(() => [])
    : [];
  const me = await getMyRecord(ctx);
  const enterprises = (me?.enterprises ?? []).map((e) => ({ id: e.id, workRaw: e.workRaw }));

  return (
    <>
      <div className="mehead">
        <h1>Sell tickets</h1>
        <p>Run an event company, tour operator, or transport company on Esoqo.</p>
      </div>

      {orgs.length > 0 && (
        <div className="mcard" style={{ marginBottom: 16 }}>
          <h2><Icon name="building" size={18} />Your organisers</h2>
          {orgs.map((org) => (
            <div className="mrow" key={org.ID}>
              <span className="k">{org.Name}</span>
              <span className="v">
                {org.Vertical === 'TRANSPORT' ? 'Transport' : 'Events'} · {org.Status.toLowerCase()}
                {' — '}
                <Link href={`/org/ticket/${org.ID}`}>Open console</Link>
              </span>
            </div>
          ))}
        </div>
      )}

      <CreateOrgForm enterprises={enterprises} />
    </>
  );
}
