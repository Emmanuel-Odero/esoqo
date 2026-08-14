'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { actionRequestPinCode, actionSetPin } from '../actions';
import { JamiiInterestForm } from './JamiiInterestForm';

export function SetPinForm() {
  const [step, setStep] = useState<'phone' | 'code' | 'not-member'>('phone');
  const [msisdn, setMsisdn] = useState('+254 7');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function requestCode() {
    setError(null);
    startTransition(async () => {
      const result = await actionRequestPinCode({ msisdn: msisdn.replace(/\s+/g, '') });
      if (!result.ok) {
        if (result.notMember) { setStep('not-member'); return; }
        setError(result.error);
        return;
      }
      setDevCode(result.data.devCode ?? null);
      setStep('code');
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionSetPin({ msisdn: msisdn.replace(/\s+/g, ''), code, pin, pinConfirm });
      if (!result.ok) { setError(result.error); return; }
      router.push(result.data.next as Route);
      router.refresh();
    });
  }

  if (step === 'phone') {
    return (
      <>
        <div className="field">
          <label htmlFor="msisdn">Phone number</label>
          <input id="msisdn" className="mono" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} inputMode="tel" />
          <div className="hint">The number your Esoko account is registered under.</div>
        </div>
        {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 16 }}>{error}</p>}
        <button type="button" className="btn btn-stamp btn-block" disabled={pending || !msisdn.trim()} onClick={requestCode}>
          {pending ? 'Sending…' : 'Send code'}
        </button>
      </>
    );
  }

  if (step === 'not-member') {
    return (
      <>
        <JamiiInterestForm msisdn={msisdn.replace(/\s+/g, '')} />
        <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 8 }}
          onClick={() => { setStep('phone'); setError(null); }}>
          Use a different number
        </button>
      </>
    );
  }

  return (
    <>
      {devCode && (
        <div className="card" style={{ padding: 14, marginBottom: 16, background: 'var(--ledger-lt)' }}>
          <strong style={{ display: 'block', marginBottom: 4, fontSize: '.8rem' }}>Dev mode — code shown here</strong>
          <p className="mono" style={{ fontSize: '1.1rem', margin: 0 }}>{devCode}</p>
        </div>
      )}
      <div className="field">
        <label htmlFor="code">Code</label>
        <input id="code" className="mono" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
      </div>
      <div className="field">
        <label htmlFor="pin">New PIN</label>
        <input id="pin" className="mono" type="password" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={6} />
        <div className="hint">Four to six digits — avoid 1234, 0000 or anything predictable.</div>
      </div>
      <div className="field">
        <label htmlFor="pinc">Confirm PIN</label>
        <input id="pinc" className="mono" type="password" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value)} inputMode="numeric" maxLength={6} />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 16 }}>{error}</p>}
      <button type="button" className="btn btn-stamp btn-block" disabled={pending || !code.trim() || !pin.trim() || !pinConfirm.trim()} onClick={submit}>
        {pending ? 'Setting PIN…' : 'Set PIN & sign in'}
      </button>
      <button type="button" className="btn btn-outline btn-block" style={{ marginTop: 8 }} onClick={() => { setStep('phone'); setError(null); }}>
        Use a different number
      </button>
    </>
  );
}
