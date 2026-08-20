'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actionUpdateFaq } from '../actions';
import { RichTextEditor } from '@/components/RichTextEditor';

export function FaqEditor({ pageId, initial }: { pageId: string; initial: { q: string; a: string }[] }) {
  const [items, setItems] = useState(initial.length ? initial : [{ q: '', a: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function update(i: number, key: 'q' | 'a', value: string) {
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  function save() {
    setError(null);
    // r.a is Tiptap HTML, not plain text — an untouched editor is
    // "<p></p>", not "" — so check for actual text content, not just a
    // non-empty string, before dropping a row as blank.
    const cleaned = items.filter((r) => r.q.trim() && r.a.replace(/<[^>]*>/g, '').trim());
    startTransition(async () => {
      const result = await actionUpdateFaq(pageId, cleaned);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <div id="faq-section" className="card" style={{ padding: 22, maxWidth: 640, marginTop: 20 }}>
      <h3 style={{ fontSize: '1rem', color: 'var(--ink)', marginBottom: 14 }}>Frequently asked questions</h3>
      {items.map((row, i) => (
        <div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px dashed var(--paper-line)' }}>
          <div className="field"><label htmlFor={`faq-q-${i}`}>Question</label><input id={`faq-q-${i}`} value={row.q} onChange={(e) => update(i, 'q', e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`faq-a-${i}`}>Answer</label>
            <RichTextEditor value={row.a} onChange={(html) => update(i, 'a', html)} />
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setItems((r) => [...r, { q: '', a: '' }])}>+ Add question</button>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', margin: '12px 0 0' }}>{error}</p>}
      <button type="button" className="btn btn-stamp" style={{ marginTop: 14 }} disabled={pending} onClick={save}>
        {pending ? 'Saving…' : 'Save FAQ'}
      </button>
    </div>
  );
}
