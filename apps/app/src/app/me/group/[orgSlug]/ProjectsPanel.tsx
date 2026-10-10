'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import {
  actionCreateProject, actionDeclareProjectContribution, actionConfirmProjectContribution,
  actionRequestProjectWithdrawal, actionVoteProjectWithdrawal,
} from '../actions';

export interface PendingContribution { id: string; contributorName: string; amountKes: number }
export interface PendingWithdrawal {
  id: string; payeeName: string; purpose: string; amountKes: number; approvals: number; requiredApprovals: number; iVoted: boolean;
}

export interface ProjectRow {
  id: string; title: string; purpose: string | null; status: 'ACTIVE' | 'CLOSED';
  targetKes: number | null; raisedKes: number; requiredApprovals: number;
  signerNames: string[]; iAmSigner: boolean;
  pendingContributions: PendingContribution[];
  pendingWithdrawals: PendingWithdrawal[];
}
export interface MemberOption { personId: string; name: string }

export function ProjectsPanel({ orgId, projects, members, isOfficer }: {
  orgId: string; projects: ProjectRow[]; members: MemberOption[]; isOfficer: boolean;
}) {
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="mcard">
      <h2><Icon name="star" size={18} />Projects</h2>
      <p className="mcard-lede">
        A named kitty for a one-off cost — a funeral, a wedding gift, a school fee push — funded and
        signed off separately from the group&rsquo;s everyday treasury.
      </p>

      {projects.length === 0 && !showNew && <p className="hint">No projects yet.</p>}

      <ul className="papers">
        {projects.map((p) => {
          const pct = p.targetKes ? Math.min(100, Math.round((p.raisedKes / p.targetKes) * 100)) : null;
          return (
            <li className="paper" key={p.id} style={{ flexWrap: 'wrap' }}>
              <span className="ps ok" aria-hidden="true"><Icon name="star" size={16} /></span>
              <span className="pt">
                <span className="t">{p.title}{p.status === 'CLOSED' && ' · Closed'}</span>
                <span className="s">
                  KES {p.raisedKes.toLocaleString('en-KE')}{p.targetKes ? ` of ${p.targetKes.toLocaleString('en-KE')}` : ' raised'}
                  {' · '}Signed off by {p.signerNames.join(', ')}
                </span>
                {pct !== null && (
                  <span style={{ display: 'block', height: 6, background: 'var(--line)', borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--green)' }} />
                  </span>
                )}
              </span>
              <button type="button" className="btn btn-o btn-sm" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                {openId === p.id ? 'Close' : 'Open'}
              </button>
              {openId === p.id && (
                <ProjectDetail orgId={orgId} project={p} isOfficer={isOfficer} />
              )}
            </li>
          );
        })}
      </ul>

      {showNew
        ? <NewProjectForm orgId={orgId} members={members} onDone={() => setShowNew(false)} />
        : (
          <button type="button" className="btn btn-o" style={{ marginTop: 12 }} onClick={() => setShowNew(true)}>
            <Icon name="plus" size={15} />Start a project
          </button>
        )}
    </section>
  );
}

function ProjectDetail({ project, isOfficer }: { orgId: string; project: ProjectRow; isOfficer: boolean }) {
  const [amount, setAmount] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [mode, setMode] = useState<'contribute' | 'withdraw'>('contribute');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function contribute() {
    setMsg(null);
    start(async () => {
      const r = await actionDeclareProjectContribution(project.id, Number(amount));
      const text = r.ok ? 'Declared — an officer confirms it.' : r.error;
      setMsg(text);
      announce(text, r.ok ? 'polite' : 'assertive');
      if (r.ok) setAmount('');
    });
  }

  function requestWithdrawal() {
    setMsg(null);
    start(async () => {
      const r = await actionRequestProjectWithdrawal(project.id, Number(amount), purpose, payeeName);
      const text = r.ok ? 'Requested — waiting on this project’s signatories.' : r.error;
      setMsg(text);
      announce(text, r.ok ? 'polite' : 'assertive');
      if (r.ok) { setAmount(''); setPurpose(''); setPayeeName(''); }
    });
  }

  return (
    <div style={{ flexBasis: '100%', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" className={`btn btn-sm ${mode === 'contribute' ? 'btn-p' : 'btn-o'}`} onClick={() => setMode('contribute')}>Contribute</button>
        {project.iAmSigner && (
          <button type="button" className={`btn btn-sm ${mode === 'withdraw' ? 'btn-p' : 'btn-o'}`} onClick={() => setMode('withdraw')}>Withdraw</button>
        )}
      </div>
      <div className="fld"><label className="lab" htmlFor={`proj-${project.id}-amount`}>Amount (KES)</label>
        <input id={`proj-${project.id}-amount`} className="inp" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
      {mode === 'withdraw' && (
        <>
          <div className="fld"><label className="lab" htmlFor={`proj-${project.id}-payee`}>Who is being paid</label>
            <input id={`proj-${project.id}-payee`} className="inp" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} /></div>
          <div className="fld"><label className="lab" htmlFor={`proj-${project.id}-purpose`}>What for</label>
            <input id={`proj-${project.id}-purpose`} className="inp" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
        </>
      )}
      {msg && <p style={{ fontSize: '.85rem', color: 'var(--tx-2)' }}>{msg}</p>}
      <button
        type="button" className="btn btn-p btn-sm" disabled={pending || !amount}
        onClick={mode === 'contribute' ? contribute : requestWithdrawal}
      >
        {mode === 'contribute' ? 'Declare contribution' : 'Request withdrawal'}
      </button>
      {isOfficer && project.pendingContributions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <strong style={{ fontSize: '.85rem' }}>Waiting to confirm</strong>
          {project.pendingContributions.map((c) => <PendingContributionRow key={c.id} contribution={c} />)}
        </div>
      )}
      {project.iAmSigner && project.pendingWithdrawals.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <strong style={{ fontSize: '.85rem' }}>Needs your vote</strong>
          {project.pendingWithdrawals.map((w) => <PendingWithdrawalRow key={w.id} withdrawal={w} />)}
        </div>
      )}
    </div>
  );
}

