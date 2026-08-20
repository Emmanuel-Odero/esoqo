import { RichText } from '../RichText';
import type { BlockProps } from './types';

interface FaqAccordionData {
  heading?: string;
}

/** Reads live from `page.faq` (JamiiPage.faq json) — an org manages
 *  questions from Dashboard -> Settings; this only decides where the
 *  accordion appears. */
export function FaqAccordionBlock({ page, data }: BlockProps<FaqAccordionData>) {
  const faq = Array.isArray(page.faq) ? (page.faq as { q: string; a: string }[]) : [];
  if (faq.length === 0) return null;

  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        {data.heading?.trim() && <h2 style={{ marginBottom: 20 }}>{data.heading}</h2>}
        <div className="card" style={{ padding: '6px 20px' }}>
          {faq.map((item, i) => (
            <details key={i} className="faqitem">
              <summary className="faqq">{item.q}</summary>
              <RichText html={item.a} className="faqa" />
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
