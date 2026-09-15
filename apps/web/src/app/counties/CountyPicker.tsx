'use client';
import { useState } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';

export interface CountyRow {
  code: string; name: string;
  hasFieldOfficer: boolean; pricesLive: boolean; population: string | null;
}

export function CountyPicker({ counties }: { counties: CountyRow[] }) {
  const live = counties.filter((c) => c.hasFieldOfficer);
  const [sel, setSel] = useState(live[0]?.code ?? counties[0]?.code ?? '');
  const announce = useAnnounce();
  const current = counties.find((c) => c.code === sel);

  return (
    <>
      <h2 id="pick" style={{ marginBottom: 14 }}>Choose your county</h2>
      <div className="grid g4" style={{ marginBottom: 26 }} role="tablist" aria-label="Counties">
        {counties.map((c) => (
          <button key={c.code} role="tab" aria-selected={sel === c.code}
            className="card" style={{
              textAlign: 'left', cursor: 'pointer', padding: '16px 18px',
              borderColor: sel === c.code ? 'var(--green)' : undefined,
              background: sel === c.code ? 'var(--green-t)' : undefined,
            }}
            onClick={() => { setSel(c.code); announce(`${c.name} selected`); }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.02rem', display: 'block' }}>
              {c.name}
            </span>
            <span className="sub" style={{ fontSize: '.79rem', display: 'block', marginTop: 3 }}>
              {c.hasFieldOfficer ? 'Field officer working here' : 'Opening next'}
            </span>
          </button>
        ))}
      </div>

      {current && (
        <div role="tabpanel" aria-live="polite">
          <div className="grid g4" style={{ marginBottom: 22 }}>
            {([
              ['users', 'Population', current.population ?? '—'],
              ['pin', 'Esoqo field officer', current.hasFieldOfficer ? 'Working here' : 'Not yet'],
              ['tag', 'Daily market prices', current.pricesLive ? 'Collected' : 'Not yet'],
              ['calendar', 'Market days', current.pricesLive ? 'See prices page' : '—'],
            ] as const).map(([icon, label, value]) => (
              <div className="card" key={label} style={{ padding: '15px 18px' }}>
                <span className="mono ib" style={{ fontSize: '.64rem', letterSpacing: '.11em', textTransform: 'uppercase', color: 'var(--tx-3)' }}>
                  <Icon name={icon} size={13} />{label}
                </span>
                <span style={{ fontWeight: 600, fontSize: '.93rem', display: 'block', marginTop: 4 }}>{value}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <h3 className="ib" style={{ marginBottom: 12 }}>
              <Icon name="document" size={18} />Permits and licences in {current.name}
            </h3>
            <p className="sub" style={{ margin: 0 }}>
              Permit and fee data for {current.name} has not been verified against the current
              Finance Act yet. Rather than publish figures someone might budget on, this section
              stays empty until a county officer has confirmed them.
            </p>
            <p className="sub" style={{ marginTop: 12, marginBottom: 0 }}>
              If you work for {current.name} County and can confirm the current schedule, write to{' '}
              <strong style={{ color: 'var(--navy)' }}>counties@esoqo.co.ke</strong>.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
