import type { BlockProps } from './types';

interface VideoEmbedData {
  heading?: string;
  url: string;
}

/** youtube.com/watch?v=X and youtu.be/X -> the embeddable player URL;
 *  vimeo.com/X -> player.vimeo.com/video/X; anything else (already an
 *  embed URL, or another host entirely) passes through unchanged — an
 *  org pasting a link is trusted the same way a Photo Strip's uploaded
 *  image or a Map Embed's URL already is (see MapEmbedBlock). */
function toEmbedSrc(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (u.hostname.endsWith('youtube.com') && u.searchParams.get('v')) {
      return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
    }
    if (u.hostname.endsWith('vimeo.com') && !u.hostname.startsWith('player.')) {
      return `https://player.vimeo.com/video${u.pathname}`;
    }
    return url;
  } catch {
    return url;
  }
}

export function VideoEmbedBlock({ data }: BlockProps<VideoEmbedData>) {
  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        {data.heading?.trim() && <h2 style={{ marginBottom: 16 }}>{data.heading}</h2>}
        <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: 12, overflow: 'hidden' }}>
          <iframe
            src={toEmbedSrc(data.url)}
            title={data.heading || 'Video'}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        </div>
      </div>
    </section>
  );
}
