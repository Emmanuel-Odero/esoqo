'use client';

import { useState, useTransition } from 'react';
import { COUNTIES } from '@esoko/domain';
import { actionSubmitJamiiInterest } from '../actions';

/**
 * Shown in place of the OTP step when actionRequestPinCode comes back
 * `notMember: true` — Our Jamii is CECF-members-only (see the DAL
 * comment on createJamiiInterest), so rather than a dead end this
 * collects enough for Esoko staff to follow up, and shows up in the
 * admin app's "Our Jamii" > Interest queue.
 */
export function JamiiInterestForm({ msisdn }: { msisdn: string }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [county, setCounty] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionSubmitJamiiInterest({
        fullName, msisdn, email, county, organisationName, message,
      });
      if (!result.ok) { setError(result.error); return; }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="card" style={{ padding: 16, background: 'var(--ledger-lt)' }} role="status">
        <strong style={{ display: 'block', marginBottom: 6 }}>Thanks — we&rsquo;ve got it</strong>
        <p style={{ margin: 0, fontSize: '.9rem' }}>
          A CECF or Esoko team member will follow up on <span className="mono">{msisdn}</span>.
          Once you&rsquo;re a member you can come back here and set your PIN.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card" style={{ padding: 14, marginBottom: 16, background: 'var(--ledger-lt)' }}>
        <strong style={{ display: 'block', marginBottom: 4, fontSize: '.9rem' }}>Our Jamii is for CECF members</strong>
        <p style={{ margin: 0, fontSize: '.85rem' }}>
          We couldn&rsquo;t find <span className="mono">{msisdn}</span>{' '}as a CECF member, so we can&rsquo;t
          set up an account yet. Leave your details below and we&rsquo;ll follow up — or join CECF first,
          then come back.
        </p>
      </div>

      <div className="field">
        <label htmlFor="int-name">Your name</label>
        <input id="int-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="int-email">Email <span className="hint" style={{ display: 'inline' }}>— optional</span></label>
        <input id="int-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="int-county">County <span className="hint" style={{ display: 'inline' }}>— optional</span></label>
        <select id="int-county" value={county} onChange={(e) => setCounty(e.target.value)}>
          <option value="">Choose a county</option>
          {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="int-org">Group or organisation <span className="hint" style={{ display: 'inline' }}>— optional</span></label>
        <input id="int-org" value={organisationName} onChange={(e) => setOrganisationName(e.target.value)}
          placeholder="Tumaini Women's Group" />
      </div>
      <div className="field">
        <label htmlFor="int-msg">Anything else <span className="hint" style={{ display: 'inline' }}>— optional</span></label>
        <textarea id="int-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>

      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 16 }}>{error}</p>}
      <button type="button" className="btn btn-stamp btn-block" disabled={pending || !fullName.trim()} onClick={submit}>
        {pending ? 'Sending…' : 'Submit my interest'}
      </button>
    </>
  );
}
