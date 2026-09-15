'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '@/components/RichTextEditor';
import { actionAddCampaignUpdate, actionDeleteCampaignUpdate } from '../actions';

type Update = { id: string; title: string; body: string; postedAt: Date };

/** The "Updates" timeline donors see on the public campaign page —
 *  previously had no dashboard UI at all, even though the DAL/schema
 *  already existed. Posting one is a plain create — updates are a
 *  running log, not something an org edits after the fact — so this
 *  only supports add/delete, same as Posts before its own edit screen
 *  didn't exist either. */
export function CampaignUpdatesPanel({
  pageId, campaignId, initial,
}: { pageId: string; campaignId: string; initial: Update[] }) {
  const [updates, setUpdates] = useState(initial);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // Bumped on every successful post to force RichTextEditor (Tiptap) to
  // remount — like most rich-text editors, it's uncontrolled after
  // mount, so just resetting the `body` state it was seeded from
  // doesn't clear what's on screen.
  const [editorKey, setEditorKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function post() {
    setError(null);
    startTransition(async () => {
      const result = await actionAddCampaignUpdate(pageId, campaignId, { title, body });
      if (!result.ok) { setError(result.error); return; }
      setUpdates((rows) => [result.data, ...rows]);
      setTitle('');
      setBody('');
      setEditorKey((k) => k + 1);
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await actionDeleteCampaignUpdate(pageId, campaignId, id);
      if (!result.ok) { setError(result.error); return; }
      setUpdates((rows) => rows.filter((r) => r.id !== id));
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640, marginTop: 20 }}>
      <h2 style={{ fontSize: '1.05rem', marginBottom: 4 }}>Updates</h2>
      <p className="sub" style={{ marginBottom: 14 }}>Posted to donors on this campaign&rsquo;s public page — a running log, oldest to newest.</p>

      {updates.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          {updates.map((u) => (
            <div key={u.id} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px dashed var(--paper-line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                <b>{u.title}</b>
                <span style={{ fontSize: '.72rem', color: '#8a8368', fontFamily: 'var(--font-mono)' }}>
                  {u.postedAt.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <div dangerouslySetInnerHTML={{ __html: u.body }} style={{ fontSize: '.85rem', marginTop: 4 }} />
              <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => remove(u.id)} style={{ marginTop: 8 }}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="field"><label htmlFor="update-title">New update title</label><input id="update-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="update-body">What&rsquo;s new</label>
        <RichTextEditor key={editorKey} value={body} onChange={setBody} />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', margin: '12px 0 0' }}>{error}</p>}
      <button
        type="button" className="btn btn-stamp" style={{ marginTop: 14 }}
        disabled={pending || !title.trim() || !body.replace(/<[^>]*>/g, '').trim()}
        onClick={post}
      >
        {pending ? 'Posting…' : 'Post update'}
      </button>
    </div>
  );
}
