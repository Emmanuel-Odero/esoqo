'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actionInviteTeamMember, actionRemoveTeamMember } from '../actions';

type Member = {
  id: string; inviteName: string; inviteEmail: string; role: 'ADMIN' | 'EDITOR' | 'CONTRIBUTOR'; acceptedAt: Date | null;
};

export function TeamPanel({ pageId, members }: { pageId: string; members: Member[] }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'EDITOR' | 'CONTRIBUTOR'>('EDITOR');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function invite() {
    setError(null);
    startTransition(async () => {
      const result = await actionInviteTeamMember(pageId, { name, email, role });
      if (!result.ok) { setError(result.error); return; }
      setName(''); setEmail(''); setRole('EDITOR');
      router.refresh();
    });
  }

  function remove(memberId: string) {
    startTransition(async () => {
      await actionRemoveTeamMember(pageId, memberId);
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640 }}>
      {members.map((m) => (
        <div key={m.id} className="teammember">
          <span className="tm-avatar" aria-hidden="true">{m.inviteName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
          <div className="tm-info">
            <b>{m.inviteName}</b>
            <span>{m.inviteEmail}{!m.acceptedAt && ' · Pending'}</span>
          </div>
          <span className={`role-pill role-${m.role}`}>{m.role[0]}{m.role.slice(1).toLowerCase()}</span>
          <button type="button" onClick={() => remove(m.id)} style={{ background: 'none', border: 0, color: 'var(--stamp)', fontSize: '.78rem', fontWeight: 700, cursor: 'pointer', marginLeft: 10 }}>
            Remove
          </button>
        </div>
      ))}

      <div style={{ borderTop: '1.5px dashed var(--paper-line)', marginTop: 14, paddingTop: 18 }}>
        <h4 style={{ fontSize: '.85rem', color: 'var(--ink)', marginBottom: 12 }}>Invite a team member</h4>
        <div className="formrow2">
          <div className="field"><label htmlFor="tname">Name</label><input id="tname" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="temail">Email</label><input id="temail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="trole">Role</label>
          <select id="trole" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="ADMIN">Admin</option>
            <option value="EDITOR">Editor</option>
            <option value="CONTRIBUTOR">Contributor</option>
          </select>
        </div>
        {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 10 }}>{error}</p>}
        <button type="button" className="btn btn-outline btn-sm" disabled={pending || !name.trim() || !email.trim()} onClick={invite}>
          + Send invite
        </button>
      </div>
    </div>
  );
}
