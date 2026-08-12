'use client';
import { useMemo, useState } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { PRODUCT_CATEGORIES } from '@esoko/domain';

export interface StoreRow {
  slug: string;
  name: string;
  county: string | null;
  workRaw: string;
  productCount: number;
  posEnabled: boolean;
  primaryCategory: string | null;
  verified: boolean;
  handleUrl: string;
}

// Known category keys, plus one "Other" bucket for a store whose
// primaryCategory is free text or unset — the profile editor allows a
// seller to type their own ("Poultry, dairy & eggs"), so directory
// chips can't assume the field is always a known key.
const CAT_LABEL: Record<string, string> = Object.fromEntries(PRODUCT_CATEGORIES);
const KNOWN = new Set<string>(PRODUCT_CATEGORIES.map(([k]) => k));

export function StoreBrowser({ stores }: { stores: StoreRow[] }) {
  const [q, setQ] = useState('');
  const [county, setCounty] = useState('');
  const [cat, setCat] = useState('');
  const announce = useAnnounce();

  const counties = useMemo(
    () => [...new Set(stores.map((s) => s.county).filter((c): c is string => Boolean(c)))].sort(),
    [stores],
  );

  const cats = useMemo(() => {
    const seen = new Set<string>();
    for (const s of stores) seen.add(s.primaryCategory ? (KNOWN.has(s.primaryCategory) ? s.primaryCategory : 'OTHER') : 'OTHER');
    return [...seen].sort();
  }, [stores]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return stores.filter((s) => {
      if (county && s.county !== county) return false;
      if (cat) {
        const c = s.primaryCategory ? (KNOWN.has(s.primaryCategory) ? s.primaryCategory : 'OTHER') : 'OTHER';
        if (c !== cat) return false;
      }
      if (t && !`${s.name} ${s.workRaw} ${s.county ?? ''}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [stores, q, county, cat]);

  return (
    <>
      <div className="row" style={{ marginBottom: 22 }}>
        <div className="fin-in" style={{ flex: 1, minWidth: 220 }}>
          <span className="mg"><Icon name="search" size={18} /></span>
          <input
            type="search" aria-label="Search a store or what they sell"
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Store name or what they sell"
            style={{ padding: '11px 14px 11px 42px', fontSize: '.95rem', borderWidth: '1.5px' }}
          />
        </div>
        <select
          className="chip" style={{ minHeight: 44 }} value={county}
          aria-label="Filter by county"
          onChange={(e) => { setCounty(e.target.value); announce(e.target.value ? `Filtered to ${e.target.value}` : 'Showing all counties'); }}
        >
          <option value="">All counties</option>
          {counties.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {cats.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }} role="group" aria-label="Filter by what stores sell">
          <button
            type="button" className="chip" aria-pressed={cat === ''}
            onClick={() => { setCat(''); announce('Showing all categories'); }}
          >
            All
          </button>
          {cats.map((c) => (
            <button
              type="button" key={c} className="chip" aria-pressed={cat === c}
              style={cat === c ? { borderColor: 'var(--green)', background: 'var(--green-t)', color: 'var(--green)' } : undefined}
              onClick={() => { setCat(c); announce(`Filtered to ${CAT_LABEL[c] ?? c}`); }}
            >
              {CAT_LABEL[c] ?? c}
            </button>
          ))}
        </div>
      )}

      <p className="sub" style={{ marginBottom: 16 }} aria-live="polite">
        {filtered.length} store{filtered.length === 1 ? '' : 's'}
      </p>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="shop" size={20} /></span>
          <h3 style={{ marginBottom: 6 }}>No stores match yet</h3>
          <p className="sub" style={{ margin: 0 }}>Try a different search or county — new stores open every day.</p>
        </div>
      ) : (
        <div className="grid g3">
          {filtered.map((s) => (
            <a key={s.slug} className="card" href={s.handleUrl} style={{ display: 'block' }}>
              <span className="icbox icbox-g" style={{ marginBottom: 13 }}><Icon name="shop" size={20} /></span>
              <h3 style={{ marginBottom: 4 }}>{s.name}</h3>
              <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>{s.workRaw}</p>
              <p className="sub mono" style={{ marginTop: 10, marginBottom: 0, fontSize: '.78rem' }}>
                {s.county ?? 'Kenya'} · {s.productCount} product{s.productCount === 1 ? '' : 's'}{s.posEnabled ? ' · PoS' : ''}
              </p>
              {s.verified && (
                <p className="sub" style={{ margin: '8px 0 0', fontSize: '.78rem', fontWeight: 700, color: 'var(--green)' }}>
                  <Icon name="shield-check" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Verified Esoko business
                </p>
              )}
            </a>
          ))}
        </div>
      )}
    </>
  );
}
