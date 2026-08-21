import { RichText } from '../RichText';
import type { BlockProps } from './types';

interface ColumnsData {
  heading?: string;
  columns: { heading?: string; html: string }[];
}

export function ColumnsBlock({ data }: BlockProps<ColumnsData>) {
  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        {data.heading?.trim() && <h2 style={{ marginBottom: 20 }}>{data.heading}</h2>}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.columns.length}, 1fr)`, gap: 32 }}>
          {data.columns.map((col, i) => (
            <div key={i}>
              {col.heading?.trim() && <h3 style={{ marginBottom: 8 }}>{col.heading}</h3>}
              <RichText html={col.html} className="wl-rich-block" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
