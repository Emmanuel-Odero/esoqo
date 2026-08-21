'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { actionUpdateProfile } from '../../actions';

type Values = {
  meetingSchedule: string; contactPhone: string; contactEmail: string; website: string;
  facebook: string; twitter: string; instagram: string; whatsapp: string;
};

/** The Contact page's own details — meeting schedule, phone/email,
 *  website, socials. Same actionUpdateProfile/updateJamiiPage write
 *  the old Settings screen used for these fields; only moved here so
 *  it's edited from the page that actually shows it. */
export function ContactContentForm({ pageId, initial }: { pageId: string; initial: Values }) {
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
      <h2 style={{ fontSize: '1.05rem', marginBottom: 14 }}>Contact details</h2>
      <div className="field"><label htmlFor="contact-schedule">Meeting schedule</label><input id="contact-schedule" value={values.meetingSchedule} onChange={(e) => set('meetingSchedule', e.target.value)} placeholder="Wednesdays, 4pm · Social Hall" /></div>
      <div className="formrow2">
        <div className="field"><label htmlFor="contact-phone">Public phone</label><input id="contact-phone" value={values.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+254 7XX XXX XXX" /></div>
        <div className="field"><label htmlFor="contact-email">Public email</label><input id="contact-email" type="email" value={values.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="contact-website">Website</label><input id="contact-website" value={values.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></div>
      <div className="formrow2">
        <div className="field"><label htmlFor="contact-facebook">Facebook</label><input id="contact-facebook" value={values.facebook} onChange={(e) => set('facebook', e.target.value)} /></div>
        <div className="field"><label htmlFor="contact-twitter">X (Twitter)</label><input id="contact-twitter" value={values.twitter} onChange={(e) => set('twitter', e.target.value)} /></div>
      </div>
      <div className="formrow2">
        <div className="field"><label htmlFor="contact-instagram">Instagram</label><input id="contact-instagram" value={values.instagram} onChange={(e) => set('instagram', e.target.value)} /></div>
        <div className="field"><label htmlFor="contact-whatsapp">WhatsApp</label><input id="contact-whatsapp" value={values.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></div>
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 10 }}>{error}</p>}
      {saved && !error && <p style={{ color: 'var(--ledger)', fontSize: '.85rem', marginBottom: 10 }}>Saved.</p>}
      <button type="button" className="btn btn-stamp" disabled={pending} onClick={submit}>
        {pending ? 'Saving…' : 'Save contact details'}
      </button>
    </div>
  );
}
