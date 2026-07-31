import type { Metadata } from 'next';
import { Icon } from '@esoko/ui';
import { anonCtx, listPricesForDate, listMissingQuotes } from '@esoko/db';
import { PriceTable } from './PriceTable';

export const metadata: Metadata = {
  title: 'Market prices',
  description: 'Wholesale market prices across Kenya. Free, no account needed.',
};
export const dynamic = 'force-dynamic';

export default async function PricesPage() {
  const ctx = anonCtx();
  const today = new Date();
  const [quotes, missing] = await Promise.all([
    listPricesForDate(ctx, today),
    listMissingQuotes(ctx, today),
  ]);

  const rows = [
    ...quotes.map((q) => ({
      commodity: q.commodity.name, unit: q.commodity.unit, category: q.commodity.category,
      market: q.market.name, county: q.market.county.name,
      price: Number(q.priceKes), source: q.source,
      collectedAt: q.collectedAt.toTimeString().slice(0, 5),
    })),
    // Absence is data. A market that has not reported says so.
    ...missing.map((m) => ({
      commodity: '—', unit: '', category: '',
      market: m.name, county: m.county.name,
      price: null as number | null, source: '', collectedAt: '',
    })),
  ];

  const markets = new Set(quotes.map((q) => q.market.name));
  const counties = new Set(quotes.map((q) => q.market.county.name));

  return (
    <>
      <section className="phead">
        <div className="wrap">
          <p className="kicker">Market prices</p>
          <h1>What things are selling for this morning</h1>
          <p className="lead">
            Collected each morning by market committees, county officers, cooperatives and traders
            in the markets Esoko works in. Free to read, no account needed, and the same figures you
            get by dialling <strong style={{ color: '#fff' }}>*483*77#</strong>.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <div className="grid g4" style={{ marginBottom: 26 }}>
            {([
              ['tag', 'g', quotes.length, 'Prices today'],
              ['shop', 'b', markets.size, 'Markets reporting'],
              ['pin', 'b', counties.size, 'Counties'],
              ['clock', 'a', missing.length, 'Not submitted today'],
            ] as const).map(([icon, tone, n, label]) => (
              <div className="card" key={label}>
                <span className={`icbox icbox-${tone} icbox-sm`} style={{ marginBottom: 9 }}>
                  <Icon name={icon} size={16} />
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.7rem', display: 'block', color: tone === 'a' && n > 0 ? 'var(--amber)' : undefined }}>
                  {n}
                </span>
                <span className="mono" style={{ fontSize: '.65rem', letterSpacing: '.11em', textTransform: 'uppercase', color: 'var(--tx-3)' }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          <div className="note n-blue">
            <span className="icbox icbox-b icbox-sm"><Icon name="info" size={16} /></span>
            <p>
              <strong>Where these come from.</strong> Each price is the wholesale rate reported by
              the named source at the time shown. Retail prices at a stall will be higher. Where a
              market has not submitted, this page says so rather than repeating yesterday’s figure.
            </p>
          </div>

          {rows.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 44 }}>
              <span className="icbox icbox-a" style={{ margin: '0 auto 14px' }}>
                <Icon name="clock" size={21} />
              </span>
              <h2 style={{ marginBottom: 8 }}>No prices collected yet today</h2>
              <p style={{ color: 'var(--tx-2)', margin: 0 }}>
                Market committees report before 6:30am on trading days. Livestock markets report on
                their market days only, which are listed on each county page.
              </p>
            </div>
          ) : (
            <PriceTable rows={rows} />
          )}
        </div>
      </section>
    </>
  );
}
