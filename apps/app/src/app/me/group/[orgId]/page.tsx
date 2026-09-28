import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import {
  getMyRecord, listMyGroupMembers, getTreasuryPolicy, listGroupActivity, listProposals, listGroupProjects,
} from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { MembersPanel, type MemberRow } from './MembersPanel';
import { ProposalsPanel, type ProposalRow } from './ProposalsPanel';
import { ProjectsPanel, type ProjectRow } from './ProjectsPanel';

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
    const policy = await getTreasuryPolicy(ctx, orgId);
    return (
      <>
        <p style={{ margin: '0 0 10px' }}>
          <Link href="/me/group" className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="arrow-left" size={14} />Your groups
          </Link>
        </p>
        <div className="group-hero" style={{ marginBottom: 16 }}>
          <span className="group-hero-ic" aria-hidden="true"><Icon name="lock" size={22} /></span>
          <div className="group-hero-copy">
            <p className="kicker" style={{ margin: 0 }}>Pending membership</p>
            <h1>{org.officialName}</h1>
            <p className="lead">You&apos;ve been invited — a join fee activates your membership.</p>
          </div>
        </div>
        <div className="mcard mcard--premium">
          <div className="mempty" style={{ padding: '6px 0 0' }}>
            <span className="ico" style={{ background: 'var(--amber-t)', color: 'var(--amber)', border: '1px solid #E8D2A0' }}><Icon name="lock" size={22} /></span>
            <h2 style={{ marginBottom: 7 }}>Almost in</h2>
            <p style={{ margin: '0 auto', maxWidth: 520, lineHeight: 1.5 }}>
              {org.officialName} is a savings group — members pay in on a schedule and the group
              holds the money together, released only when enough signers approve. You have been
              invited, but this group charges a join fee before your membership activates.
            </p>
          </div>
          {policy.contributionAmountKes && (
            <div className="mrow" style={{ marginTop: 8 }}>
              <span className="k">Once you&apos;re in, expect to pay</span>
              <span className="v mono">
                KES {policy.contributionAmountKes.toLocaleString('en-KE')}
                {policy.contributionCycle ? ` / ${policy.contributionCycle.toLowerCase()}` : ''}
              </span>
            </div>
          )}
          <Link href={`/me/group/${orgId}/treasury` as Route} className="btn btn-p" style={{ marginTop: 16 }}>
            Pay the join fee <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      </>
    );
  }

  const [memberRows, policy, activity, proposalRows, projectRows] = await Promise.all([
    listMyGroupMembers(ctx, orgId),
    getTreasuryPolicy(ctx, orgId),
    listGroupActivity(ctx, orgId, 12),
    listProposals(ctx, orgId, 10),
    listGroupProjects(ctx, orgId),
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

  const signerIds = new Set(policy.signers.map((s) => s.personId));
  const iAmSigner = signerIds.size > 0 ? signerIds.has(ctx.partyId!) : isOfficer;
  const removableMembers = members
    .filter((mm) => mm.status === 'ACTIVE' && mm.personId !== ctx.partyId)
    .map((mm) => ({ personId: mm.personId, name: mm.name }));
  const proposals: ProposalRow[] = proposalRows.map((p) => ({
    id: p.id,
    kind: p.kind,
    status: p.status,
    targetName: p.kind === 'ADD_MEMBER'
      ? (p.targetName ?? 'someone')
      : (p.targetPerson?.person?.knownAs || p.targetPerson?.person?.officialName || 'a member'),
    requiredApprovals: p.requiredApprovals,
    approvals: p.votes.filter((v) => v.decision === 'APPROVE').length,
    rejections: p.votes.filter((v) => v.decision === 'REJECT').length,
    proposedByName: p.proposedBy.person?.knownAs || p.proposedBy.person?.officialName || 'a signatory',
    iVoted: p.votes.some((v) => v.voterId === ctx.partyId),
  }));
  const projects: ProjectRow[] = projectRows.map((p) => ({
    id: p.id,
    title: p.title,
    purpose: p.purpose,
    status: p.status,
    targetKes: p.targetKes ? Number(p.targetKes) : null,
    raisedKes: p.raisedKes,
    requiredApprovals: p.requiredApprovals,
    signerNames: p.signers.map((s) => s.person.person?.knownAs || s.person.person?.officialName || 'Member'),
    iAmSigner: p.signers.some((s) => s.personId === ctx.partyId),
    pendingContributions: p.pendingContributions.map((c) => ({
      id: c.id,
      contributorName: c.contributor.person?.knownAs || c.contributor.person?.officialName || 'a member',
      amountKes: Number(c.amountKes),
    })),
    pendingWithdrawals: p.pendingWithdrawals.map((w) => ({
      id: w.id,
      payeeName: w.payeeName,
      purpose: w.purpose,
      amountKes: Number(w.amountKes),
      approvals: w.approvals,
      requiredApprovals: w.requiredApprovals,
      iVoted: w.votes.some((v) => v.voterId === ctx.partyId),
    })),
  }));

  const monogram = (org.officialName.trim().charAt(0).toUpperCase() || 'G');
  return (
    <>
      <p style={{ margin: '0 0 10px' }}>
        <Link href="/me/group" className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.86rem' }}>
          <Icon name="arrow-left" size={14} />Your groups
        </Link>
      </p>

      <div className="group-hero">
        <span className="group-hero-ic" aria-hidden="true">{monogram}</span>
        <div className="group-hero-copy" style={{ flex: 1, minWidth: 0 }}>
          <p className="kicker" style={{ margin: 0, color: 'var(--green)' }}>Your group · Roster &amp; governance</p>
          <h1 style={{ overflowWrap: 'anywhere' }}>{org.officialName}</h1>
          <p className="lead">{org.knownAs && `Known as ${org.knownAs} · `}{org.party.county} · {org._count.members} members</p>
          <div className="group-hero-meta">
            <span className="badge b-ok"><Icon name="users" size={11} />{m.role === 'OTHER' ? (m.customRole || 'Other') : m.role.toLowerCase()}</span>
            {org?.registrationNo ? <span className="badge b-ok"><Icon name="check" size={11} />{org.registrationNo}</span> : <span className="badge b-warn">Not registered yet</span>}
            {policy.contributionAmountKes && <span className="badge b-mute">KES {policy.contributionAmountKes.toLocaleString('en-KE')}{policy.contributionCycle ? ` / ${policy.contributionCycle.toLowerCase()}` : ''}</span>}
          </div>
        </div>
      </div>

      <div className="premium-stats" aria-label="At a glance">
        <Link className="pstat" href={`/me/group/${orgId}/treasury` as Route} style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <span className="pstat-k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="bank" size={12} /> Treasury</span>
          <span className="pstat-v">Open vault</span>
          <span className="pstat-h">Balance, contributions, withdrawals →</span>
        </Link>
        <div className="pstat">
          <span className="pstat-k"><Icon name="users" size={12} /> Members</span>
          <span className="pstat-v">{org._count.members}</span>
          <span className="pstat-h">Including you · {members.filter((mm) => mm.status === 'PENDING').length ? `${members.filter((mm) => mm.status === 'PENDING').length} pending` : 'All active'}</span>
        </div>
        <div className="pstat">
          <span className="pstat-k"><Icon name="clock" size={12} /> Activity</span>
          <span className="pstat-v">{activity.length}</span>
          <span className="pstat-h">Recent events</span>
        </div>
      </div>

      <section className="mcard mcard--premium">
        <h2><Icon name="users" size={18} />Your membership</h2>
        <div className="mrow"><span className="k">Your role</span>
          <span className="v">{m.role === 'OTHER' ? (m.customRole || 'Other') : m.role.toLowerCase()}</span></div>
        <div className="mrow"><span className="k">You joined</span>
          <span className="v">{m.joinedAt.toLocaleDateString('en-KE')}</span></div>
        <div className="mrow"><span className="k">Standing</span>
          <span className="v">
            {org?.registrationNo
              ? <span className="badge b-ok"><Icon name="check" size={11} />Registered {org.registrationNo}</span>
              : <span className="badge b-warn">Registration pending</span>}
          </span></div>
        {policy.contributionAmountKes && (
          <div className="mrow"><span className="k">Expected contribution</span>
            <span className="v mono">
              KES {policy.contributionAmountKes.toLocaleString('en-KE')}
              {policy.contributionCycle ? ` / ${policy.contributionCycle.toLowerCase()}` : ''}
            </span></div>
        )}
        <p className="hint" style={{ margin: '12px 0 0', fontSize: '.80rem' }}>Money is not shown here — open Treasury for the audited balance. This page owns membership and roster.</p>
      </section>

      {activity.length > 0 && (
        <section className="mcard" aria-label="Recent activity">
          <h2><Icon name="clock" size={18} />Recent activity</h2>
          <p className="mcard-lede" style={{ marginBottom: 10 }}>Every contribution, withdrawal and member change — newest first.</p>
          <ul className="papers">
            {activity.map((a) => (
              <li className="paper" key={a.id}>
                <span className={`ps ${a.kind.startsWith('WITHDRAWAL') ? 'soon' : 'ok'}`} aria-hidden="true">
                  <Icon name={a.kind === 'WITHDRAWAL_EXECUTED' ? 'coins' : a.kind.startsWith('WITHDRAWAL') ? 'bank' : 'users'} size={16} />
                </span>
                <span className="pt">
                  <span className="t">{a.summary}</span>
                  <span className="s">{a.createdAt.toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ProjectsPanel orgId={orgId} projects={projects} members={removableMembers} isOfficer={isOfficer} />

      <ProposalsPanel orgId={orgId} proposals={proposals} iAmSigner={iAmSigner} members={removableMembers} />

      <MembersPanel orgId={orgId} isOfficer={isOfficer} members={members} />

      <section className="mcard" style={{ background: 'var(--paper)', borderStyle: 'dashed' }}>
        <h2><Icon name="keypad" size={18} />USSD — works on any handset</h2>
        <p style={{ color: 'var(--tx-2)', fontSize: '.92rem', margin: 0, lineHeight: 1.5 }}>
          Dial <strong className="mono" style={{ color: 'var(--navy)', background: '#fff', padding: '2px 6px', borderRadius: 6, border: '1px solid var(--line)' }}>*483*77#</strong> → <strong>4</strong> to see the
          group balance, pay a contribution, vote on a request, or check who has not paid. No internet needed.
        </p>
      </section>
    </>
  );
}
