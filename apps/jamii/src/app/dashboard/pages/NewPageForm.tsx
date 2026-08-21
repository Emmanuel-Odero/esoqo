'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { actionCreatePage } from '../actions';

/** Inline "New page" card — a title is all a page needs to exist; the
 *  slug is derived server-side (createJamiiSitePage) the same way an
 *  org's own JamiiPage.slug is. Everything else (SEO, sections) is
 *  edited once the page exists, on its own editor screen. */
export function NewPageForm({ pageId }: { pageId: string }) {
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionCreatePage(pageId, { title });
      if (!result.ok) { setError(result.error); return; }
      router.push(`/dashboard/pages/${result.data.id}`);
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ink btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} /> New page
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', maxWidth: 520 }}>
      <div className="field" style={{ flex: 1, marginBottom: 0 }}>
        <label htmlFor="new-page-title">Page title</label>
        <input
          id="new-page-title" value={title} placeholder="e.g. Our Impact"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) submit(); }}
        />
      </div>
      <button type="button" className="btn btn-stamp btn-sm" disabled={pending || !title.trim()} onClick={submit}>
        {pending ? 'Creating…' : 'Create'}
      </button>
      <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem' }}>{error}</p>}
    </div>
  );
}
