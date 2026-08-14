'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AssetUpload } from '@/components/AssetUpload';
import { uploadDraftImage } from '../../upload-actions';
import { actionCreateCampaign } from '../../actions';

export function CampaignForm({ pageId }: { pageId: string }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [goalKes, setGoalKes] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [endsAt, setEndsAt] = useState('');
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
      setCoverUrl(result.url);
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionCreateCampaign(pageId, {
        title, summary, body, goalKes: Number(goalKes), coverUrl: coverUrl ?? '', endsAt,
      });
      if (!result.ok) { setError(result.error); return; }
      router.push('/dashboard/campaigns');
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640 }}>
      <div className="field"><label htmlFor="ctitle">Campaign title</label><input id="ctitle" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="summary">One-line summary</label><input id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
      <div className="formrow2">
        <div className="field"><label htmlFor="goal">Goal (KES)</label><input id="goal" type="number" min={1} value={goalKes} onChange={(e) => setGoalKes(e.target.value)} /></div>
        <div className="field"><label htmlFor="endsAt">Ends on (optional)</label><input id="endsAt" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
      </div>
      <AssetUpload label="Cover photo (optional)" hint="PNG or JPEG, up to 10 MB" aspect="2" url={coverUrl} pending={uploading} onUpload={upload} />
      <div className="field"><label htmlFor="cbody">Full story (optional)</label><textarea id="cbody" rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      <button type="button" className="btn btn-stamp" disabled={pending || uploading || !title.trim() || !summary.trim() || !goalKes} onClick={submit}>
        {pending ? 'Opening…' : 'Open campaign'}
      </button>
    </div>
  );
}
