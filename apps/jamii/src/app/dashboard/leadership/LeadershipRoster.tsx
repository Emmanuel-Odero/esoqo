'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberRole } from '@esoqo/db';
import { actionSetMemberRole } from '../actions';

const ROLE_LABEL: Record<MemberRole, string> = {
  CHAIRPERSON: 'Chairperson', TREASURER: 'Treasurer', SECRETARY: 'Secretary',
  MEMBER: 'Member', OTHER: 'Other',
};

interface MemberRow {
  id: string;
  role: MemberRole;
  customRole: string | null;
  person: { person: { knownAs: string | null; officialName: string | null } | null };
}

function RosterRow({ member }: { member: MemberRow }) {
  const [role, setRole] = useState<MemberRole>(member.role);
  const [customRole, setCustomRole] = useState(member.customRole ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const p = member.person.person;
  const name = p?.knownAs || p?.officialName || 'Member';
  const dirty = role !== member.role || customRole !== (member.customRole ?? '');

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await actionSetMemberRole({
        membershipId: member.id, role, customRole: role === 'OTHER' ? customRole : undefined,
      });
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <tr>
      <td style={{ fontWeight: 700 }}>{name}</td>
      <td>
        <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
          {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
      </td>
      <td>
        {role === 'OTHER' && (
          <input
            value={customRole} onChange={(e) => setCustomRole(e.target.value)}
            placeholder="e.g. Youth rep" style={{ width: '100%' }}
          />
        )}
      </td>
      <td>
        <button type="button" className="btn btn-outline btn-sm" disabled={!dirty || pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {error && <div style={{ color: 'var(--stamp)', fontSize: '.78rem', marginTop: 4 }}>{error}</div>}
      </td>
    </tr>
  );
}

export function LeadershipRoster({ members }: { members: MemberRow[] }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <table className="dtable">
        <thead><tr><th>Name</th><th>Role</th><th>Custom title (if Other)</th><th /></tr></thead>
        <tbody>
          {members.length === 0 ? (
            <tr><td colSpan={4} style={{ color: '#8a8368' }}>No members yet.</td></tr>
          ) : members.map((m) => <RosterRow key={m.id} member={m} />)}
        </tbody>
      </table>
    </div>
  );
}
