import type { BlockProps } from './types';

interface GalleryGridData {
  heading?: string;
}

/** Reads live from `page.photos` (JamiiPhoto) — an org manages photos
 *  from Dashboard -> Gallery; this only decides where the grid appears. */
export function GalleryGridBlock({ page, data }: BlockProps<GalleryGridData>) {
  if (page.photos.length === 0) return null;

  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        {data.heading?.trim() && <h2 style={{ marginBottom: 20 }}>{data.heading}</h2>}
        <div className="gallerygrid">
          {page.photos.map((photo) => (
            <div key={photo.id} className="gph-photo">
              <img src={photo.url} alt={photo.caption ?? ''} loading="lazy" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
