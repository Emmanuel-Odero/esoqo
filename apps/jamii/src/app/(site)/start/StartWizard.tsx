'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTIES } from '@esoqo/domain';
import { JAMII_ORG_KINDS, JAMII_ORG_KIND_LABELS } from '@esoqo/domain/jamii-constants';
import { actionStartJamiiPage } from './actions';

function slugify(name: string): string {
  return name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function StartWizard({ signedIn }: { signedIn: boolean }) {
  const [orgKind, setOrgKind] = useState<string>('CBO');
  const [orgKindOther, setOrgKindOther] = useState('');
  const [name, setName] = useState('');
  const [county, setCounty] = useState<string>(COUNTIES[0]);
  const [tagline, setTagline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    if (!signedIn) {
      router.push('/signin?next=/start');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await actionStartJamiiPage({ orgKind, orgKindOther, officialName: name, county, tagline });
      if (!result.ok) { setError(result.error); return; }
      router.push('/dashboard');
      router.refresh();
    });
  }

  return (
    <div className="startwrap">
      <div className="steps3">
        <div className="sdot" data-on="true" />
        <div className="sdot" data-on="true" />
        <div className="sdot" />
      </div>
      <div className="card">
        <p className="kick">Start your page</p>
        <h1>Tell us who you are</h1>
        <p className="sub">This becomes your page&rsquo;s public &ldquo;About&rdquo; section — you can edit it any time.</p>

        <span id="orgTypeLabel" style={{ display: 'block', fontSize: '.8rem', fontWeight: 700, color: 'var(--ink)', marginBottom: 7 }}>
          Organisation type
        </span>
        <div className="radiogroup" role="group" aria-labelledby="orgTypeLabel">
          {JAMII_ORG_KINDS.map((k) => (
            <button key={k} type="button" className="radiochip" aria-pressed={orgKind === k} onClick={() => setOrgKind(k)}>
              {JAMII_ORG_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        {orgKind === 'OTHER' && (
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="orgKindOther">What kind of organisation is it?</label>
            <input id="orgKindOther" value={orgKindOther} onChange={(e) => setOrgKindOther(e.target.value)} />
          </div>
        )}

        <div className="field" style={{ marginTop: 18 }}>
          <label htmlFor="orgName">Organisation name</label>
          <input id="orgName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tumaini Women's Group" />
        </div>
        <div className="field">
          <label htmlFor="county">County</label>
          <select id="county" value={county} onChange={(e) => setCounty(e.target.value)}>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tagline">One-line pitch (optional)</label>
          <input id="tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Table-banking and small enterprise support for our members." />
        </div>
        {name.trim() && (
          <div className="urlpreview">Your page: ourjamii.co.ke/o/<b>{slugify(name) || 'your-organisation'}</b></div>
        )}
        {error && <p style={{ color: 'var(--stamp)', fontSize: '.85rem', marginTop: 14 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26 }}>
          <a href="/" className="btn btn-outline">Back</a>
          <button type="button" className="btn btn-stamp" disabled={pending || !name.trim()} onClick={submit}>
            {pending ? 'Creating…' : signedIn ? 'Create my page' : 'Sign in to continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
