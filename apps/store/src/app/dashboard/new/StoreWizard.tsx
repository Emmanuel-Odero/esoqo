'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { submitStoreWizard } from './actions';

interface Enterprise { id: string; name: string }
interface PriceEntry { amountKes: number | null; amountPct: number | null }

const THEMES = [
  { key: 'market', name: 'Market Green', colors: ['#0A2E4D', '#12794A', '#E7F4ED'] },
  { key: 'nairobi', name: 'Nairobi Blue', colors: ['#0A2E4D', '#0F5C9E', '#E9F2F9'] },
  { key: 'sundown', name: 'Sundown Amber', colors: ['#0A2E4D', '#B8760B', '#FDF4E3'] },
  { key: 'slate', name: 'Mono Slate', colors: ['#0A2E4D', '#57718A', '#DCE5EC'] },
] as const;

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

export function StoreWizard({ enterprises, pricing }: { enterprises: Enterprise[]; pricing: Record<string, PriceEntry> }) {
  const [step, setStep] = useState(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [enterpriseId, setEnterpriseId] = useState(enterprises[0]?.id ?? '');
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [routingMode, setRoutingMode] = useState<'PATH' | 'SUBDOMAIN'>('PATH');
  const [themeKey, setThemeKey] = useState<(typeof THEMES)[number]['key']>('market');
  const [posEnabled, setPosEnabled] = useState(true);

  const subdomainSetup = pricing.SUBDOMAIN_SETUP_FEE?.amountKes ?? 0;
  const subdomainMonthly = pricing.SUBDOMAIN_MONTHLY_FEE?.amountKes ?? 0;
  const posMonthly = pricing.POS_MONTHLY_FEE?.amountKes ?? 0;
  const dueToday = (routingMode === 'SUBDOMAIN' ? subdomainSetup : 0) + (posEnabled ? posMonthly : 0);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'your-store';

  function next() { setStep((s) => Math.min(5, s + 1)); }
  function back() { setStep((s) => Math.max(1, s - 1)); }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitStoreWizard({ enterpriseId, name, tagline, contactPhone, themeKey, routingMode, posEnabled });
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div className="qcard anim-in">
      <div className="wiz-steps">
        {[1, 2, 3, 4, 5].map((n) => <span key={n} className={n < step ? 'done' : n <= step ? 'on' : ''} />)}
      </div>

      {step === 1 && (
        <>
          <p className="mono" style={{ fontSize: '.68rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Step 1 of 5</p>
          <h2 className="qh">Which business, and what&apos;s it called?</h2>
          <p className="qs">This is what customers see. You can change it later.</p>
          {enterprises.length > 1 && (
            <div className="fld">
              <label className="lab" htmlFor="ent">Business</label>
              <select className="inp" id="ent" value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}>
                {enterprises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          )}
          <div className="fld">
            <label className="lab" htmlFor="name">Store name</label>
            <input className="inp" id="name" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Kanini Fresh Produce" />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="tagline">Tagline <em className="dim">optional</em></label>
            <input className="inp" id="tagline" value={tagline} onChange={(ev) => setTagline(ev.target.value)} placeholder="Fresh from the farm, every morning" maxLength={120} />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="cphone">Contact number <em className="dim">optional</em></label>
            <input className="inp mono" id="cphone" value={contactPhone} onChange={(ev) => setContactPhone(ev.target.value)} placeholder="+254 712 345 678" inputMode="tel" />
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="mono" style={{ fontSize: '.68rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Step 2 of 5</p>
          <h2 className="qh">Choose your web address</h2>
          <p className="qs">Both are yours to keep — pick what fits your budget.</p>
          <div className="opts">
            <button type="button" className="opt" aria-pressed={routingMode === 'PATH'} onClick={() => setRoutingMode('PATH')}>
              <div><span className="t">esoko.global/@{slug}</span><span className="d">Included with every store</span></div>
              <span className="price">Free</span>
            </button>
            <button type="button" className="opt" aria-pressed={routingMode === 'SUBDOMAIN'} onClick={() => setRoutingMode('SUBDOMAIN')}>
              <div><span className="t">{slug}.esoko.global</span><span className="d">Your own address, easier to say on air or in print</span></div>
              <span className="price">{kes(subdomainSetup)}<small>one-time + {kes(subdomainMonthly)}/mo</small></span>
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p className="mono" style={{ fontSize: '.68rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Step 3 of 5</p>
          <h2 className="qh">Pick a look for your store</h2>
          <p className="qs">You can switch themes any time from settings.</p>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button type="button" key={t.key} className="theme-opt" aria-pressed={themeKey === t.key} onClick={() => setThemeKey(t.key)}>
                <div className="theme-swatch">{t.colors.map((c) => <i key={c} style={{ background: c }} />)}</div>
                <span style={{ fontSize: '.8rem', fontWeight: 700 }}>{t.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <p className="mono" style={{ fontSize: '.68rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Step 4 of 5</p>
          <h2 className="qh">Add the PoS terminal?</h2>
          <p className="qs">Ring up in-person sales — cash or M-Pesa — from your phone or tablet, even offline.</p>
          <div className="opt" style={{ cursor: 'default', alignItems: 'flex-start' }}>
            <button type="button" className="toggle" aria-pressed={posEnabled} aria-label="Add PoS terminal" onClick={() => setPosEnabled((v) => !v)} />
            <div>
              <span className="t">PoS terminal add-on</span>
              <span className="d">{kes(posMonthly)}/month · works with no signal, syncs sales when you&apos;re back online</span>
            </div>
          </div>
        </>
      )}

      {step === 5 && (
        <>
          <p className="mono" style={{ fontSize: '.68rem', color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Step 5 of 5</p>
          <h2 className="qh">Review &amp; open your store</h2>
          <p className="qs">Charged the way you already pay — M-Pesa, right after this.</p>
          <div className="card">
            <div className="review-line"><span>Store name</span><b>{name || '—'}</b></div>
            <div className="review-line"><span>Tagline</span><b>{tagline || '—'}</b></div>
            <div className="review-line"><span>Contact number</span><b className="mono">{contactPhone || '—'}</b></div>
            <div className="review-line"><span>Address</span><b>{routingMode === 'PATH' ? `esoko.global/@${slug} — Free` : `${slug}.esoko.global — ${kes(subdomainSetup)} + ${kes(subdomainMonthly)}/mo`}</b></div>
            <div className="review-line"><span>Theme</span><b>{THEMES.find((t) => t.key === themeKey)?.name}</b></div>
            <div className="review-line"><span>PoS terminal</span><b>{posEnabled ? `Added — ${kes(posMonthly)}/mo` : 'Not added'}</b></div>
            <div className="review-total"><span>Due today</span><span>{kes(dueToday)}</span></div>
          </div>
          {error && <div className="note n-red" style={{ marginTop: 16 }}><div><p>{error}</p></div></div>}
        </>
      )}

      <div className="wiz-nav">
        <button type="button" className="btn btn-o" onClick={back} disabled={step === 1}>Back</button>
        {step < 5 ? (
          <button type="button" className="btn btn-p" onClick={next} disabled={step === 1 && !name.trim()}>
            Continue <Icon name="arrow-right" size={16} />
          </button>
        ) : (
          <button type="button" className="btn btn-g" onClick={submit} disabled={pending}>
            {pending ? 'Opening your store…' : dueToday > 0 ? `Pay ${kes(dueToday)} & open store` : 'Open store'}
            <Icon name="check" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}