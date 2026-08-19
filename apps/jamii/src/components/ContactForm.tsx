'use client';

import { useState, useTransition } from 'react';
import { actionSubmitContactMessage } from '@/app/(site)/o/[slug]/contact/actions';

type Values = { name: string; email: string; phone: string; subject: string; message: string; website2: string };
const EMPTY: Values = { name: '', email: '', phone: '', subject: '', message: '', website2: '' };

/**
 * The public Contact page's message form — same component on both the
 * primary domain and a custom domain, styled by `variant` rather than
 * forked into two components, since the only difference is which CSS
 * classes it wears (`.field`/`.btn` for the primary "manila ledger"
 * look vs `.wl-form-field`/`.wl-cta` for the whitelabel theme — see
 * jamii.css). Submissions land in the org's own dashboard → Messages.
 */
export function ContactForm({ pageId, variant, orgName }: { pageId: string; variant: 'primary' | 'whitelabel'; orgName: string }) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof Values>(key: K, v: Values[K]) {
    setValues((p) => ({ ...p, [key]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await actionSubmitContactMessage(pageId, values);
      if (!result.ok) { setError(result.error); return; }
      setSent(true);
      setValues(EMPTY);
    });
  }

  const wl = variant === 'whitelabel';
  const fieldClass = wl ? 'wl-form-field' : 'field';

  if (sent) {
    return (
      <div className={wl ? 'wl-form-sent' : 'card'} style={wl ? undefined : { padding: 22 }}>
        <h3>Message sent</h3>
        <p>Thanks for reaching out to {orgName} — they&rsquo;ll reply to the email or phone number you left.</p>
        <button type="button" className={wl ? 'wl-cta-ghost' : 'btn btn-outline'} onClick={() => setSent(false)}>
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form className={wl ? 'wl-form' : 'contactform'} onSubmit={submit}>
      <div className={wl ? 'wl-form-row2' : 'formrow2'}>
        <div className={fieldClass}>
          <label htmlFor="cf-name">Your name</label>
          <input id="cf-name" value={values.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} />
        </div>
        <div className={fieldClass}>
          <label htmlFor="cf-email">Email</label>
          <input id="cf-email" type="email" value={values.email} onChange={(e) => set('email', e.target.value)} required />
        </div>
      </div>
      <div className={wl ? 'wl-form-row2' : 'formrow2'}>
        <div className={fieldClass}>
          <label htmlFor="cf-phone">Phone (optional)</label>
          <input id="cf-phone" value={values.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254 7XX XXX XXX" />
        </div>
        <div className={fieldClass}>
          <label htmlFor="cf-subject">Subject (optional)</label>
          <input id="cf-subject" value={values.subject} onChange={(e) => set('subject', e.target.value)} />
        </div>
      </div>
      <div className={fieldClass}>
        <label htmlFor="cf-message">Message</label>
        <textarea id="cf-message" rows={5} value={values.message} onChange={(e) => set('message', e.target.value)} required minLength={10} maxLength={4000} />
      </div>
      {/* Honeypot — hidden from real visitors via CSS, never via
          type="hidden" (bots skip those); left blank it changes
          nothing, filled in the server action silently drops it. */}
      <div className="wl-form-hp" aria-hidden="true">
        <label htmlFor="cf-website2">Leave this field blank</label>
        <input id="cf-website2" tabIndex={-1} autoComplete="off" value={values.website2} onChange={(e) => set('website2', e.target.value)} />
      </div>

      {error && <p className={wl ? 'wl-form-error' : 'field err'}>{error}</p>}
      <button type="submit" className={wl ? 'wl-cta' : 'btn btn-stamp'} disabled={pending}>
        {pending ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}
