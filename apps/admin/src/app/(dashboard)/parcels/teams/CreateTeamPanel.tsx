'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { actionCreateCourierTeam } from '../actions';
import { RoleField } from './RoleField';

const FIELD: React.CSSProperties = { display: 'block', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, marginTop: 2 };

/**
 * Stands a new team up in one step — name plus its first member,
 * almost always the manager. Adding more members and fleets happens
 * on the team's own detail page afterwards (see [id]/page.tsx) rather
 * than trying to collect everything in one form.
 */
export function CreateTeamPanel() {
  const [open, setOpen] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerMsisdn, setManagerMsisdn] = useState('');
  const [managerRole, setManagerRole] = useState('MANAGER');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    if (!teamName.trim() || !managerName.trim() || !managerMsisdn.trim()) {
      setError('Team name and the manager’s name and phone number are all required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await actionCreateCourierTeam({
        name: teamName.trim(),
        manager: { name: managerName.trim(), msisdn: managerMsisdn.trim(), role: managerRole || 'MANAGER' },
      });
      if (!result.ok) { setError(result.error); return; }
      router.push(`/parcels/teams/${result.teamId}` as Route);
    });
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <button className="btn btn-p btn-sm" onClick={() => setOpen((v) => !v)}>
        {open ? 'Close' : 'Add courier team'}
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
          <label className="sub">Team name
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Westlands night team"
              style={{ ...FIELD, width: '100%' }} />
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <label className="sub" style={{ flex: 1 }}>Manager name
              <input value={managerName} onChange={(e) => setManagerName(e.target.value)} style={{ ...FIELD, width: '100%' }} />
            </label>
            <label className="sub" style={{ flex: 1 }}>Manager phone
              <input value={managerMsisdn} onChange={(e) => setManagerMsisdn(e.target.value)} placeholder="07XX XXX XXX"
                style={{ ...FIELD, width: '100%' }} />
            </label>
          </div>
          <RoleField value={managerRole} onChange={setManagerRole} label="Manager's title" />
          <p className="sub" style={{ margin: 0 }}>
            The manager gets a text with their Esoqo ID the moment this is saved — that&apos;s also
            your confirmation the phone number is right.
          </p>
          <div>
            <button className="btn btn-p btn-sm" onClick={submit} disabled={pending}>
              {pending ? 'Creating…' : 'Create team'}
            </button>
          </div>
          {error && (
            <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
