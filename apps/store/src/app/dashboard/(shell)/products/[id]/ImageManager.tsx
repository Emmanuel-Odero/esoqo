'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoko/ui';
import { uploadProductImage, removeProductImage, reorderImages } from './actions';

interface Img { id: string; url: string; position: number }

export function ImageManager({ productId, images }: { productId: string; images: Img[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function upload(file: File) {
    setError(null);
    const form = new FormData();
    form.set('file', file);
    startTransition(async () => {
      const result = await uploadProductImage(productId, form);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
      if (fileRef.current) fileRef.current.value = '';
    });
  }

  function remove(imageId: string) {
    startTransition(async () => {
      const result = await removeProductImage(imageId, productId);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...images];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    startTransition(async () => {
      await reorderImages(productId, next.map((i) => i.id));
      router.refresh();
    });
  }

  return (
    <div className="card">
      <h4 style={{ margin: '0 0 10px', fontSize: '.9rem' }}>Photos</h4>
      {images.length === 0 && <p style={{ color: 'var(--tx-2)', fontSize: '.85rem' }}>No photos yet — a picture sells faster than a description alone.</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {images.map((img, i) => (
          <div key={img.id} style={{ position: 'relative', width: 96 }}>
            <img src={img.url} alt="" width={96} height={96} style={{ objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <button type="button" aria-label="Move earlier" disabled={i === 0 || pending} onClick={() => move(i, -1)}><Icon name="chevron-down" size={12} style={{ transform: 'rotate(90deg)' }} /></button>
              <button type="button" aria-label="Remove photo" disabled={pending} onClick={() => remove(img.id)}><Icon name="close" size={12} /></button>
              <button type="button" aria-label="Move later" disabled={i === images.length - 1 || pending} onClick={() => move(i, 1)}><Icon name="chevron-down" size={12} style={{ transform: 'rotate(-90deg)' }} /></button>
            </div>
          </div>
        ))}
      </div>
      <input
        ref={fileRef} type="file" accept="image/png,image/jpeg"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        disabled={pending}
      />
      {pending && <p className="hint">Uploading…</p>}
      {error && <p className="err" role="alert"><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
