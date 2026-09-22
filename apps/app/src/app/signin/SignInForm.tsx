'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { safeRedirect } from '@esoqo/domain';
import { actionSignIn } from './actions';

export function SignInForm() {
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const params = useSearchParams();

  function submit() {
    setError(null); setField(undefined);
    startTransition(async () => {
      const result = await actionSignIn({ identifier, pin });
      if (!result.ok) { setError(result.error); setField(result.field); return; }
      // safeRedirect confines this to in-app paths and origins we
      // publish. Without it, `next` is an arbitrary URL navigated to
      // immediately after a genuine PIN entry — the setup for a
      // convincing "confirm your PIN" page on an attacker's host.
      const next = safeRedirect(params.get('next') || result.data.next, window.location.origin);
      // `next` can point off this origin now that ticket booking
      // (apps/web:3000) sends buyers here to sign in and back —
      // router.push tries an RSC soft-navigation first, which the
      // browser's CORS policy blocks for a cross-origin URL. A full
      // navigation is what a cross-origin redirect needs anyway.
      if (/^https?:\/\//.test(next) && !next.startsWith(window.location.origin)) {
        window.location.href = next;
        return;
      }
      router.push(next as Route);
      router.refresh();
    });
  }

  return (
    <>
      <div className="fld">
        <label className="lab" htmlFor="id"><Icon name="user" size={15} />Phone number or email</label>
        <input
          className="inp" id="id" value={identifier} autoComplete="username"
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="07XX XXX XXX or you@example.com"
          aria-invalid={field === 'identifier'}
        />
      </div>
      <div className="fld">
        <label className="lab" htmlFor="pin"><Icon name="lock" size={15} />PIN</label>
        <input
          className="inp mono" id="pin" type="password" maxLength={6} inputMode="numeric"
          autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)}
          aria-invalid={field === 'pin'}
        />
        <p className="hint">Four to six digits. Esoqo will never ask you for this by call or SMS.</p>
      </div>

      {error && (
        <div className="note n-red" style={{ marginBottom: 16 }}>
          <div><p>{error}</p></div>
        </div>
      )}

      <button type="button" className="btn btn-p" style={{ width: '100%' }} disabled={pending || !identifier.trim() || !pin.trim()} onClick={submit}>
        {pending ? 'Signing in…' : 'Sign in'} <Icon name="arrow-right" size={16} />
      </button>

      <p style={{ textAlign: 'center', marginTop: 16, fontSize: '.86rem' }}>
        <Link href="/signin/set-pin" style={{ color: 'var(--blue)' }}>No PIN yet, or forgotten it? Set your PIN</Link>
      </p>

      {/* Privacy notice — Data Protection Act, 2019, s.25(1)(a).
          Must be visible before any personal data is collected.
          The matching Kiswahili text is required for the DPA
          requirement to be met in the language people actually use. */}
      <div
        role="note"
        aria-label="Privacy notice"
        style={{
          marginTop: 24,
          padding: '12px 14px',
          borderRadius: 8,
          background: 'var(--paper, #f8f8f6)',
          border: '1px solid var(--line, #e5e5e3)',
          fontSize: '.82rem',
          color: 'var(--tx-2, #555)',
          lineHeight: 1.55,
        }}
      >
        <strong style={{ display: 'block', marginBottom: 4, color: 'var(--tx, #111)' }}>
          Your privacy / Faragha yako
        </strong>

        {/* English */}
        <p style={{ margin: '0 0 10px' }}>
          Esoqo collects your name and phone number to create and maintain your registry record.
          Your data is held under the{' '}
          <strong>Data Protection Act, 2019</strong> and will not be shared without your
          consent. You can view, correct, or request deletion of your record at any time — write
          to{' '}
          <a href="mailto:dpo@esoqo.co.ke" style={{ color: 'var(--blue, #1a73e8)' }}>
            dpo@esoqo.co.ke
          </a>{' '}
          or visit{' '}
          <Link href="https://esoqo.co.ke/trust" style={{ color: 'var(--blue, #1a73e8)' }}>
            esoqo.co.ke/trust
          </Link>
          .
        </p>

        {/* Kiswahili */}
        <p style={{ margin: 0, borderTop: '1px solid var(--line, #e5e5e3)', paddingTop: 10 }}>
          Esoqo inakusanya jina lako na nambari ya simu ili kuunda na kutunza rekodi yako
          kwenye rejista. Taarifa zako zinashikiliwa chini ya{' '}
          <strong>Sheria ya Ulinzi wa Data, 2019</strong> na hazitashirikiwa bila idhini
          yako. Unaweza kutazama, kusahihisha, au kuomba kufutwa kwa rekodi yako wakati
          wowote — andika kwa{' '}
          <a href="mailto:dpo@esoqo.co.ke" style={{ color: 'var(--blue, #1a73e8)' }}>
            dpo@esoqo.co.ke
          </a>{' '}
          au tembelea{' '}
          <Link href="https://esoqo.co.ke/trust" style={{ color: 'var(--blue, #1a73e8)' }}>
            esoqo.co.ke/trust
          </Link>
          .
        </p>
      </div>
    </>
  );
}
