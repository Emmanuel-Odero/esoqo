'use client';

import { useState, useTransition } from 'react';
import { COUNTIES } from '@esoqo/domain';
import { actionCheckApplicant, actionSubmitApplication } from './actions';

type Step = 'identifier' | 'matched' | 'new' | 'done';

/**
 * Apply for Our Jamii access — for a brand-new person and an existing
 * CECF member alike. The identifier step is what tells them apart: a
 * match short-circuits straight to a one-click confirmation instead of
 * the full form, since we already have their details on file. Either
 * way this only ever creates a JamiiInterest — access itself is granted
 * by staff review, see @esoqo/db's approveJamiiInterest.
 */
export function ApplyForm({ initialIdentifier = '' }: { initialIdentifier?: string }) {
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [msisdn, setMsisdn] = useState('+254 7');
  const [email, setEmail] = useState('');
  const [county, setCounty] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function checkIdentifier() {
    setError(null);
    start(async () => {
      const r = await actionCheckApplicant({ identifier });
      if (!r.ok) { setError(r.error); return; }
      if (r.data.matched) {
        setDisplayName(r.data.displayName ?? null);
        setStep('matched');
      } else {
        setStep('new');
      }
    });
  }

  function submitMatched() {
    setError(null);
    start(async () => {
      const r = await actionSubmitApplication({ identifier, message });
      if (!r.ok) { setError(r.error); return; }
      setStep('done');
    });
  }

  const identifierIsEmail = identifier.includes('@');

  function submitNew() {
    setError(null);
    start(async () => {
      const r = await actionSubmitApplication({
        identifier, fullName,
        msisdn: identifierIsEmail ? msisdn.replace(/\s+/g, '') : identifier,
        email: identifierIsEmail ? identifier : email,
        county, organisationName, message,
      });
      if (!r.ok) { setError(r.error); return; }
      setStep('done');
    });
  }

  if (step === 'done') {
    return (
      <div className="card" style={{ padding: 16, background: 'var(--ledger-lt)' }} role="status">
        <strong style={{ display: 'block', marginBottom: 6 }}>Application received</strong>
        <p style={{ margin: 0, fontSize: '.9rem' }}>
          A CECF or Esoqo team member will review it. Once approved, come back and{' '}
          <a href="/signin/set-pin" style={{ color: 'var(--stamp)', fontWeight: 700 }}>set your PIN</a>{' '}
          to sign in.
        </p>
      </div>
    );
  }

  if (step === 'matched') {
    return (
      <>
        <div className="card" style={{ padding: 14, marginBottom: 16, background: 'var(--ledger-lt)' }}>
          <strong style={{ display: 'block', marginBottom: 4, fontSize: '.9rem' }}>
            We already have your details{displayName ? `, ${displayName}` : ''}
          </strong>
          <p style={{ margin: 0, fontSize: '.85rem' }}>
            No need to fill anything else in — submit your application and we&rsquo;ll review it.
          </p>
        </div>
        <div className="field">
          <label htmlFor="ap-msg">
            Anything you&rsquo;d like us to know <span className="hint" style={{ display: 'inline' }}>— optional</span>
          </label>
          <textarea id="ap-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 16 }}>{error}</p>}
        <button type="button" className="btn btn-stamp btn-block" disabled={pending} onClick={submitMatched}>
          {pending ? 'Submitting…' : 'Submit application'}
        </button>
        <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 8 }}
          onClick={() => { setStep('identifier'); setError(null); }}>
          Use a different number or email
        </button>
      </>
    );
  }

  if (step === 'new') {
    return (
      <>
        <div className="card" style={{ padding: 14, marginBottom: 16, background: 'var(--ledger-lt)' }}>
          <p style={{ margin: 0, fontSize: '.85rem' }}>
            We couldn&rsquo;t find <span className="mono">{identifier}</span> on file — tell us a bit
            about you and we&rsquo;ll review your application.
          </p>
        </div>
        <div className="field">
          <label htmlFor="ap-name">Your name</label>
          <input id="ap-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        {identifierIsEmail ? (
          <div className="field">
            <label htmlFor="ap-phone">Phone number</label>
            <input id="ap-phone" className="mono" value={msisdn} inputMode="tel"
              onChange={(e) => setMsisdn(e.target.value)} placeholder="+254 7…" />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="ap-email">Email <span className="hint" style={{ display: 'inline' }}>— optional</span></label>
            <input id="ap-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="ap-county">County</label>
          <select id="ap-county" value={county} onChange={(e) => setCounty(e.target.value)}>
            <option value="">Choose a county</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ap-org">Group or organisation <span className="hint" style={{ display: 'inline' }}>— optional</span></label>
          <input id="ap-org" value={organisationName} onChange={(e) => setOrganisationName(e.target.value)}
            placeholder="Tumaini Women's Group" />
        </div>
        <div className="field">
          <label htmlFor="ap-msg">Anything else <span className="hint" style={{ display: 'inline' }}>— optional</span></label>
          <textarea id="ap-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 16 }}>{error}</p>}
        <button type="button" className="btn btn-stamp btn-block"
          disabled={pending || !fullName.trim() || !county || (identifierIsEmail && !msisdn.trim())}
          onClick={submitNew}>
          {pending ? 'Submitting…' : 'Submit application'}
        </button>
        <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 8 }}
          onClick={() => { setStep('identifier'); setError(null); }}>
          Use a different number or email
        </button>
      </>
    );
  }

  return (
    <>
      <div className="field">
        <label htmlFor="ap-id">Phone number or email</label>
        <input id="ap-id" value={identifier} autoComplete="username"
          onChange={(e) => setIdentifier(e.target.value)} placeholder="+254 7… or you@example.com" />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 16 }}>{error}</p>}
      <button type="button" className="btn btn-stamp btn-block" disabled={pending || !identifier.trim()}
        onClick={checkIdentifier}>
        {pending ? 'Checking…' : 'Continue'}
      </button>
    </>
  );
}
