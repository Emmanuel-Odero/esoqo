'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AssetUpload } from '@/components/AssetUpload';
import { uploadPageAsset } from '../upload-actions';

export function PageAssets({
  pageId, initialLogoUrl, initialCoverUrl,
}: { pageId: string; initialLogoUrl: string | null; initialCoverUrl: string | null }) {
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [coverUrl, setCoverUrl] = useState(initialCoverUrl);
  const [error, setError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<'logo' | 'cover' | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function upload(target: 'logo' | 'cover', form: FormData) {
    setError(null);
    setPendingTarget(target);
    startTransition(async () => {
      const result = await uploadPageAsset(pageId, target, form);
      setPendingTarget(null);
      if (!result.ok) { setError(result.error); return; }
      if (target === 'logo') setLogoUrl(result.url); else setCoverUrl(result.url);
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640, marginBottom: 20 }}>
      <h3 style={{ fontSize: '1rem', color: 'var(--ink)', marginBottom: 16 }}>Logo &amp; cover photo</h3>
      <AssetUpload
        label="Logo" hint="Square image works best · PNG or JPEG, up to 2 MB"
        url={logoUrl} pending={pendingTarget === 'logo'} onUpload={(f) => upload('logo', f)}
      />
      <AssetUpload
        label="Cover photo" hint="Wide image, shown at the top of your public page · up to 1 MB"
        aspect="2.6" url={coverUrl} pending={pendingTarget === 'cover'} onUpload={(f) => upload('cover', f)}
      />
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', margin: 0 }}>{error}</p>}
    </div>
  );
}
