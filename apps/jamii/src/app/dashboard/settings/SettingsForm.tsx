'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actionUpdateProfile } from '../actions';

type Profile = {
  brandAccent: string; brandAccentTwo: string; brandAccentThree: string;
  themeDefaultMode: 'DARK' | 'LIGHT';
  seoTitle: string; seoDescription: string;
};

/** Matches the whitelabel theme's own defaults (jamii.css's .wl-theme
 *  block) — shown as the swatch colour when an org hasn't picked their
 *  own, so the picker never looks blank. */
const DEFAULT_SWATCH = { brandAccent: '#D81E56', brandAccentTwo: '#0E7F9C', brandAccentThree: '#B8720F' } as const;

/** Core settings only — appearance and the org-wide SEO fallback.
 *  About/Contact/FAQ content moved to their own pages under Dashboard
 *  -> Pages, each edited from the screen that actually shows it; see
 *  AboutContentForm/ContactContentForm/FaqEditor there. */
export function SettingsForm({ pageId, initial }: { pageId: string; initial: Profile }) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function set<K extends keyof Profile>(key: K, v: Profile[K]) {
    setValues((p) => ({ ...p, [key]: v }));
    setSaved(false);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await actionUpdateProfile(pageId, values);
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640 }}>
      <h3 style={{ fontSize: '.92rem', color: 'var(--ink)', margin: '0 0 6px' }}>Custom domain theme</h3>
      <p style={{ fontSize: '.8rem', color: '#8a8368', margin: '0 0 14px' }}>
        Only shown on your own domain, never on your ourjamii.co.ke page. One colour is enough to
        feel intentional; the other two are optional accents.
      </p>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
        {([
          ['brandAccent', 'Primary', DEFAULT_SWATCH.brandAccent],
          ['brandAccentTwo', 'Secondary', DEFAULT_SWATCH.brandAccentTwo],
          ['brandAccentThree', 'Tertiary', DEFAULT_SWATCH.brandAccentThree],
        ] as const).map(([key, label, fallback]) => (
          <div key={key} className="field" style={{ flex: '0 0 auto' }}>
            <label htmlFor={key}>{label}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color" id={key} value={values[key] || fallback}
                onChange={(e) => set(key, e.target.value)}
                style={{ width: 40, height: 36, padding: 2, border: '1px solid #ddd6c4', borderRadius: 8, cursor: 'pointer' }}
              />
              {values[key] && (
                <button type="button" className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '.72rem' }}
                  onClick={() => set(key, '')}>
                  Use default
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor="themeDefaultMode">Default appearance</label>
        <select
          id="themeDefaultMode" value={values.themeDefaultMode}
          onChange={(e) => set('themeDefaultMode', e.target.value as 'DARK' | 'LIGHT')}
        >
          <option value="DARK">Dark</option>
          <option value="LIGHT">Light</option>
        </select>
        <p style={{ fontSize: '.78rem', color: '#8a8368', margin: '6px 0 0' }}>
          What a first-time visitor sees — they can switch it themselves from there, and their
          choice is remembered on their own device from then on.
        </p>
      </div>

      <h3 style={{ fontSize: '.92rem', color: 'var(--ink)', margin: '22px 0 6px' }}>SEO</h3>
      <p style={{ fontSize: '.8rem', color: '#8a8368', margin: '0 0 14px' }}>
        The site-wide fallback — used for any page that doesn&rsquo;t have its own SEO title/
        description set. Optional; only set these if the auto-built version (from your name and
        mission) isn&rsquo;t right.
      </p>
      <div className="field"><label htmlFor="seoTitle">Search title override</label><input id="seoTitle" value={values.seoTitle} maxLength={70} onChange={(e) => set('seoTitle', e.target.value)} /></div>
      <div className="field"><label htmlFor="seoDescription">Search description override</label><textarea id="seoDescription" rows={2} maxLength={160} value={values.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} /></div>

      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 10 }}>{error}</p>}
      {saved && !error && <p style={{ color: 'var(--ledger)', fontSize: '.85rem', marginBottom: 10 }}>Saved.</p>}
      <button type="button" className="btn btn-stamp" disabled={pending} onClick={submit}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
