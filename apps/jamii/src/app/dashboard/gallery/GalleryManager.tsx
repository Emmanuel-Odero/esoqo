'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadGalleryPhoto, removeGalleryPhoto } from '../upload-actions';
import { actionUpdatePhotoCaption } from '../actions';

type Photo = { id: string; url: string; storageKey: string; caption: string | null };

function CaptionField({ pageId, photo }: { pageId: string; photo: Photo }) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await actionUpdatePhotoCaption(pageId, photo.id, caption);
      setSaved(result.ok);
    });
  }

  return (
    <input
      value={caption} placeholder="Caption (also used as alt text)" aria-label="Photo caption"
      className="gcaption"
      onChange={(e) => { setCaption(e.target.value); setSaved(false); }}
      onBlur={() => { if (caption !== (photo.caption ?? '')) save(); }}
      disabled={pending}
      style={{ fontSize: '.72rem', opacity: pending ? 0.6 : saved ? 1 : undefined }}
    />
  );
}

export function GalleryManager({ pageId, photos }: { pageId: string; photos: Photo[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function onFile(f: File) {
    setError(null);
    const fd = new FormData();
    fd.append('file', f);
    startTransition(async () => {
      const result = await uploadGalleryPhoto(pageId, fd);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  function remove(photo: Photo) {
    setError(null);
    setRemovingId(photo.id);
    startTransition(async () => {
      const result = await removeGalleryPhoto(pageId, photo.id, photo.storageKey);
      setRemovingId(null);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 760 }}>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
      <div className="dashgallery">
        {photos.map((photo) => (
          <div key={photo.id}>
            <div className="gitem">
              <img src={photo.url} alt={photo.caption ?? ''} />
              <button type="button" aria-label="Remove photo" disabled={pending && removingId === photo.id} onClick={() => remove(photo)}>×</button>
            </div>
            <CaptionField pageId={pageId} photo={photo} />
          </div>
        ))}
        <button type="button" className="gadd" onClick={() => ref.current?.click()} disabled={pending}>
          <span>{pending && !removingId ? 'Uploading…' : '+ Add photo'}</span>
        </button>
      </div>
      <input
        ref={ref} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
    </div>
  );
}
