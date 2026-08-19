import type { BlockProps } from './types';

interface PhotoStripData {
  photoIds: string[];
}

/** Resolves against `page.photos` (already loaded gallery photos) —
 *  no new upload flow, an org picks from photos already in Gallery. */
export function PhotoStripBlock({ page, data }: BlockProps<PhotoStripData>) {
  const byId = new Map(page.photos.map((p) => [p.id, p]));
  const photos = data.photoIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (photos.length === 0) return null;

  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        <div className="wl-photo-strip">
          {photos.map((photo) => (
            <div key={photo.id} className="wl-photo-strip-item">
              <img src={photo.url} alt={photo.caption ?? ''} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
