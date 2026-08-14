'use client';

import { useRef } from 'react';
import { Icon } from '@esoko/ui';

/** A click-to-upload image picker with a thumbnail preview. Shared by
 *  the logo/cover pickers in Settings and the cover picker on the post
 *  and campaign forms. */
export function AssetUpload({
  label, hint, url, onUpload, pending, aspect = '1',
}: {
  label: string;
  hint?: string;
  url: string | null;
  onUpload: (form: FormData) => void;
  pending: boolean;
  aspect?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="assetpicker">
      <button
        type="button"
        className="asset-thumb"
        style={{ aspectRatio: aspect }}
        onClick={() => ref.current?.click()}
        disabled={pending}
        aria-label={url ? `Replace ${label}` : `Upload ${label}`}
      >
        {url ? <img src={url} alt="" /> : <Icon name="box" size={22} />}
        <span className="asset-thumb-overlay">{pending ? 'Uploading…' : url ? 'Replace' : 'Upload'}</span>
      </button>
      <div>
        <p className="asset-label">{label}</p>
        {hint && <p className="asset-hint">{hint}</p>}
      </div>
      <input
        ref={ref} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const fd = new FormData();
          fd.append('file', f);
          onUpload(fd);
          e.target.value = '';
        }}
      />
    </div>
  );
}
