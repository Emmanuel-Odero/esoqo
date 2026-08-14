'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Icon } from '@esoko/ui';
import { actionRequestPinCode, actionSetPin } from '../actions';

export function SetPinForm() {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
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
      if (!result.ok) { setError(result.error); return; }
      setDevCode(result.data.devCode ?? null);
      setStep('code');
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionSetPin({
        msisdn: msisdn.replace(/\s+/g, ''), code, pin, pinConfirm,
      });
      if (!result.ok) { setError(result.error); return; }
      router.push(result.data.next as Route);
      router.refresh();
    });
  }

  if (step === 'phone') {
    return (
      <>
        <div className="fld">
          <label className="lab" htmlFor="msisdn"><Icon name="phone" size={15} />Phone number</label>
          <input className="inp mono" id="msisdn" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} inputMode="tel" />
          <p className="hint">The number your Esoko account is registered under.</p>
        </div>
        {error && <div className="note n-red" style={{ marginBottom: 16 }}><div><p>{error}</p></div></div>}
        <button type="button" className="btn btn-g" style={{ width: '100%' }} disabled={pending || !msisdn.trim()} onClick={requestCode}>
          {pending ? 'Sending…' : 'Send code'} <Icon name="send" size={16} />
        </button>
      </>
    );
  }

  return (
    <>
      {devCode && (
        <div className="note n-amber" style={{ marginBottom: 16 }}>
          <div>
            <strong style={{ display: 'block', marginBottom: 4 }}>Dev mode — code shown here</strong>
            <p className="mono" style={{ fontSize: '1.1rem', margin: 0 }}>{devCode}</p>
          </div>
        </div>
      )}
      <div className="fld">
        <label className="lab" htmlFor="code"><Icon name="keypad" size={15} />Code</label>
        <input className="inp mono" id="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="pin"><Icon name="lock" size={15} />New PIN</label>
        <input className="inp mono" id="pin" type="password" value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={6} />
        <p className="hint">Four to six digits — avoid 1234, 0000 or anything predictable.</p>
      </div>
      <div className="fld">
        <label className="lab" htmlFor="pinc"><Icon name="lock" size={15} />Confirm PIN</label>
        <input className="inp mono" id="pinc" type="password" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value)} inputMode="numeric" maxLength={6} />
      </div>
      {error && <div className="note n-red" style={{ marginBottom: 16 }}><div><p>{error}</p></div></div>}
      <button
        type="button" className="btn btn-g" style={{ width: '100%' }}
        disabled={pending || !code.trim() || !pin.trim() || !pinConfirm.trim()}
        onClick={submit}
      >
        {pending ? 'Setting PIN…' : 'Set PIN & sign in'} <Icon name="check" size={16} />
      </button>
      <button type="button" className="btn btn-o" style={{ width: '100%', marginTop: 8 }} onClick={() => { setStep('phone'); setError(null); }}>
        Use a different number
      </button>
    </>
  );
}