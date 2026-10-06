import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import {
  getMyRecord, getGroupBalance, listContributions, listWithdrawals, getTreasuryPolicy,
  listGroupSigners, listMyGroupMembers,
} from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { orgSlug, idSuffixFromSlug } from '@/lib/groupSlug';
import { ContributionForm } from './ContributionForm';
import { ContributionsList } from './ContributionsList';
import { WithdrawalRequestForm } from './WithdrawalRequestForm';
import { WithdrawalSignForm } from './WithdrawalSignForm';
import { PayJoinFeeForm } from './PayJoinFeeForm';
import { TreasuryPolicyForm } from './TreasuryPolicyForm';
import { SignatoriesPanel } from './SignatoriesPanel';

export const dynamic = 'force-dynamic';

const OFFICER_ROLES = new Set(['CHAIRPERSON', 'TREASURER', 'SECRETARY']);

export default async function GroupTreasury({ params }: { params: Promise<{ orgSlug: string }> }) {
  const ctx = await requireSubject();
  const { orgSlug: slugParam } = await params;
  const me = await getMyRecord(ctx);
  const suffix = idSuffixFromSlug(slugParam);
  const m = (suffix ? me?.memberships.find((x) => x.orgId.startsWith(suffix)) : undefined)
    ?? me?.memberships.find((x) => x.orgId === slugParam);
  if (!m) notFound();

  const orgId = m.orgId;
  const canonicalSlug = orgSlug(m.org.officialName, orgId);
  if (slugParam !== canonicalSlug) redirect(`/me/group/${canonicalSlug}/treasury` as Route);
  const isOfficer = OFFICER_ROLES.has(m.role);

  // getTreasuryPolicy only needs assertMember (PENDING or ACTIVE), so a
  // PENDING member can see what they owe before they've paid it.
  const policy = await getTreasuryPolicy(ctx, orgId);

  if (m.status === 'PENDING') {
    return (
      <>
        <p style={{ margin: '0 0 10px' }}>
          <Link href={`/me/group/${canonicalSlug}` as Route} className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="arrow-left" size={14} />{m.org.officialName}
          </Link>
        </p>
        <div className="group-hero">
          <span className="group-hero-ic" aria-hidden="true"><Icon name="bank" size={20} /></span>
          <div className="group-hero-copy">
            <p className="kicker" style={{ margin: 0 }}>Group treasury</p>
            <h1>{m.org.officialName}</h1>
            <p className="lead">Join fee required to activate membership.</p>
          </div>
        </div>
        {policy.joinFeeKes ? (
          <PayJoinFeeForm orgId={orgId} joinFeeKes={policy.joinFeeKes} orgName={m.org.officialName} />
        ) : (
          <div className="mcard mcard--premium">
            <p style={{ margin: 0, color: 'var(--tx-2)' }}>
              Your membership is pending — an officer needs to activate it. There is nothing for you
              to pay right now.
            </p>
          </div>
        )}
      </>
    );
  }

  const [balance, contributions, withdrawals, signers, members] = await Promise.all([
    getGroupBalance(ctx, orgId),
    listContributions(ctx, orgId),
    listWithdrawals(ctx, orgId),
    listGroupSigners(ctx, orgId),
    listMyGroupMembers(ctx, orgId),
  ]);

  const open = withdrawals.filter((w) => w.status === 'PENDING_SIGNATURES');
  const settled = withdrawals.filter((w) => w.status !== 'PENDING_SIGNATURES');
  const signerIds = new Set(policy.signers.map((s) => s.personId));
  const iAmSigner = signerIds.size > 0 ? signerIds.has(ctx.partyId!) : isOfficer;

  const mySignerRow = signers.find((s) => s.personId === ctx.partyId);
  const canManageSignatories = isOfficer || Boolean(mySignerRow?.manageSignatories);
  const signerRows = signers.map((s) => ({
    personId: s.personId,
    name: s.person.person?.knownAs || s.person.person?.officialName || 'Member',
    approveWithdrawals: s.approveWithdrawals,
    addMembers: s.addMembers,
    removeMembers: s.removeMembers,
    manageSignatories: s.manageSignatories,
    editTreasurySettings: s.editTreasurySettings,
    notifyOnContributions: s.notifyOnContributions,
    notifyOnWithdrawals: s.notifyOnWithdrawals,
  }));
  const signerPersonIds = new Set(signers.map((s) => s.personId));
  const nonSignerMembers = members
    .filter((m) => m.status === 'ACTIVE' && !signerPersonIds.has(m.personId))
    .map((m) => ({ personId: m.personId, name: m.person.person?.knownAs || m.person.person?.officialName || 'Member' }));
  const officerFallback = signers.length === 0
    ? members.filter((m) => OFFICER_ROLES.has(m.role)).map((m) => m.person.person?.knownAs || m.person.person?.officialName || 'an officer')
    : [];

  const pendingContributions = contributions.filter((c) => c.status === 'DECLARED').length;

  const monogram = m.org.officialName.trim().charAt(0).toUpperCase() || 'G';
  return (
    <>
      <p style={{ margin: '0 0 10px' }}>
        <Link href={`/me/group/${canonicalSlug}` as Route} className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="arrow-left" size={14} />{m.org.officialName} · group
        </Link>
      </p>

      <div className="group-hero" style={{ marginBottom: 14 }}>
        <span className="group-hero-ic" aria-hidden="true">{monogram}</span>
        <div className="group-hero-copy" style={{ flex: 1, minWidth: 0 }}>
          <p className="kicker" style={{ margin: 0, color: 'var(--green)' }}>Group balance</p>
          <h1 style={{ overflowWrap: 'anywhere' }}>{m.org.officialName}</h1>
          <p className="lead">Every payment in and every payment out, in one place.</p>
        </div>
      </div>

      {/* Dark for shared money — plain layout, one column, so the most
          important number (the balance) and the most urgent job (sign
          off on a pending payout) are never more than a scroll away. */}
      <section className="balance-hero balance-hero--dark" aria-label="Group balance">
        <span className="k">The group has</span>
        <span className="v mono">KES {balance.toLocaleString('en-KE')}</span>
        <span className="h">Added up from every payment in and out.</span>
        <div className="balance-meta">
          <span><Icon name="keypad" size={12} />{policy.requiredSigners} must approve a payout</span>
          <span><Icon name="clock" size={12} />{policy.withdrawalLeadMinutes} min wait before it pays out</span>
          <span><Icon name="users" size={12} />{members.length} members</span>
        </div>
      </section>

      <div className="me-grid">
        <div className="me-main">
          {/* Open withdrawals — the one job that's actually urgent, so
              it leads the main column no matter what else is below. */}
          {open.length > 0 && (
            <section className="mcard" style={{ borderColor: '#E8D2A0', background: '#FFFCF5' }}>
              <h2><Icon name="clock" size={18} />Needs approval <span className="badge b-warn" style={{ marginLeft: 8 }}>{open.length}</span></h2>
              <p className="mcard-lede" style={{ marginBottom: 12 }}>These payments are waiting to be approved. One &ldquo;no&rdquo; stops it.</p>
              {open.map((w) => {
                const signed = w.approveCount;
                const need = w.requiredSigners;
                const pct = Math.min(100, Math.round((signed / need) * 100));
                const iSigned = w.signatures.some((s) => s.signerId === ctx.partyId);
                return (
                  <div key={w.id} className="withdrawal-card withdrawal-card--urgent">
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontWeight: 750, fontSize: '.98rem', color: 'var(--navy)' }}>
                          KES {w.amountKes.toLocaleString('en-KE')} <span style={{ fontWeight: 500, color: 'var(--tx-2)' }}>→ {w.payeeName}</span>
                        </p>
                        <p className="hint" style={{ margin: '4px 0 0', color: 'var(--tx)' }}>{w.purpose}</p>
                        <p className="hint" style={{ margin: '4px 0 0' }}>
                          {signed} of {need} approved · pays out from {w.standbyOpensAt.toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                      <span className="badge b-warn"><Icon name="clock" size={11} />Waiting</span>
                    </div>
                    <div className="withdrawal-progress" aria-label={`${signed} of ${need} approvals`}>
                      <span style={{
                        width: `${pct}%`,
                        background: signed >= need ? 'var(--green)' : 'var(--amber)',
                      }} />
                    </div>
                    {iAmSigner && !iSigned && (
                      <WithdrawalSignForm
                        withdrawalId={w.id} amountKes={w.amountKes} purpose={w.purpose} payeeName={w.payeeName}
                      />
                    )}
                    {iSigned && (
                      <p style={{ margin: '10px 0 2px', fontSize: '.84rem', color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon name="check" size={14} /> You&rsquo;ve approved this.
                      </p>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {isOfficer && <WithdrawalRequestForm orgId={orgId} leadMinutes={policy.withdrawalLeadMinutes} />}

          {settled.length > 0 && (
            <section className="mcard">
              <h2><Icon name="document" size={18} />Past payments out</h2>
              {settled.map((w) => (
                <div className="mrow" key={w.id}>
                  <span style={{ flex: 1 }}>
                    <span className="v" style={{ display: 'block' }}>KES {w.amountKes.toLocaleString('en-KE')} to {w.payeeName}</span>
                    <span className="hint" style={{ margin: '3px 0 0', display: 'block' }}>{w.purpose}</span>
                  </span>
                  <span className={`badge ${w.status === 'EXECUTED' ? 'b-ok' : w.status === 'REJECTED' ? 'b-bad' : 'b-mute'}`}>
                    {w.status.toLowerCase().replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </section>
          )}

          {policy.contributionsEnabled && <ContributionForm orgId={orgId} />}

          <section className="mcard">
            <h2><Icon name="coins" size={18} />Payments in{isOfficer && pendingContributions > 0 ? (
              <span className="badge b-warn" style={{ marginLeft: 8 }}>{pendingContributions} to confirm</span>
            ) : null}</h2>
            {!policy.contributionsEnabled && (
              <p className="hint" style={{ marginBottom: 12 }}>This group is not currently taking payments in.</p>
            )}
            <ContributionsList
              isOfficer={isOfficer}
              rows={contributions.map((c) => ({
                id: c.id,
                amountKes: Number(c.amountKes),
                status: c.status,
                contributorName: c.contributor.person?.knownAs || c.contributor.person?.officialName || 'Member',
                isMine: c.contributorId === ctx.partyId,
                declaredAt: c.declaredAt.toISOString(),
                reference: c.reference,
              }))}
            />
          </section>

          <SignatoriesPanel
            orgId={orgId} signers={signerRows} nonSigners={nonSignerMembers}
            canManage={canManageSignatories} officerFallback={officerFallback}
          />

          {isOfficer && (
            <TreasuryPolicyForm
              orgId={orgId}
              contributionsEnabled={policy.contributionsEnabled}
              contributionAmountKes={policy.contributionAmountKes}
              contributionCycle={policy.contributionCycle}
              joinFeeKes={policy.joinFeeKes}
            />
          )}
        </div>

        <aside className="me-aside" aria-label="At a glance">
          <section className="desk-card">
            <h3><Icon name="grid" size={14} />At a glance</h3>
            <div className="desk-kpi">
              <div className="desk-kpi-row">
                <span className="icbox" style={{ background: open.length ? 'var(--amber-t)' : 'var(--green-t)', color: open.length ? 'var(--amber)' : 'var(--green)' }}><Icon name="clock" size={14} /></span>
                <span className="desk-kpi-t"><strong>Needs approval</strong><small>{open.length ? 'Waiting on you or others' : 'All clear'}</small></span>
                <span className="desk-kpi-v">{open.length}</span>
              </div>
              <div className="desk-kpi-row">
                <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}><Icon name="coins" size={14} /></span>
                <span className="desk-kpi-t"><strong>Payments in</strong><small>{pendingContributions ? `${pendingContributions} to confirm` : 'All confirmed'}</small></span>
                <span className="desk-kpi-v">{contributions.length}</span>
              </div>
              <div className="desk-kpi-row">
                <span className="icbox" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}><Icon name="document" size={14} /></span>
                <span className="desk-kpi-t"><strong>Payments out</strong><small>Settled</small></span>
                <span className="desk-kpi-v">{settled.length}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