function PendingContributionRow({ contribution }: { contribution: PendingContribution }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const announce = useAnnounce();
  return (
    <div className="row" style={{ marginTop: 6, alignItems: 'center' }}>
      <span style={{ fontSize: '.85rem', flex: 1 }}>
        KES {contribution.amountKes.toLocaleString('en-KE')} from {contribution.contributorName}
      </span>
      <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => start(async () => {
        const r = await actionConfirmProjectContribution(contribution.id);
        const text = r.ok ? 'Confirmed.' : r.error;
        setMsg(text); announce(text, r.ok ? 'polite' : 'assertive');
      })}>
        Confirm
      </button>
      {msg && <span style={{ fontSize: '.8rem', color: 'var(--tx-2)' }}>{msg}</span>}
    </div>
  );
}

function PendingWithdrawalRow({ withdrawal }: { withdrawal: PendingWithdrawal }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const announce = useAnnounce();
  function vote(decision: 'APPROVE' | 'REJECT') {
    start(async () => {
      const r = await actionVoteProjectWithdrawal(withdrawal.id, decision);
      const text = r.ok ? (r.data.status === 'EXECUTED' ? 'Paid out.' : r.data.status === 'REJECTED' ? 'Voted down.' : 'Vote recorded.') : r.error;
      setMsg(text); announce(text, r.ok ? 'polite' : 'assertive');
    });
  }
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: '.85rem' }}>
        KES {withdrawal.amountKes.toLocaleString('en-KE')} to {withdrawal.payeeName} for {withdrawal.purpose}
        {' · '}{withdrawal.approvals}/{withdrawal.requiredApprovals} votes
      </div>
      {withdrawal.iVoted ? (
        <span className="hint">You&rsquo;ve voted</span>
      ) : (
        <div className="row" style={{ marginTop: 4 }}>
          <button type="button" className="btn btn-p btn-sm" disabled={pending} onClick={() => vote('APPROVE')}>Approve</button>
          <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => vote('REJECT')}>Reject</button>
        </div>
      )}
      {msg && <span style={{ fontSize: '.8rem', color: 'var(--tx-2)' }}>{msg}</span>}
    </div>
  );
}

function NewProjectForm({ orgId, members, onDone }: { orgId: string; members: MemberOption[]; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [targetKes, setTargetKes] = useState('');
  const [signerIds, setSignerIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function toggle(id: string) {
    setSignerIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateProject(orgId, title, purpose || undefined, targetKes ? Number(targetKes) : undefined, signerIds);
      if (r.ok) { announce('Project started.', 'polite'); onDone(); }
      else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="mcard" style={{ marginTop: 14, background: 'var(--paper)' }}>
      <h2 style={{ fontSize: '.95rem' }}>New project</h2>
      <div className="fld"><label className="lab" htmlFor="newproj-name">Name</label>
        <input id="newproj-name" className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Grace's funeral" /></div>
      <div className="fld"><label className="lab" htmlFor="newproj-purpose">Purpose (optional)</label>
        <input id="newproj-purpose" className="inp" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
      <div className="fld"><label className="lab" htmlFor="newproj-target">Target (KES, optional)</label>
        <input id="newproj-target" className="inp" value={targetKes} onChange={(e) => setTargetKes(e.target.value)} inputMode="decimal" /></div>
      <div className="fld"><div className="lab">Other signatories for this project</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {members.map((m) => (
            <label key={m.personId} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '.88rem' }}>
              <input type="checkbox" checked={signerIds.includes(m.personId)} onChange={() => toggle(m.personId)} />
              {m.name}
            </label>
          ))}
        </div>
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <div className="row">
        <button type="button" className="btn btn-p btn-sm" disabled={pending || !title.trim()} onClick={submit}>
          {pending ? 'Starting…' : 'Start project'}
        </button>
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
