'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '@/components/RichTextEditor';
import { actionUpdateProfile } from '../../actions';

type Values = { tagline: string; missionShort: string; visionShort: string; aboutUs: string };

/** The About page's own prose — tagline, short mission/vision, and the
 *  long-form About text. Same actionUpdateProfile/updateJamiiPage write
 *  the old Settings screen used for these fields; only moved here so
 *  it's edited from the page that actually shows it. See
 *  OrgProfileForm alongside it for the "At a glance" card, which is a
 *  separate write (different table). */
export function AboutContentForm({ pageId, initial }: { pageId: string; initial: Values }) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function set<K extends keyof Values>(key: K, v: Values[K]) {
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
    <div className="card" style={{ padding: 22, maxWidth: 640, marginBottom: 20 }}>
      <h2 style={{ fontSize: '1.05rem', marginBottom: 14 }}>About content</h2>
      <div className="field"><label htmlFor="about-tagline">Tagline</label><input id="about-tagline" value={values.tagline} onChange={(e) => set('tagline', e.target.value)} /></div>
      <div className="field"><label htmlFor="about-mission">Short mission (for cards)</label><input id="about-mission" value={values.missionShort} onChange={(e) => set('missionShort', e.target.value)} /></div>
      <div className="field"><label htmlFor="about-vision">Short vision</label><input id="about-vision" value={values.visionShort} onChange={(e) => set('visionShort', e.target.value)} placeholder="Inclusive communities where no one is left behind." /></div>
      <div className="field">
        <label htmlFor="about-aboutus">About</label>
        <RichTextEditor value={values.aboutUs} onChange={(html) => set('aboutUs', html)} />
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 10 }}>{error}</p>}
      {saved && !error && <p style={{ color: 'var(--ledger)', fontSize: '.85rem', marginBottom: 10 }}>Saved.</p>}
      <button type="button" className="btn btn-stamp" disabled={pending} onClick={submit}>
        {pending ? 'Saving…' : 'Save about content'}
      </button>
    </div>
  );
}
