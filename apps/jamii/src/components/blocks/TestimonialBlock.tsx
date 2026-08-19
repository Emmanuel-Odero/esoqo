import type { BlockProps } from './types';

interface TestimonialData {
  quote: string;
  name: string;
  role?: string;
}

export function TestimonialBlock({ data }: BlockProps<TestimonialData>) {
  return (
    <section className="wl-section">
      <div className="wl-section-inner">
        <blockquote className="wl-testimonial">
          <p>&ldquo;{data.quote}&rdquo;</p>
          <footer>
            <span className="wl-testimonial-name">{data.name}</span>
            {data.role?.trim() && <span className="wl-testimonial-role">{data.role}</span>}
          </footer>
        </blockquote>
      </div>
    </section>
  );
}
