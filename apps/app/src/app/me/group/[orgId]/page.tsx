import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { getMyRecord, getGroupBalance, listMyGroupMembers } from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { MembersPanel, type MemberRow } from './MembersPanel';

const OFFICER_ROLES = new Set(['CHAIRPERSON', 'TREASURER', 'SECRETARY']);

export const dynamic = 'force-dynamic';

export default async function GroupDetail({ params }: { params: Promise<{ orgId: string }> }) {
  const ctx = await requireSubject();
  const { orgId } = await params;
  const me = await getMyRecord(ctx);
  const m = me?.memberships.find((x) => x.orgId === orgId);
  if (!m) notFound();

  const org = m.org;
  const isOfficer = OFFICER_ROLES.has(m.role);

  if (m.status === 'PENDING') {
    return (
      <>
        <header className="hero" style={{ padding: '4px 0 14px' }}>
          <p className="kicker">Group</p>
          <h1>{org.officialName}</h1>
        </header>
        <div className="mcard">
          <div className="mempty">
            <span className="ico"><Icon name="lock" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>Almost in</h2>
            <p style={{ margin: 0 }}>
              You have been invited to {org.officialName}, but this group charges a join fee. Pay it
              from the treasury page and an officer will confirm it.
            </p>
          </div>
          <Link href={`/me/group/${orgId}/treasury` as Route} className="btn btn-p" style={{ marginTop: 14 }}>
            Go to treasury <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      </>
    );
  }

  const [balance, memberRows] = await Promise.all([
    getGroupBalance(ctx, orgId),
    listMyGroupMembers(ctx, orgId),
  ]);

  const members: MemberRow[] = memberRows.map((r) => ({
    membershipId: r.id,
    personId: r.personId,
    name: r.person.person?.knownAs || r.person.person?.officialName || 'Member',
    msisdn: r.person.person?.msisdn ?? null,
    role: r.role,
    customRole: r.customRole,
    status: r.status,
    isMe: r.personId === ctx.partyId,
  }));

  return (
    <>
      <p style={{ margin: '0 0 10px' }}>
        <Link href="/me/group" className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="arrow-left" size={14} />Your groups
        </Link>
      </p>

      <header className="hero" style={{ padding: '4px 0 14px' }}>
        <p className="kicker">Your group</p>
        <h1>{org.officialName}</h1>
        <p className="lead">{org.knownAs && `Known as ${org.knownAs} · `}{org.party.county}</p>
      </header>

      <div className="stat-grid" aria-label="At a glance">
        <Link className="tile" href={`/me/group/${orgId}/treasury` as Route}>
          <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="bank" size={17} />
          </span>
          <span className="tile-k">Group balance</span>
          <span className="tile-v mono">KES {balance.toLocaleString('en-KE')}</span>
          <span className="tile-h">Open treasury</span>
        </Link>
        <div className="tile">
          <span className="icbox" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
            <Icon name="users" size={17} />
          </span>
          <span className="tile-k">Members</span>
          <span className="tile-v">{org._count.members}</span>
          <span className="tile-h">Including you</span>
        </div>
      </div>

      <section className="mcard">
        <h2><Icon name="users" size={18} />Your membership</h2>
        <div className="mrow"><span className="k">Your role</span>
          <span className="v">{m.role === 'OTHER' ? (m.customRole || 'Other') : m.role.toLowerCase()}</span></div>
        <div className="mrow"><span className="k">You joined</span>
          <span className="v">{m.joinedAt.toLocaleDateString('en-KE')}</span></div>
        <div className="mrow"><span className="k">Registered</span>
          <span className="v">
            {org?.registrationNo
              ? <span className="badge b-ok"><Icon name="check" size={11} />{org.registrationNo}</span>
              : <span className="badge b-warn">Not registered yet</span>}
          </span></div>
      </section>

      <MembersPanel orgId={orgId} isOfficer={isOfficer} members={members} />

      <section className="mcard">
        <h2><Icon name="keypad" size={18} />What you can do by dialling</h2>
        <p style={{ color: 'var(--tx-2)', fontSize: '.92rem', margin: 0 }}>
          Dial <strong className="mono">*483*77#</strong> and choose <strong>4</strong> to see the
          group balance, pay a contribution, vote on a loan, or check who has not paid. It works
          from any handset, including one without internet.
        </p>
      </section>
    </>
  );
}
