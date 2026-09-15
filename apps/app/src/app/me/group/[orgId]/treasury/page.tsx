import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import {
  getMyRecord, getGroupBalance, listContributions, listWithdrawals, getTreasuryPolicy,
} from '@esoqo/db';
import { requireSubject } from '@/lib/session';
import { ContributionForm } from './ContributionForm';
import { ContributionsList } from './ContributionsList';
import { WithdrawalRequestForm } from './WithdrawalRequestForm';
import { WithdrawalSignForm } from './WithdrawalSignForm';
import { PayJoinFeeForm } from './PayJoinFeeForm';
import { TreasuryPolicyForm } from './TreasuryPolicyForm';

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
        <header className="hero" style={{ padding: '4px 0 14px' }}>
          <p className="kicker">Group treasury</p>
          <h1>{m.org.officialName}</h1>
        </header>
        {policy.joinFeeKes ? (
          <PayJoinFeeForm orgId={orgId} joinFeeKes={policy.joinFeeKes} orgName={m.org.officialName} />
        ) : (
          <div className="mcard">
            <p style={{ margin: 0 }}>
              Your membership is pending — an officer needs to activate it. There is nothing for you
              to pay right now.
            </p>
          </div>
        )}
      </>
    );
  }

  const [balance, contributions, withdrawals] = await Promise.all([
    getGroupBalance(ctx, orgId),
    listContributions(ctx, orgId),
    listWithdrawals(ctx, orgId),
  ]);

  const open = withdrawals.filter((w) => w.status === 'PENDING_SIGNATURES');
  const settled = withdrawals.filter((w) => w.status !== 'PENDING_SIGNATURES');
  const signerIds = new Set(policy.signers.map((s) => s.personId));
  const iAmSigner = signerIds.size > 0 ? signerIds.has(ctx.partyId!) : isOfficer;

  const pendingContributions = contributions.filter((c) => c.status === 'DECLARED').length;

  return (
    <>
      <p style={{ margin: '0 0 10px' }}>
        <Link href={`/me/group/${orgId}` as Route} className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="arrow-left" size={14} />{m.org.officialName}
        </Link>
      </p>

      <header className="hero" style={{ padding: '4px 0 14px' }}>
        <p className="kicker">Group treasury</p>
        <h1>{m.org.officialName}</h1>
        <p className="lead">Contributions, and every withdrawal from the moment it is proposed.</p>
      </header>

      {/* Balance hero */}
      <section className="balance-hero">
        <span className="k">Currently held by the group</span>
        <span className="v">KES {balance.toLocaleString('en-KE')}</span>
        <span className="h">
          {policy.requiredSigners} {policy.requiredSigners === 1 ? 'signer' : 'signers'} to approve a
          withdrawal · {policy.withdrawalLeadMinutes} minutes of standby before it moves
        </span>
      </section>

      {/* Open withdrawals need eyes on them */}
      {open.length > 0 && (
        <section className="mcard">
          <h2><Icon name="clock" size={18} />Needs signatures ({open.length})</h2>
          {open.map((w) => {
            const signed = w.approveCount;
            const need = w.requiredSigners;
            const pct = Math.min(100, Math.round((signed / need) * 100));
            const iSigned = w.signatures.some((s) => s.signerId === ctx.partyId);
            return (
              <div key={w.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: '.95rem' }}>
                      KES {w.amountKes.toLocaleString('en-KE')} to {w.payeeName}
                    </p>
                    <p className="hint" style={{ margin: '2px 0 0' }}>{w.purpose}</p>
                    <p className="hint" style={{ margin: '2px 0 0' }}>
                      {signed} of {need} signed · earliest execution {w.standbyOpensAt.toLocaleString('en-KE')}
                    </p>
                  </div>
                  <span className="badge b-warn"><Icon name="clock" size={11} />Standby</span>
                </div>
                <div style={{ height: 6, background: 'var(--paper)', borderRadius: 99, margin: '10px 0 2px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`,
                    background: signed >= need ? 'var(--green)' : 'var(--amber)',
                    borderRadius: 99, transition: 'width .3s var(--ease-out)',
                  }} />
                </div>
                {iAmSigner && !iSigned && (
                  <WithdrawalSignForm
                    withdrawalId={w.id} amountKes={w.amountKes} purpose={w.purpose} payeeName={w.payeeName}
                  />
                )}
                {iSigned && (
                  <p style={{ margin: '8px 0 2px', fontSize: '.84rem', color: 'var(--green)' }}>
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
