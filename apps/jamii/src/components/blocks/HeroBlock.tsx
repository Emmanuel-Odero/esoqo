import Link from 'next/link';
import type { Route } from 'next';
import type { BlockProps } from './types';

interface HeroData {
  heading: string;
  subheading?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export function HeroBlock({ data }: BlockProps<HeroData>) {
  return (
    <section className="wl-section">
      <div className="wl-section-inner" style={{ textAlign: 'center' }}>
        {data.imageUrl?.trim() && (
          <img src={data.imageUrl} alt="" style={{ width: '100%', maxHeight: 420, objectFit: 'cover', borderRadius: 12, marginBottom: 28 }} />
        )}
        <h1 style={{ marginBottom: 12 }}>{data.heading}</h1>
        {data.subheading?.trim() && <p className="wl-lede" style={{ maxWidth: 640, margin: '0 auto 20px' }}>{data.subheading}</p>}
        {data.ctaLabel?.trim() && data.ctaHref?.trim() && (
          <Link href={data.ctaHref as Route} className="wl-cta">{data.ctaLabel}</Link>
        )}
      </div>
    </section>
  );
}
