'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { listJamiiContactMessages } from '@esoko/db';
import { actionMarkMessageRead, actionArchiveMessage } from '../actions';

type Message = Awaited<ReturnType<typeof listJamiiContactMessages>>[number];

const STATUS_LABEL: Record<Message['status'], string> = { NEW: 'New', READ: 'Read', ARCHIVED: 'Archived' };

export function MessagesPanel({ pageId, messages }: { pageId: string; messages: Message[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function open(m: Message) {
    setOpenId(openId === m.id ? null : m.id);
    if (m.status === 'NEW') {
      startTransition(async () => {
        await actionMarkMessageRead(pageId, m.id);
        router.refresh();
      });
    }
  }

  function archive(id: string) {
    startTransition(async () => {
      await actionArchiveMessage(pageId, id);
      router.refresh();
    });
  }

  if (messages.length === 0) {
    return <p className="sub">No messages yet — they&rsquo;ll show up here as soon as someone writes in through your Contact page.</p>;
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {messages.map((m) => (
          <li key={m.id} style={{ borderBottom: '1px solid #ece6d5' }}>
            <button
              type="button"
              onClick={() => open(m)}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer',
                padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'inherit',
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: 999, flex: '0 0 auto',
                background: m.status === 'NEW' ? 'var(--stamp)' : 'transparent', border: m.status === 'NEW' ? undefined : '1px solid #ddd6c4',
              }} aria-hidden="true" />
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <b style={{ fontWeight: m.status === 'NEW' ? 700 : 500 }}>{m.name}</b>
                {m.subject && <span style={{ color: '#8a8368' }}> — {m.subject}</span>}
              </span>
              <span className="mono" style={{ fontSize: '.76rem', color: '#8a8368', flex: '0 0 auto' }}>
                {m.createdAt.toLocaleDateString('en-KE')}
              </span>
              <span style={{ fontSize: '.72rem', color: '#8a8368', flex: '0 0 auto' }}>{STATUS_LABEL[m.status]}</span>
            </button>
            {openId === m.id && (
              <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: '.85rem', color: '#4b4633' }}>
                  <div><b>Email</b> — <a href={`mailto:${m.email}`} className="mono">{m.email}</a></div>
                  {m.phone && <div><b>Phone</b> — <span className="mono">{m.phone}</span></div>}
                </div>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{m.message}</p>
                {m.status !== 'ARCHIVED' && (
                  <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={pending} onClick={() => archive(m.id)}>
                    Archive
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
