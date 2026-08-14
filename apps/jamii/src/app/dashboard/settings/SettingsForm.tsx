'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actionUpdateProfile } from '../actions';

type Profile = {
  tagline: string; missionShort: string; aboutUs: string; meetingSchedule: string;
  contactEmail: string; contactPhone: string; website: string;
  facebook: string; instagram: string; twitter: string; whatsapp: string;
};

export function SettingsForm({ pageId, initial }: { pageId: string; initial: Profile }) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function set<K extends keyof Profile>(key: K, v: string) {
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
      <div className="field"><label htmlFor="tagline">Tagline</label><input id="tagline" value={values.tagline} onChange={(e) => set('tagline', e.target.value)} /></div>
      <div className="field"><label htmlFor="missionShort">Short mission (for cards)</label><input id="missionShort" value={values.missionShort} onChange={(e) => set('missionShort', e.target.value)} /></div>
      <div className="field"><label htmlFor="aboutUs">About</label><textarea id="aboutUs" rows={6} value={values.aboutUs} onChange={(e) => set('aboutUs', e.target.value)} /></div>
      <div className="field"><label htmlFor="meetingSchedule">Meeting schedule</label><input id="meetingSchedule" value={values.meetingSchedule} onChange={(e) => set('meetingSchedule', e.target.value)} placeholder="Wednesdays, 4pm · Social Hall" /></div>
      <div className="formrow2">
        <div className="field"><label htmlFor="contactPhone">Public phone</label><input id="contactPhone" value={values.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+254 7XX XXX XXX" /></div>
        <div className="field"><label htmlFor="contactEmail">Public email</label><input id="contactEmail" type="email" value={values.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="website">Website</label><input id="website" value={values.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></div>
      <div className="formrow2">
        <div className="field"><label htmlFor="facebook">Facebook</label><input id="facebook" value={values.facebook} onChange={(e) => set('facebook', e.target.value)} /></div>
        <div className="field"><label htmlFor="twitter">X (Twitter)</label><input id="twitter" value={values.twitter} onChange={(e) => set('twitter', e.target.value)} /></div>
      </div>
      <div className="formrow2">
        <div className="field"><label htmlFor="instagram">Instagram</label><input id="instagram" value={values.instagram} onChange={(e) => set('instagram', e.target.value)} /></div>
        <div className="field"><label htmlFor="whatsapp">WhatsApp</label><input id="whatsapp" value={values.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></div>
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 10 }}>{error}</p>}
      {saved && !error && <p style={{ color: 'var(--ledger)', fontSize: '.85rem', marginBottom: 10 }}>Saved.</p>}
      <button type="button" className="btn btn-stamp" disabled={pending} onClick={submit}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
