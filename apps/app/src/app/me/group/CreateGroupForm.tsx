'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTIES } from '@esoqo/domain';
import { Icon, SelectWithOther, isSelectWithOtherComplete } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionCreateOwnGroup } from './actions';

export function CreateGroupForm({ kindOptions }: { kindOptions: readonly (readonly [string, string])[] }) {
  const [orgKind, setOrgKind] = useState<string>('CHAMA');
  const [orgKindOther, setOrgKindOther] = useState('');
  const [officialName, setOfficialName] = useState('');
  const [county, setCounty] = useState<string>(COUNTIES[0]);
  const [memberCount, setMemberCount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();
  const router = useRouter();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateOwnGroup({
        orgKind,
        orgKindOther: orgKind === 'OTHER' ? orgKindOther : undefined,
        officialName,
        county,
        memberCount: memberCount ? Number(memberCount) : undefined,
      });
      if (r.ok) {
        announce('Group created. You are its chairperson.', 'polite');
        router.push('/me/group');
        router.refresh();
      } else {
        setError(r.error);
        announce(r.error, 'assertive');
      }
    });
  }

  return (
    <div className="mcard">
      <h2><Icon name="users" size={18} />Start a group</h2>
      <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
        For a chama, table-banking circle, SACCO or similar. You become its chairperson and first
        signer — its contribution account and multisig withdrawals are ready immediately, no
        separate setup.
      </p>
      <SelectWithOther
        id="grp-kind" label="What kind of group?" options={kindOptions}
        value={orgKind} onChange={setOrgKind}
        customValue={orgKindOther} onCustomChange={setOrgKindOther}
        customLabel="What kind, exactly?" customPlaceholder="e.g. Youth football club"
      />
      <div className="fld">
        <label className="lab" htmlFor="grp-name">Group name</label>
        <input className="inp" id="grp-name" value={officialName} onChange={(e) => setOfficialName(e.target.value)}
          placeholder="e.g. Tumaini Women's Group" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="grp-county">County</label>
        <select className="inp" id="grp-county" value={county} onChange={(e) => setCounty(e.target.value)}>
          {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="fld">
        <label className="lab" htmlFor="grp-members">How many members? (optional)</label>
        <input className="inp" id="grp-members" inputMode="numeric" value={memberCount}
          onChange={(e) => setMemberCount(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 12" />
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <button
        type="button" className="btn btn-p"
        disabled={pending || !officialName.trim() || !isSelectWithOtherComplete(orgKind, orgKindOther)}
        onClick={submit}
      >
        {pending ? 'Creating…' : 'Create group'}
      </button>
    </div>
  );
}
