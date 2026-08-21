'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actionUpdatePage, actionPublishPageDraft, actionDeletePage } from '../../actions';

interface SitePageMeta {
  id: string;
  title: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED';
  seoTitle: string | null;
  seoDescription: string | null;
  /** SYSTEM_* pages (About, FAQ, ...) can't be deleted — see
   *  JamiiSitePage's doc comment in schema.prisma. */
  isSystem: boolean;
}

export function PageMetaForm({ pageId, sitePage }: { pageId: string; sitePage: SitePageMeta }) {
  const [title, setTitle] = useState(sitePage.title);
  const [seoTitle, setSeoTitle] = useState(sitePage.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(sitePage.seoDescription ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await actionUpdatePage(pageId, sitePage.id, { title, seoTitle, seoDescription });
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  function publish() {
    setError(null);
    startTransition(async () => {
      const result = await actionPublishPageDraft(pageId, sitePage.id);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await actionDeletePage(pageId, sitePage.id);
      if (!result.ok) { setError(result.error); return; }
      router.push('/dashboard/pages');
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640 }}>
      <div className="field">
        <label htmlFor="page-title">Page title</label>
        <input id="page-title" value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} />
      </div>
      <div className="field">
        <label htmlFor="page-seo-title">SEO title (optional)</label>
        <input
          id="page-seo-title" value={seoTitle} maxLength={70}
          placeholder={title}
          onChange={(e) => { setSeoTitle(e.target.value); setSaved(false); }}
        />
      </div>
      <div className="field">
        <label htmlFor="page-seo-description">SEO description (optional)</label>
        <textarea
          id="page-seo-description" rows={2} value={seoDescription} maxLength={160}
          onChange={(e) => { setSeoDescription(e.target.value); setSaved(false); }}
        />
      </div>

      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      {saved && !error && <p style={{ color: 'var(--ledger)', fontSize: '.85rem', marginBottom: 12 }}>Saved.</p>}

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="btn btn-stamp btn-sm" disabled={pending || !title.trim()} onClick={save}>
          {pending ? 'Saving…' : 'Save details'}
        </button>
        {sitePage.status === 'DRAFT' && (
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={publish}>
            Publish this page
          </button>
        )}
        {!sitePage.isSystem && (
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={remove}>
            Delete page
          </button>
        )}
      </div>
    </div>
  );
}
