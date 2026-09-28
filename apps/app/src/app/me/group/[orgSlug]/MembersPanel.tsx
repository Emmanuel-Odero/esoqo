'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, SelectWithOther, isSelectWithOtherComplete } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionInviteMember, actionSetMemberRole, actionRemoveMember } from '../actions';

export interface MemberRow {
  membershipId: string;
  personId: string;
  name: string;
  msisdn: string | null;
  role: string;
  customRole: string | null;
  status: string;
  isMe: boolean;
}

const ROLES = [
  ['CHAIRPERSON', 'Chairperson'], ['TREASURER', 'Treasurer'], ['SECRETARY', 'Secretary'],
  ['MEMBER', 'Member'], ['OTHER', 'Other'],
] as const;

function InviteForm({ orgId }: { orgId: string }) {
  const [channel, setChannel] = useState<'phone' | 'email'>('phone');
  const [msisdn, setMsisdn] = useState('');
  const [email, setEmail] = useState('');
  const [officialName, setOfficialName] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [customRole, setCustomRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  // Stripped of formatting, a real Kenyan number has at least 10 digits.
  // Counting digits — rather than just "is the field non-empty" — stops
  // an under-typed or untouched number from being submitted as "+2547".
  const dial = msisdn.replace(/\D/g, '');
  const contactReady = channel === 'phone' ? dial.length >= 10 : email.trim().length > 0;

  function submit() {
    setError(null); setDone(false);
    start(async () => {
      const r = await actionInviteMember({
        orgId,
        msisdn: channel === 'phone' ? dial : undefined,
        email: channel === 'email' ? email.trim() : undefined,
        officialName: officialName.trim() || undefined,
        role, customRole: role === 'OTHER' ? customRole : undefined,
      });
      if (r.ok) {
        setDone(true); setOfficialName(''); setMsisdn(''); setEmail(''); setRole('MEMBER'); setCustomRole('');
        announce('Invited.', 'polite');
      } else { setError(r.error); announce(r.error, 'assertive'); }
    });
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="fld">
        <label className="lab" htmlFor="inv-channel">Invite by</label>
        <select className="inp" id="inv-channel" value={channel} onChange={(e) => setChannel(e.target.value as 'phone' | 'email')}>
          <option value="phone">Phone number</option>
          <option value="email">Email address</option>
        </select>
      </div>
      {channel === 'phone' ? (
        <div className="fld">
          <label className="lab" htmlFor="inv-msisdn">Phone number</label>
          <input className="inp mono" id="inv-msisdn" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} inputMode="tel" placeholder="07XX XXX XXX" />
          <p className="hint">Country code included — at least 10 digits.</p>
        </div>
      ) : (
        <div className="fld">
          <label className="lab" htmlFor="inv-email">Email address</label>
          <input className="inp" id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
          <p className="hint">
            Esoqo accounts sign in with a phone number — they'll need one added before they can
            actually sign in. This just gets word to them in the meantime.
          </p>
        </div>
      )}
      <div className="fld">
        <label className="lab" htmlFor="inv-name">Name (only needed if they're new to Esoqo)</label>
        <input className="inp" id="inv-name" value={officialName} onChange={(e) => setOfficialName(e.target.value)} placeholder="Jane Wanjiru" />
      </div>
      <SelectWithOther
        id="inv-role" label="Role" options={ROLES} value={role} onChange={setRole}
        customValue={customRole} onCustomChange={setCustomRole} customLabel="What is this role called?"
      />
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      {done && !error && (
        <p style={{ color: 'var(--green)', fontSize: '.88rem', margin: '0 0 12px' }}>
          <Icon name="check" size={14} /> Invited — they&rsquo;ll get a text naming you and this group,
          with what to do next.
        </p>
      )}
      <button
        type="button" className="btn btn-o"
        disabled={pending || !contactReady || !isSelectWithOtherComplete(role, customRole)}
        onClick={submit}
      >
        {pending ? 'Inviting…' : 'Invite'}
      </button>
    </div>
  );
}

function MemberRowView({ row }: { row: MemberRow }) {
  const [role, setRole] = useState(row.role);
  const [customRole, setCustomRole] = useState(row.role === 'OTHER' ? (row.customRole ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();
  const router = useRouter();

  function saveRole(nextRole: string, nextCustomRole: string) {
    setError(null);
    start(async () => {
      const r = await actionSetMemberRole({
        membershipId: row.membershipId, role: nextRole,
        customRole: nextRole === 'OTHER' ? nextCustomRole : undefined,
      });
      if (!r.ok) { setError(r.error); setRole(row.role); announce(r.error, 'assertive'); }
      else { announce('Role updated.', 'polite'); router.refresh(); }
    });
  }

  function changeRole(next: string) {
    setRole(next);
    // OTHER needs the free-text field filled in first — see the Save
    // button that appears below instead of saving immediately.
    if (next !== 'OTHER') saveRole(next, '');
  }

  function remove() {
    setError(null);
    start(async () => {
      const r = await actionRemoveMember({ membershipId: row.membershipId, reason: 'Removed by an officer' });
      if (!r.ok) { setError(r.error); announce(r.error, 'assertive'); }
      else { announce('Removed.', 'polite'); router.refresh(); }
    });
  }

  return (
    <div className="mrow">
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="v" style={{ display: 'block' }}>
          {row.name}{row.isMe && ' (you)'}
          {row.status === 'PENDING' && <span className="badge b-warn" style={{ marginLeft: 8 }}>Pending join fee</span>}
        </span>
        {row.msisdn && <span className="hint mono" style={{ display: 'block', marginTop: 2 }}>{row.msisdn}</span>}
      </span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <SelectWithOther
          id={`role-${row.membershipId}`} bare options={ROLES} value={role} onChange={changeRole}
          customValue={customRole} onCustomChange={setCustomRole} disabled={pending}
          className="inp" customPlaceholder="What is this role called?"
        />
        {role === 'OTHER' && (
          <button
            type="button" className="btn btn-o"
            disabled={pending || !customRole.trim()}
            onClick={() => saveRole('OTHER', customRole)}
          >
            Save
          </button>
        )}
      </span>
      {!row.isMe && (
        <button type="button" className="btn btn-o" style={{ marginLeft: 8 }} disabled={pending} onClick={remove}>
          Remove
        </button>
      )}
      {error && <p className="err" role="alert" style={{ width: '100%', marginTop: 6 }}><Icon name="alert-circle" size={15} />{error}</p>}
    </div>
  );
}

export function MembersPanel({ orgId, isOfficer, members }: { orgId: string; isOfficer: boolean; members: MemberRow[] }) {
  return (
    <section className="mcard">
      <h2><Icon name="users" size={18} />Members ({members.length})</h2>
      {isOfficer && <InviteForm orgId={orgId} />}
      {members.map((m) => (
        isOfficer
          ? <MemberRowView key={m.membershipId} row={m} />
          : (
            <div className="mrow" key={m.membershipId}>
              <span style={{ flex: 1 }}>
                <span className="v">{m.name}{m.isMe && ' (you)'}</span>
              </span>
              <span className="hint">{m.role === 'OTHER' ? (m.customRole || 'Other') : m.role.toLowerCase()}</span>
            </div>
          )
      ))}
    </section>
  );
}
