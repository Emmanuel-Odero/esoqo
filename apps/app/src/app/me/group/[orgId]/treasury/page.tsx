import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import {
  getMyRecord, getGroupBalance, listContributions, listWithdrawals, getTreasuryPolicy,
  listGroupSigners, listMyGroupMembers,
} from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { ContributionForm } from './ContributionForm';
import { ContributionsList } from './ContributionsList';
import { WithdrawalRequestForm } from './WithdrawalRequestForm';
import { WithdrawalSignForm } from './WithdrawalSignForm';
import { PayJoinFeeForm } from './PayJoinFeeForm';
import { TreasuryPolicyForm } from './TreasuryPolicyForm';
import { SignatoriesPanel } from './SignatoriesPanel';

export const dynamic = 'force-dynamic';

const OFFICER_ROLES = new Set(['CHAIRPERSON', 'TREASURER', 'SECRETARY']);

export default async function GroupTreasury({ params }: { params: Promise<{ orgId: string }> }) {
  const ctx = await requireSubject();
  const { orgId } = await params;
  const me = await getMyRecord(ctx);
  const m = me?.memberships.find((x) => x.orgId === orgId);
  if (!m) notFound();

  const isOfficer = OFFICER_ROLES.has(m.role);

  // getTreasuryPolicy only needs assertMember (PENDING or ACTIVE), so a
  // PENDING member can see what they owe before they've paid it.
  const policy = await getTreasuryPolicy(ctx, orgId);

  if (m.status === 'PENDING') {
    return (
      <>
        <p style={{ margin: '0 0 10px' }}>
          <Link href={`/me/group/${orgId}` as Route} className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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
        <Link href={`/me/group/${orgId}` as Route} className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="arrow-left" size={14} />{m.org.officialName} · group
        </Link>
      </p>

      <div className="group-hero" style={{ marginBottom: 14 }}>
        <span className="group-hero-ic" aria-hidden="true">{monogram}</span>
        <div className="group-hero-copy" style={{ flex: 1, minWidth: 0 }}>
          <p className="kicker" style={{ margin: 0, color: 'var(--green)' }}>Group treasury · The vault</p>
          <h1 style={{ overflowWrap: 'anywhere' }}>{m.org.officialName}</h1>
          <p className="lead">Every contribution and every withdrawal, audited from proposal to execution.</p>
        </div>
      </div>

      {/* Premium vault — dark for shared money */}
      <section className="balance-hero balance-hero--dark" aria-label="Group vault balance">
        <span className="k">Held in the group vault</span>
        <span className="v mono">KES {balance.toLocaleString('en-KE')}</span>
        <span className="h">
          Audited balance — derived from every posting, never stored.
        </span>
        <div className="balance-meta">
          <span><Icon name="keypad" size={12} />{policy.requiredSigners} signer{policy.requiredSigners === 1 ? '' : 's'} to release</span>
          <span><Icon name="clock" size={12} />{policy.withdrawalLeadMinutes} min standby</span>
          <span><Icon name="users" size={12} />{members.length} members</span>
        </div>
      </section>

      <div className="premium-stats" aria-label="Treasury at a glance">
        <div className="pstat"><span className="pstat-k">Needs signatures</span><span className="pstat-v">{open.length}</span><span className="pstat-h">{open.length ? 'Requires action' : 'All clear'}</span></div>
        <div className="pstat"><span className="pstat-k">Contributions</span><span className="pstat-v">{contributions.length}</span><span className="pstat-h">{pendingContributions ? `${pendingContributions} to confirm` : 'Audited'}</span></div>
        <div className="pstat"><span className="pstat-k">Past withdrawals</span><span className="pstat-v">{settled.length}</span><span className="pstat-h">Settled &amp; logged</span></div>
      </div>

      {/* Open withdrawals — priority, premium cards */}
      {open.length > 0 && (
        <section className="mcard" style={{ borderColor: '#E8D2A0', background: 'linear-gradient(180deg,#FFFCF0 0%,#fff 70%)' }}>
          <h2><Icon name="clock" size={18} />Needs signatures <span className="badge b-warn" style={{ marginLeft: 8 }}>{open.length}</span></h2>
          <p className="mcard-lede" style={{ marginBottom: 12 }}>These are waiting on signers — one rejection stops execution. Sign promptly.</p>
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
                      {signed} of {need} signed · earliest {w.standbyOpensAt.toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className="badge b-warn"><Icon name="clock" size={11} />Standby</span>
                </div>
                <div className="withdrawal-progress" aria-label={`${signed} of ${need} signatures`}>
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
                    <Icon name="check" size={14} /> You have signed this.
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
          <h2><Icon name="document" size={18} />Past withdrawals</h2>
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
        <h2><Icon name="coins" size={18} />Contributions{isOfficer && pendingContributions > 0 ? (
          <span className="badge b-warn" style={{ marginLeft: 8 }}>{pendingContributions} to confirm</span>
        ) : null}</h2>
        {!policy.contributionsEnabled && (
          <p className="hint" style={{ marginBottom: 12 }}>This group is not currently taking contributions.</p>
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
    </>
  );
}
