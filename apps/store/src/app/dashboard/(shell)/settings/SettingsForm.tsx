'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { saveStoreSettings } from './actions';

const THEMES = [
  { key: 'market', name: 'Market Green', colors: ['#0A2E4D', '#12794A', '#E7F4ED'] },
  { key: 'nairobi', name: 'Nairobi Blue', colors: ['#0A2E4D', '#0F5C9E', '#E9F2F9'] },
  { key: 'sundown', name: 'Sundown Amber', colors: ['#0A2E4D', '#B8760B', '#FDF4E3'] },
  { key: 'slate', name: 'Mono Slate', colors: ['#0A2E4D', '#57718A', '#DCE5EC'] },
] as const;

export function SettingsForm({ storeId, initial }: {
  storeId: string;
  initial: {
    name: string; themeKey: string; posEnabled: boolean; slug: string; routingMode: string;
    etimsEnabled: boolean; loyaltyEnabled: boolean; loyaltyPerKes: number;
  };
}) {
  const [name, setName] = useState(initial.name);
  const [themeKey, setThemeKey] = useState(initial.themeKey);
  const [posEnabled, setPosEnabled] = useState(initial.posEnabled);
  const [etimsEnabled, setEtimsEnabled] = useState(initial.etimsEnabled);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(initial.loyaltyEnabled);
  const [loyaltyPerKes, setLoyaltyPerKes] = useState(String(initial.loyaltyPerKes));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null); setSaved(false);
    startTransition(async () => {
      const result = await saveStoreSettings(storeId, {
        name, themeKey, posEnabled, etimsEnabled, loyaltyEnabled,
        loyaltyPerKes: Number(loyaltyPerKes) || 1,
      });
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
    });
  }

  return (
    <div className="settings-card anim-in">
      <div className="field-group">
        <h3>Store details</h3>
        <div className="fld">
          <label className="lab" htmlFor="sname">Store name</label>
          <input className="inp" id="sname" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fld">
          <p className="lab">Web address</p>
          <p className="mono" style={{ fontSize: '.86rem', color: 'var(--tx-2)' }}>
            {initial.routingMode === 'SUBDOMAIN' ? `${initial.slug}.esoqo.com` : `esoqo.com/@${initial.slug}`}
          </p>
        </div>
      </div>

      <div className="field-group">
        <h3>Appearance</h3>
        <p className="lab">Theme</p>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button type="button" key={t.key} className="theme-opt" aria-pressed={themeKey === t.key} onClick={() => setThemeKey(t.key)}>
              <div className="theme-swatch">{t.colors.map((c) => <i key={c} style={{ background: c }} />)}</div>
              <span style={{ fontSize: '.8rem', fontWeight: 700 }}>{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <h3>Add-ons</h3>
        <div className="opt" style={{ cursor: 'default', alignItems: 'flex-start' }}>
          <button type="button" className="toggle" aria-pressed={posEnabled} aria-label="PoS terminal" onClick={() => setPosEnabled((v) => !v)} />
          <div><span className="t">PoS terminal</span><span className="d">Ring up in-person sales, even offline.</span></div>
        </div>
        <div className="opt" style={{ cursor: 'default', alignItems: 'flex-start' }}>
          <button type="button" className="toggle" aria-pressed={etimsEnabled} aria-label="KRA eTIMS" onClick={() => setEtimsEnabled((v) => !v)} />
          <div><span className="t">KRA eTIMS</span><span className="d">Mark receipts as fiscal — needs a real KRA eTIMS device/integration to actually be compliant.</span></div>
        </div>
        <div className="opt" style={{ cursor: 'default', alignItems: 'flex-start' }}>
          <button type="button" className="toggle" aria-pressed={loyaltyEnabled} aria-label="Loyalty points" onClick={() => setLoyaltyEnabled((v) => !v)} />
          <div><span className="t">Loyalty points</span><span className="d">Customers earn points on every sale, at the till and online.</span></div>
        </div>
        {loyaltyEnabled && (
          <div className="fld" style={{ maxWidth: 220 }}>
            <label className="lab" htmlFor="loyrate">Points per KES spent</label>
            <input className="inp mono" id="loyrate" value={loyaltyPerKes} onChange={(e) => setLoyaltyPerKes(e.target.value)} inputMode="numeric" />
          </div>
        )}
      </div>

      {error && <p className="err" role="alert" style={{ marginTop: 4 }}><Icon name="alert-circle" size={14} />{error}</p>}
      {saved && <p style={{ color: 'var(--green)', fontSize: '.85rem', marginTop: 4, fontWeight: 600 }}><Icon name="check" size={14} /> Saved</p>}

      <button type="button" className="btn btn-g" style={{ marginTop: 20 }} onClick={submit} disabled={pending}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}