'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionCreateTicketOrg } from './actions';

interface EnterpriseOption { id: string; workRaw: string }

export function CreateOrgForm({ enterprises }: { enterprises: EnterpriseOption[] }) {
  const [enterpriseId, setEnterpriseId] = useState(enterprises[0]?.id ?? '');
  const [name, setName] = useState('');
  const [vertical, setVertical] = useState<'EVENTS' | 'TRANSPORT'>('EVENTS');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();
  const router = useRouter();

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateTicketOrg({ enterpriseId, name, vertical });
      if (r.ok) {
        announce('Organiser created.', 'polite');
        router.push(`/org/ticket/${r.data.orgId}`);
      } else {
        setError(r.error);
        announce(r.error, 'assertive');
      }
    });
  }

  if (enterprises.length === 0) {
    return (
      <div className="note n-amber">
        <div>
          <p>
            You need a registered business before you can open a ticketing organiser — the same
            business record a shop uses. Add one from your Record tab first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mcard">
      <h2><Icon name="calendar" size={18} />Open a ticketing organiser</h2>
      <p style={{ color: 'var(--tx-2)', fontSize: '.9rem', margin: '0 0 14px' }}>
        For an event company, tour operator, or a bus/matatu SACCO. You become its admin — you can
        add managers and gate scanners once it's open.
      </p>
      <div className="fld">
        <label className="lab" htmlFor="org-ent">Which of your businesses?</label>
        <select className="inp" id="org-ent" value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}>
          {enterprises.map((e) => <option key={e.id} value={e.id}>{e.workRaw}</option>)}
        </select>
      </div>
      <div className="fld">
        <label className="lab" htmlFor="org-name">Organiser name</label>
        <input className="inp" id="org-name" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sauti Events Co, Modern Coast SACCO" />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="org-vert">What do you sell tickets for?</label>
        <select className="inp" id="org-vert" value={vertical} onChange={(e) => setVertical(e.target.value as 'EVENTS' | 'TRANSPORT')}>
          <option value="EVENTS">Events — concerts, conferences, matches</option>
          <option value="TRANSPORT">Transport — bus, coach, matatu, tours</option>
        </select>
      </div>
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={15} />{error}</p>}
      <button type="button" className="btn btn-p" disabled={pending || !name.trim()} onClick={submit}>
        {pending ? 'Creating…' : 'Open organiser'}
      </button>
    </div>
  );
}
