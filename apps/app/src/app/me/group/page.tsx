import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoko/ui';
import { getMyRecord, GROUP_KINDS } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { CreateGroupForm } from './CreateGroupForm';

// GROUP_KINDS includes BUSINESS (admin's Groups screen registers those
// too) — self-serve founding here is for chamas/table-banking/SACCOs
// etc. only, the same set createOwnGroupSchema accepts
// (JOINABLE_GROUP_KINDS). Resolved server-side so the client form never
// imports @esoko/db (server-only) itself.
const GROUP_KIND_OPTIONS = GROUP_KINDS.filter(([k]) => k !== 'BUSINESS');

export const dynamic = 'force-dynamic';

/**
 * Directory only — each group's own detail lives at /me/group/[orgId]
 * (and its treasury at /me/group/[orgId]/treasury), so this page never
 * has to load one group's balance, members and withdrawals just to let
 * someone pick which group they meant. A person can belong to more than
 * one (see createOwnGroup in dal/groups.ts), which is the whole reason
 * this needs to be a list rather than always jumping straight to one.
 */
export default async function MyGroups() {
  const ctx = await requireSubject();
  const me = await getMyRecord(ctx);
  const memberships = me?.memberships ?? [];

  return (
    <>
      <header className="hero" style={{ padding: '4px 0 14px' }}>
        <p className="kicker">Group</p>
        <h1>Your groups</h1>
      </header>

      {memberships.length === 0 ? (
        <div className="mcard" style={{ marginBottom: 16 }}>
          <div className="mempty">
            <span className="ico"><Icon name="users" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>You are not in a group on Esoko</h2>
            <p style={{ margin: 0 }}>
              If your chama is already here, its treasurer can add you. Dial *483*77# and choose 4
              to ask. Otherwise, start one below.
            </p>
          </div>
        </div>
      ) : (
        <section className="mcard" style={{ marginBottom: 16 }}>
          {memberships.map((m) => (
            <Link key={m.orgId} href={`/me/group/${m.orgId}` as Route} className="mrow" style={{ textDecoration: 'none' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="v" style={{ display: 'block' }}>
                  {m.org.knownAs || m.org.officialName}
                  {m.status === 'PENDING' && <span className="badge b-warn" style={{ marginLeft: 8 }}>Pending</span>}
                </span>
                <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                  {m.role === 'OTHER' ? (m.customRole || 'Other') : m.role.toLowerCase()} · {m.org.party.county}
                </span>
              </span>
              <Icon name="chevron-right" size={16} />
            </Link>
          ))}
        </section>
      )}

      <CreateGroupForm kindOptions={GROUP_KIND_OPTIONS} />
    </>
  );
}
