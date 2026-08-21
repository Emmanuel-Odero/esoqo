import { RichText } from '../RichText';
import type { BlockProps } from './types';

interface RichTextData {
  heading?: string;
  html: string;
}

export function RichTextBlock({ data }: BlockProps<RichTextData>) {
  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        {data.heading?.trim() && (
          <div className="wl-sec-head">
            <h2>{data.heading}</h2>
          </div>
        )}
        <RichText html={data.html} className="wl-rich-block" />
      </div>
    </section>
  );
}
