'use client';
import { useMemo, useState } from 'react';
import { Icon, type IconName } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';

export interface Row {
  commodity: string; unit: string; category: string;
  market: string; county: string;
  price: number | null; source: string; collectedAt: string;
}

const CATS: [string, string, IconName][] = [
  ['', 'Everything', 'grid'], ['veg', 'Vegetables', 'leaf'],
  ['cereal', 'Cereals & pulses', 'wheat'], ['fruit', 'Fruit & export crops', 'basket'],
  ['live', 'Livestock & produce', 'cow'], ['goods', 'Stock & inputs', 'box'],
];

export function PriceTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [county, setCounty] = useState('');
  const [per, setPer] = useState(15);
  const [page, setPage] = useState(1);
  const announce = useAnnounce();

  const counties = useMemo(
    () => [...new Set(rows.map((r) => r.county))].sort(), [rows],
  );

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (cat && r.category !== cat) return false;
      if (county && r.county !== county) return false;
      if (t && !`${r.commodity} ${r.market} ${r.county} ${r.unit}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [rows, q, cat, county]);

  const pages = Math.max(1, Math.ceil(filtered.length / per));
  const safePage = Math.min(page, pages);
  const view = filtered.slice((safePage - 1) * per, safePage * per);

  function reset<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 18 }}>
        <div className="fin-in" style={{ flex: 1, minWidth: 220 }}>
          <span className="mg"><Icon name="search" size={18} /></span>
          <input
            type="search" value={q} aria-label="Search a commodity or market"
            onChange={(e) => reset(setQ)(e.target.value)}
            placeholder="Search — sukuma, maize, Gikomba, mbuzi…"
            style={{ padding: '11px 14px 11px 42px', fontSize: '.95rem', borderWidth: '1.5px' }}
          />
        </div>
        <select className="chip" style={{ minHeight: 44 }} value={county}
          aria-label="Filter by county"
          onChange={(e) => reset(setCounty)(e.target.value)}>
          <option value="">All counties</option>
          {counties.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="ib" style={{ fontSize: '.87rem', color: 'var(--tx-2)' }}>
          Show
          <select className="chip" style={{ minHeight: 44 }} value={per}
            onChange={(e) => reset(setPer)(Number(e.target.value))}>
            {[10, 15, 25, 50].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <div className="chips" role="group" aria-label="Filter by category" style={{ marginBottom: 20 }}>
        {CATS.map(([key, label, icon]) => (
          <button key={key} type="button" className={`chip${cat === key ? ' on' : ''}`}
            aria-pressed={cat === key} onClick={() => reset(setCat)(key)}>
            <Icon name={icon} size={16} />{label}
          </button>
        ))}
      </div>

      <div className="tbl">
        <div className="th" style={{ gridTemplateColumns: '2fr 1.3fr 1fr 120px 130px' }}>
          <span>Commodity</span><span>Market</span><span>County</span><span>Price</span><span>Reported</span>
        </div>
        {view.map((r, i) => (
          <div className="tr" key={`${r.commodity}-${r.market}-${i}`}
            style={{ gridTemplateColumns: '2fr 1.3fr 1fr 120px 130px', background: r.price === null ? '#FCFAF5' : undefined }}>
            <div>
              <strong>{r.price === null ? 'Awaiting submission' : r.commodity}</strong>
              {r.unit && <span className="sub" style={{ display: 'block' }}>{r.unit}</span>}
            </div>
            <div>{r.market}</div>
            <div className="sub">{r.county}</div>
            {r.price === null ? (
              <div className="ib" style={{ color: 'var(--amber)', fontSize: '.85rem', gridColumn: 'span 2' }}>
                <Icon name="clock" size={15} />No price submitted today
              </div>
            ) : (
              <>
                <div className="mono" style={{ fontSize: '1.02rem' }}>KES {r.price.toLocaleString('en-KE')}</div>
                <div className="sub mono" style={{ fontSize: '.78rem' }}>
                  {r.collectedAt}<span style={{ display: 'block', color: 'var(--tx-3)' }}>{r.source}</span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
        <p className="sub" role="status">
          {filtered.length
            ? `Showing ${(safePage - 1) * per + 1}–${Math.min(safePage * per, filtered.length)} of ${filtered.length} prices`
            : 'No prices match'}
        </p>
        {pages > 1 && (
          <nav className="row" aria-label="Pagination">
            <button className="chip" disabled={safePage === 1}
              onClick={() => { setPage(safePage - 1); announce(`Page ${safePage - 1}`); }}>
              <Icon name="arrow-left" size={15} />Previous
            </button>
            <span className="mono sub">{safePage} / {pages}</span>
            <button className="chip" disabled={safePage === pages}
              onClick={() => { setPage(safePage + 1); announce(`Page ${safePage + 1}`); }}>
              Next<Icon name="arrow-right" size={15} />
            </button>
          </nav>
        )}
      </div>
    </>
  );
}
