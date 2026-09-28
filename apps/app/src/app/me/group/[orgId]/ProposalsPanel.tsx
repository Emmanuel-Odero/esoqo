'use client';
import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionCreateProposal, actionCastProposalVote } from '../actions';

export interface ProposalRow {
  id: string;
  kind: 'ADD_MEMBER' | 'REMOVE_MEMBER';
  status: 'OPEN' | 'PASSED' | 'REJECTED';
  targetName: string;
  requiredApprovals: number;
  approvals: number;
  rejections: number;
  proposedByName: string;
  iVoted: boolean;
}

export interface RemovableMember { personId: string; name: string }

/**
 * "Vote on proposed decisions eg add/remove a member" — a signatory
 * proposes, other signatories vote, and it executes itself the moment
 * enough votes land either way. Same requiredApprovals a withdrawal
 * needs, so "enough of us said yes" means one thing across the group.
 */
export function ProposalsPanel({ orgId, proposals, iAmSigner, members }: {
  orgId: string; proposals: ProposalRow[]; iAmSigner: boolean; members: RemovableMember[];
}) {
  const [showNew, setShowNew] = useState(false);
  const open = proposals.filter((p) => p.status === 'OPEN');
  const decided = proposals.filter((p) => p.status !== 'OPEN').slice(0, 5);

  if (!iAmSigner && proposals.length === 0) return null;

  return (
    <section className="mcard">
      <h2><Icon name="scales" size={18} />Proposals</h2>
      <p className="mcard-lede">Adding or removing a member goes to a vote among your group&rsquo;s signatories.</p>

      {open.length === 0 && decided.length === 0 && <p className="hint">No proposals yet.</p>}

      {open.map((p) => <ProposalItem key={p.id} p={p} canVote={iAmSigner} />)}
      {decided.map((p) => <ProposalItem key={p.id} p={p} canVote={false} />)}

      {iAmSigner && (
        showNew
          ? <NewProposalForm orgId={orgId} members={members} onDone={() => setShowNew(false)} />
          : (
            <button type="button" className="btn btn-o" style={{ marginTop: 12 }} onClick={() => setShowNew(true)}>
              <Icon name="plus" size={15} />Propose a change
            </button>
          )
      )}
    </section>
  );
}

function ProposalItem({ p, canVote }: { p: ProposalRow; canVote: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const announce = useAnnounce();

  function vote(decision: 'APPROVE' | 'REJECT') {
    setMsg(null);
    start(async () => {
      const r = await actionCastProposalVote(p.id, decision);
      if (!r.ok) { setMsg(r.error); announce(r.error, 'assertive'); return; }
      const text = r.data.status === 'PASSED' ? 'Passed.' : r.data.status === 'REJECTED' ? 'Voted down.' : 'Vote recorded.';
      announce(text, 'polite');
    });
  }

  const statusBadge = p.status === 'PASSED'
    ? <span className="badge b-ok"><Icon name="check" size={11} />Passed</span>
    : p.status === 'REJECTED'
      ? <span className="badge b-bad">Voted down</span>
      : <span className="badge b-warn">{p.approvals}/{p.requiredApprovals} votes</span>;

  return (
    <div className="paper" style={{ flexWrap: 'wrap' }}>
      <span className="ps ok" aria-hidden="true"><Icon name={p.kind === 'ADD_MEMBER' ? 'user' : 'close'} size={16} /></span>
      <span className="pt">
        <span className="t">{p.kind === 'ADD_MEMBER' ? `Add ${p.targetName}` : `Remove ${p.targetName}`}</span>
        <span className="s">Proposed by {p.proposedByName}</span>
        {msg && <span className="s" style={{ color: 'var(--red)' }}>{msg}</span>}
      </span>
      {statusBadge}
      {canVote && p.status === 'OPEN' && !p.iVoted && (
        <div className="row">
          <button type="button" className="btn btn-p btn-sm" disabled={pending} onClick={() => vote('APPROVE')}>Approve</button>
          <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={() => vote('REJECT')}>Reject</button>
        </div>
      )}
      {canVote && p.status === 'OPEN' && p.iVoted && <span className="hint">You&rsquo;ve voted</span>}
    </div>
  );
}

function NewProposalForm({ orgId, members, onDone }: { orgId: string; members: RemovableMember[]; onDone: () => void }) {
  const [kind, setKind] = useState<'ADD_MEMBER' | 'REMOVE_MEMBER'>('ADD_MEMBER');
  const [targetPersonId, setTargetPersonId] = useState(members[0]?.personId ?? '');
  const [msisdn, setMsisdn] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateProposal(
        kind === 'ADD_MEMBER'
          ? { orgId, kind, targetMsisdn: msisdn, targetName: name }
          : { orgId, kind, targetPersonId },
      );
      if (r.ok) { announce('Proposal created.', 'polite'); onDone(); }
      else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div className="mcard" style={{ marginTop: 14, background: 'var(--paper)' }}>
      <h2 style={{ fontSize: '.95rem' }}>New proposal</h2>
      <div className="fld"><label className="lab">What</label>
        <select className="inp" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="ADD_MEMBER">Add a member</option>
          <option value="REMOVE_MEMBER">Remove a member</option>
        </select>
      </div>
      {kind === 'ADD_MEMBER' ? (
        <>
          <div className="fld"><label className="lab">Their name</label>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Wanjiru" /></div>
          <div className="fld"><label className="lab">Their phone</label>
            <input className="inp" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="07XX XXX XXX" /></div>
        </>
      ) : (
        <div className="fld"><label className="lab">Who</label>
          <select className="inp" value={targetPersonId} onChange={(e) => setTargetPersonId(e.target.value)}>
            {members.map((m) => <option key={m.personId} value={m.personId}>{m.name}</option>)}
          </select>
        </div>
      )}
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <div className="row">
        <button
          type="button" className="btn btn-p btn-sm" disabled={pending || (kind === 'ADD_MEMBER' ? !name.trim() || !msisdn.trim() : !targetPersonId)}
          onClick={submit}
        >
          {pending ? 'Creating…' : 'Create proposal'}
        </button>
        <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
