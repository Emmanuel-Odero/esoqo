import type { BlockProps } from './types';

interface MapEmbedData {
  heading?: string;
  embedUrl: string;
}

/** `embedUrl` is Google Maps' own "Embed a map" iframe src (Share ->
 *  Embed a map), pasted by the org — same trust level as VideoEmbed's
 *  `url`. */
export function MapEmbedBlock({ data }: BlockProps<MapEmbedData>) {
  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        {data.heading?.trim() && <h2 style={{ marginBottom: 16 }}>{data.heading}</h2>}
        <div style={{ borderRadius: 12, overflow: 'hidden' }}>
          <iframe
            src={data.embedUrl}
            title={data.heading || 'Map'}
            loading="lazy"
            style={{ width: '100%', height: 400, border: 0 }}
          />
        </div>
      </div>
    </section>
  );
}
