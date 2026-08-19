'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AssetUpload } from '@/components/AssetUpload';
import { RichTextEditor } from '@/components/RichTextEditor';
import { uploadDraftImage } from '../upload-actions';
import { actionCreateCampaign, actionUpdateCampaign } from '../actions';

const STATUS_OPTIONS = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

export function CampaignForm({
  pageId, campaignId, initial,
}: {
  pageId: string;
  /** Present only when editing an existing campaign. */
  campaignId?: string;
  initial?: {
    title: string; summary: string; body: string | null; goalKes: number;
    coverUrl: string | null; endsAt: string | null; status: string;
  };
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [goalKes, setGoalKes] = useState(initial ? String(initial.goalKes) : '');
  const [coverUrl, setCoverUrl] = useState<string | null>(initial?.coverUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [endsAt, setEndsAt] = useState(initial?.endsAt ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'ACTIVE');
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
      const result = campaignId
        ? await actionUpdateCampaign(pageId, campaignId, {
            title, summary, body, goalKes: Number(goalKes), coverUrl: coverUrl ?? '', endsAt, status,
          })
        : await actionCreateCampaign(pageId, {
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
        <div className="field"><label htmlFor="endsAt">Ends on (optional)</label><input id="endsAt" type="date" value={endsAt ?? ''} onChange={(e) => setEndsAt(e.target.value)} /></div>
      </div>
      {campaignId && (
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
      <AssetUpload label="Cover photo (optional)" hint="PNG or JPEG, up to 10 MB" aspect="2" url={coverUrl} pending={uploading} onUpload={upload} />
      <div className="field">
        <label htmlFor="cbody">Full story (optional)</label>
        <RichTextEditor value={body ?? ''} onChange={setBody} />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      <button type="button" className="btn btn-stamp" disabled={pending || uploading || !title.trim() || !summary.trim() || !goalKes} onClick={submit}>
        {pending ? (campaignId ? 'Saving…' : 'Opening…') : campaignId ? 'Save changes' : 'Open campaign'}
      </button>
    </div>
  );
}
