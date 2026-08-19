'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AssetUpload } from '@/components/AssetUpload';
import { RichTextEditor } from '@/components/RichTextEditor';
import { uploadDraftImage } from '../../upload-actions';
import { actionCreatePost } from '../../actions';

export function PostForm({ pageId }: { pageId: string }) {
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
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
      const result = await actionCreatePost(pageId, { title, excerpt, body, imageUrl: imageUrl ?? '' });
      if (!result.ok) { setError(result.error); return; }
      router.push('/dashboard/posts');
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640 }}>
      <div className="field"><label htmlFor="title">Title</label><input id="title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="excerpt">Short excerpt (optional)</label><input id="excerpt" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} /></div>
      <AssetUpload label="Photo (optional)" hint="PNG or JPEG, up to 10 MB" aspect="1.6" url={imageUrl} pending={uploading} onUpload={upload} />
      <div className="field">
        <label htmlFor="body">What happened?</label>
        <RichTextEditor value={body} onChange={setBody} />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      <button type="button" className="btn btn-stamp" disabled={pending || uploading || !title.trim() || !body.replace(/<[^>]*>/g, '').trim()} onClick={submit}>
        {pending ? 'Publishing…' : 'Publish update'}
      </button>
    </div>
  );
}
