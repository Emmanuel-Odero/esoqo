import { RichText } from '../RichText';
import type { BlockProps } from './types';

interface ImageTextData {
  heading?: string;
  html: string;
  imageUrl?: string;
  imagePosition: 'left' | 'right';
}

export function ImageTextBlock({ data }: BlockProps<ImageTextData>) {
  const image = data.imageUrl?.trim() && <img src={data.imageUrl} alt="" style={{ width: '100%', borderRadius: 12, objectFit: 'cover' }} />;
  const text = (
    <div>
      {data.heading?.trim() && <h2 style={{ marginBottom: 12 }}>{data.heading}</h2>}
      <RichText html={data.html} className="wl-rich-block" />
    </div>
  );

  return (
    <section className="wl-section">
      <div
        className="wl-section-inner"
        style={{ display: 'grid', gridTemplateColumns: image ? '1fr 1fr' : '1fr', gap: 40, alignItems: 'center' }}
      >
        {data.imagePosition === 'left' ? <>{image}{text}</> : <>{text}{image}</>}
      </div>
    </section>
  );
}
