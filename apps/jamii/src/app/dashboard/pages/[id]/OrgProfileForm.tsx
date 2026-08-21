'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTIES, JAMII_ORG_KINDS, JAMII_ORG_KIND_LABELS } from '@esoko/domain';
import { actionUpdateOrgProfile } from '../../actions';

type Values = {
  officialName: string; orgKind: string; orgKindOther: string; tags: string;
  county: string; ward: string; registrationNo: string; memberCount: string;
};

/** Organisation identity + the About page's "At a glance" card — org
 *  name, type, focus areas, county/ward, registration number.
 *  Organisation/Party fields, not JamiiPage ones, so this is its own
 *  form/write (actionUpdateOrgProfile) even though it's shown right
 *  alongside AboutContentForm on the same screen. The org name and
 *  focus-area tags show up everywhere (page header, homepage hero,
 *  dashboard topbar) — this is the only place either is editable. */
export function OrgProfileForm({ pageId, initial }: { pageId: string; initial: Values }) {
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
      const result = await actionUpdateOrgProfile(pageId, {
        officialName: values.officialName,
        orgKind: values.orgKind,
        orgKindOther: values.orgKindOther,
        tags: values.tags.split(',').map((t) => t.trim()).filter(Boolean),
        county: values.county,
        ward: values.ward,
        registrationNo: values.registrationNo,
        memberCount: values.memberCount ? Number(values.memberCount) : undefined,
      });
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 22, maxWidth: 640, marginBottom: 20 }}>
      <h2 style={{ fontSize: '1.05rem', marginBottom: 4 }}>Organisation profile</h2>
      <p className="sub" style={{ marginBottom: 14 }}>Your name and "At a glance" card, shown across your public pages.</p>
      <div className="field"><label htmlFor="org-name">Organisation name</label><input id="org-name" value={values.officialName} onChange={(e) => set('officialName', e.target.value)} /></div>
      <div className="field">
        <label htmlFor="org-kind">Organisation type</label>
        <select id="org-kind" value={values.orgKind} onChange={(e) => set('orgKind', e.target.value)}>
          {JAMII_ORG_KINDS.map((k) => <option key={k} value={k}>{JAMII_ORG_KIND_LABELS[k] ?? k}</option>)}
        </select>
      </div>
      {values.orgKind === 'OTHER' && (
        <div className="field">
          <label htmlFor="org-kind-other">What kind of organisation is it?</label>
          <input id="org-kind-other" value={values.orgKindOther} onChange={(e) => set('orgKindOther', e.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="org-tags">Focus areas (comma-separated, optional)</label>
        <input id="org-tags" value={values.tags} placeholder="youth, disability-inclusion, agriculture" onChange={(e) => set('tags', e.target.value)} />
      </div>
      <div className="formrow2">
        <div className="field">
          <label htmlFor="org-county">County</label>
          <select id="org-county" value={values.county} onChange={(e) => set('county', e.target.value)}>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="org-ward">Ward (optional)</label><input id="org-ward" value={values.ward} onChange={(e) => set('ward', e.target.value)} /></div>
      </div>
      <div className="formrow2">
        <div className="field"><label htmlFor="org-regno">Registration number (optional)</label><input id="org-regno" value={values.registrationNo} onChange={(e) => set('registrationNo', e.target.value)} /></div>
        <div className="field"><label htmlFor="org-members">Member count (optional)</label><input id="org-members" type="number" min={1} value={values.memberCount} onChange={(e) => set('memberCount', e.target.value)} /></div>
      </div>
      {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 10 }}>{error}</p>}
      {saved && !error && <p style={{ color: 'var(--ledger)', fontSize: '.85rem', marginBottom: 10 }}>Saved.</p>}
      <button type="button" className="btn btn-stamp" disabled={pending || !values.officialName.trim()} onClick={submit}>
        {pending ? 'Saving…' : 'Save details'}
      </button>
    </div>
  );
}
