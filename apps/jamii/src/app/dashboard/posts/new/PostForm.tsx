'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AssetUpload } from '@/components/AssetUpload';
import { RichTextEditor } from '@/components/RichTextEditor';
import { uploadDraftImage } from '../../upload-actions';
import { actionCreatePost, actionUpdatePost, actionDeletePost } from '../../actions';

export function PostForm({
  pageId, postId, initial,
}: {
  pageId: string;
  /** Present only when editing an existing update. */
  postId?: string;
  initial?: { title: string; excerpt: string; body: string; imageUrl: string | null };
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function upload(form: FormData) {
    setError(null);
    setUploading(true);
    startTransition(async () => {
      const result = await uploadDraftImage(form);
      setUploading(false);
      if (!result.ok) { setError(result.error); return; }
      setImageUrl(result.url);
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const input = { title, excerpt, body, imageUrl: imageUrl ?? '' };
      const result = postId
        ? await actionUpdatePost(pageId, postId, input)
        : await actionCreatePost(pageId, input);
      if (!result.ok) { setError(result.error); return; }
      router.push('/dashboard/posts');
      router.refresh();
    });
  }

  function remove() {
    if (!postId) return;
    setError(null);
    startTransition(async () => {
      const result = await actionDeletePost(pageId, postId);
      if (!result.ok) { setError(result.error); return; }
      router.push('/dashboard/posts');
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640 }}>
      <div className="field"><label htmlFor="title">Title</label><input id="title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="excerpt">Short excerpt (optional)</label><input id="excerpt" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} /></div>
      <AssetUpload label="Photo (optional)" hint="PNG or JPEG, up to 1 MB" aspect="1.6" url={imageUrl} pending={uploading} onUpload={upload} />
      <div className="field">
        <label htmlFor="body">What happened?</label>
        <RichTextEditor value={body} onChange={setBody} />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button" className="btn btn-stamp" disabled={pending || uploading || !title.trim() || !body.replace(/<[^>]*>/g, '').trim()}
          onClick={submit}
        >
          {pending ? (postId ? 'Saving…' : 'Publishing…') : postId ? 'Save changes' : 'Publish update'}
        </button>
        {postId && (
          <button type="button" className="btn btn-outline" disabled={pending} onClick={remove}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
