'use client';

import { useState, useTransition } from 'react';
import { actionSendContact } from './actions';

export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('Setting up an organisation page');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await actionSendContact({ name, email, topic, message });
      if (!result.ok) { setError(result.error); return; }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div style={{ textAlign: 'center', padding: '30px 10px' }}>
        <span className="stampmark" style={{ marginBottom: 16 }}>Received</span>
        <h3 style={{ marginTop: 12 }}>Message sent</h3>
        <p style={{ color: '#6b6552' }}>We&rsquo;ll reply to your email within one working day.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="cname">Your name</label>
        <input id="cname" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Wanjiru" />
      </div>
      <div className="field">
        <label htmlFor="cemail">Email</label>
        <input id="cemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
      </div>
      <div className="field">
        <label htmlFor="ctopic">I&rsquo;m getting in touch about</label>
        <select id="ctopic" value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option>Setting up an organisation page</option>
          <option>A donation I made</option>
          <option>Verifying my organisation</option>
          <option>A partnership or press question</option>
          <option>Something else</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="cmessage">Message</label>
        <textarea id="cmessage" required rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How can we help?" />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      <button type="submit" className="btn btn-stamp btn-block" disabled={pending}>
        {pending ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}
