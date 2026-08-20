import Link from 'next/link';
import type { Route } from 'next';
import type { BlockProps } from './types';

interface CtaButtonData {
  heading?: string;
  body?: string;
  buttonLabel: string;
  buttonHref: string;
}

export function CtaButtonBlock({ data }: BlockProps<CtaButtonData>) {
  return (
    <section className="wl-section wl-section-alt">
      <div className="wl-section-inner" style={{ textAlign: 'center' }}>
        {data.heading?.trim() && <h2 style={{ marginBottom: 8 }}>{data.heading}</h2>}
        {data.body?.trim() && <p className="wl-lede" style={{ maxWidth: 560, margin: '0 auto 20px' }}>{data.body}</p>}
        <Link href={data.buttonHref as Route} className="wl-cta">{data.buttonLabel}</Link>
      </div>
    </section>
  );
}
