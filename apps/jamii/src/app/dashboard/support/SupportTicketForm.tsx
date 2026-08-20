'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SUPPORT_TICKET_CATEGORIES, SUPPORT_TICKET_CATEGORY_LABELS } from '@esoko/domain';
import { actionCreateSupportTicket } from '../actions';

export function SupportTicketForm({ pageId }: { pageId: string }) {
  const [category, setCategory] = useState<string>('BUG');
  const [categoryOther, setCategoryOther] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionCreateSupportTicket(pageId, { category, categoryOther, subject, message });
      if (!result.ok) { setError(result.error); return; }
      setSubject('');
      setMessage('');
      setCategoryOther('');
      setSent(true);
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640, marginBottom: 20 }}>
      <h2 style={{ fontSize: '1.05rem', marginBottom: 4 }}>Raise a ticket</h2>
      <p className="sub" style={{ marginBottom: 14 }}>Tell CECF/Esoko staff what went wrong — this isn&rsquo;t seen by your page&rsquo;s visitors.</p>

      <div className="field">
        <label htmlFor="ticket-category">What&rsquo;s this about?</label>
        <select id="ticket-category" value={category} onChange={(e) => { setCategory(e.target.value); setSent(false); }}>
          {SUPPORT_TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{SUPPORT_TICKET_CATEGORY_LABELS[c]}</option>)}
        </select>
      </div>
      {category === 'OTHER' && (
        <div className="field">
          <label htmlFor="ticket-category-other">Say what this is about</label>
          <input id="ticket-category-other" value={categoryOther} onChange={(e) => { setCategoryOther(e.target.value); setSent(false); }} />
        </div>
      )}
      <div className="field">
        <label htmlFor="ticket-subject">Subject</label>
        <input id="ticket-subject" value={subject} onChange={(e) => { setSubject(e.target.value); setSent(false); }} placeholder="Can't upload a photo to Gallery" />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="ticket-message">What happened?</label>
        <textarea
          id="ticket-message" rows={5} value={message}
          onChange={(e) => { setMessage(e.target.value); setSent(false); }}
          placeholder="What you were doing, what you expected, and what happened instead."
        />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', margin: '12px 0 0' }}>{error}</p>}
      {sent && !error && <p style={{ color: 'var(--ledger)', fontSize: '.85rem', margin: '12px 0 0' }}>Ticket raised — we&rsquo;ll follow up by email.</p>}
      <button
        type="button" className="btn btn-stamp" style={{ marginTop: 14 }}
        disabled={pending || !subject.trim() || !message.trim() || (category === 'OTHER' && !categoryOther.trim())}
        onClick={submit}
      >
        {pending ? 'Sending…' : 'Raise ticket'}
      </button>
    </div>
  );
}
