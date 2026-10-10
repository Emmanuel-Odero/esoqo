'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@esoqo/ui';
import { JAMII_PROGRAM_ICONS } from '@esoqo/domain/jamii-constants';
import { RichTextEditor } from '@/components/RichTextEditor';
import { actionCreateProgram, actionUpdateProgram, actionDeleteProgram } from '../actions';

export function ProgramForm({
  pageId, programId, initial,
}: {
  pageId: string;
  /** Present only when editing an existing programme. */
  programId?: string;
  initial?: { title: string; body: string; icon: string | null };
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const input = { title, body, icon: icon || undefined };
      const result = programId
        ? await actionUpdateProgram(pageId, programId, input)
        : await actionCreateProgram(pageId, input);
      if (!result.ok) { setError(result.error); return; }
      router.push('/dashboard/programs');
      router.refresh();
    });
  }

  function remove() {
    if (!programId) return;
    setError(null);
    startTransition(async () => {
      const result = await actionDeleteProgram(pageId, programId);
      if (!result.ok) { setError(result.error); return; }
      router.push('/dashboard/programs');
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640 }}>
      <div className="field"><label htmlFor="ptitle">Programme name</label><input id="ptitle" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field">
        <label htmlFor="picon">Icon (optional)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select id="picon" value={icon} onChange={(e) => setIcon(e.target.value)}>
            <option value="">No icon</option>
            {JAMII_PROGRAM_ICONS.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          {icon && <Icon name={icon as IconName} size={18} />}
        </div>
      </div>
      <div className="field">
        <label htmlFor="pbody">Description</label>
        <RichTextEditor value={body} onChange={setBody} />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="btn btn-stamp" disabled={pending || !title.trim() || !body.replace(/<[^>]*>/g, '').trim()} onClick={submit}>
          {pending ? 'Saving…' : programId ? 'Save changes' : 'Add programme'}
        </button>
        {programId && (
          <button type="button" className="btn btn-outline" disabled={pending} onClick={remove}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
