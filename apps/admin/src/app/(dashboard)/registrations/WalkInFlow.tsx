'use client';

import { useState, useTransition } from 'react';
import { Icon, SelectWithOther } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionCreateWalkIn } from './actions';

type Step = 'joining' | 'personal' | 'contact' | 'work' | 'standing' | 'preferences' | 'review';

interface FormData {
  joiningAs: 'me' | 'group' | 'biz';
  officialName: string;
  knownAs: string;
  msisdn: string;
  email: string;
  county: string;
  ward: string;
  workRaw: string;
  orgName: string;
  orgKnownAs: string;
  orgRole: string;
  memberCount: string;
  hasRegisteredBusiness: string;
  registrationNo: string;
  belongsToGroup: string;
  groupName: string;
  hasKraPin: string;
  wantsPriceSms: boolean;
  wantsReceiptSms: boolean;
  wantsExpirySms: boolean;
  ussdSetupChoice: 'now' | 'later' | '';
}

const INIT: FormData = {
  joiningAs: 'me',
  officialName: '', knownAs: '', msisdn: '+254 7', email: '',
  county: '', ward: '', workRaw: '',
  orgName: '', orgKnownAs: '', orgRole: '', memberCount: '',
  hasRegisteredBusiness: '', registrationNo: '',
  belongsToGroup: '', groupName: '', hasKraPin: '',
  wantsPriceSms: false, wantsReceiptSms: true, wantsExpirySms: true,
  ussdSetupChoice: '',
};

const STEPS: { key: Step; label: string }[] = [
  { key: 'joining', label: 'Joining as' },
  { key: 'personal', label: 'Personal info' },
  { key: 'contact', label: 'Contact' },
  { key: 'work', label: 'Work' },
  { key: 'standing', label: 'Standing' },
  { key: 'preferences', label: 'Preferences' },
  { key: 'review', label: 'Review' },
];

export default function WalkInFlow({
  counties, onClose,
}: { counties: string[]; onClose: () => void }) {
  const [step, setStep] = useState<Step>('joining');
  const [f, setF] = useState<FormData>({ ...INIT, county: counties[0] ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const idx = STEPS.findIndex((s) => s.key === step);

  function update(k: keyof FormData, v: string | boolean) {
    setF((p) => ({ ...p, [k]: v }));
  }

  function next() {
    setError(null);
    const n = STEPS[idx + 1];
    if (n) setStep(n.key as Step);
  }

  function prev() {
    setError(null);
    const p = STEPS[idx - 1];
    if (p) setStep(p.key as Step);
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await actionCreateWalkIn({
        joiningAs: f.joiningAs,
        officialName: f.officialName,
        knownAs: f.knownAs || undefined,
        msisdn: f.msisdn,
        email: f.email || undefined,
        county: f.county,
        ward: f.ward || undefined,
        workRaw: f.workRaw || undefined,
        orgName: f.joiningAs === 'group' ? f.orgName || undefined : undefined,
        orgKnownAs: f.orgKnownAs || undefined,
        orgRole: f.orgRole || undefined,
        memberCount: f.memberCount ? Number(f.memberCount) : undefined,
        hasRegisteredBusiness: f.hasRegisteredBusiness || undefined,
        registrationNo: f.registrationNo || undefined,
        belongsToGroup: f.belongsToGroup || undefined,
        groupName: f.groupName || undefined,
        hasKraPin: f.hasKraPin || undefined,
        wantsPriceSms: f.wantsPriceSms,
        wantsReceiptSms: f.wantsReceiptSms,
        wantsExpirySms: f.wantsExpirySms,
        ussdSetupChoice: f.ussdSetupChoice || undefined,
      });
      if (r.ok) { announce('Walk-in registration created', 'assertive'); onClose(); }
      else setError(r.error);
    });
  }

  return (
    <div className="scrim" role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 580 }} role="dialog" aria-modal="true" aria-labelledby="wi-title">
        <div className="modal-hd">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {step !== 'joining' && (
              <button className="btn btn-o btn-sm" onClick={prev} aria-label="Previous step">
                <Icon name="arrow-left" size={15} />
              </button>
            )}
            <div>
              <h2 id="wi-title" style={{ margin: 0 }}>Add walk-in</h2>
              <p className="sub" style={{ margin: '2px 0 0' }}>Step {idx + 1} of {STEPS.length} — {STEPS[idx]?.label}</p>
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '0 24px', background: 'var(--bg-2)' }}>
          {STEPS.map((s, i) => (
            <div key={s.key} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i <= idx ? 'var(--green)' : 'var(--line)',
              transition: 'background .2s',
            }} />
          ))}
        </div>

        <div className="modal-bd">
          {step === 'joining' && <JoiningStep f={f} update={update} />}
          {step === 'personal' && <PersonalStep f={f} update={update} />}
          {step === 'contact' && <ContactStep f={f} update={update} counties={counties} />}
          {step === 'work' && <WorkStep f={f} update={update} />}
          {step === 'standing' && <StandingStep f={f} update={update} />}
          {step === 'preferences' && <PreferencesStep f={f} update={update} />}
          {step === 'review' && <ReviewStep f={f} />}

          {error && (
            <p className="pill p-bad" style={{ marginTop: 14, padding: '10px 13px' }} role="alert">
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}
        </div>

        <div className="modal-ft">
          <button className="btn btn-o" onClick={onClose}>Cancel</button>
          {step !== 'review' ? (
            <button className="btn btn-p" onClick={next}
              disabled={!canProceed(step, f)}>
              Next<Icon name="arrow-right" size={15} />
            </button>
          ) : (
            <button className="btn btn-p" onClick={submit} disabled={pending}>
              <Icon name="plus" size={15} />Create registration
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function canProceed(step: Step, f: FormData): boolean {
  switch (step) {
    case 'joining': return true;
    case 'personal': return f.officialName.trim().length > 0;
    case 'contact': return f.msisdn.trim().length >= 10 && f.county.length > 0;
    case 'work': return true;
    case 'standing': return true;
    case 'preferences': return true;
    default: return true;
  }
}

/* ─────────────────── step 1: joining as ─────────────────── */

function JoiningStep({ f, update }: { f: FormData; update: (k: keyof FormData, v: string | boolean) => void }) {
  return (
    <div>
      <p style={{ marginBottom: 20 }}>Who is registering today?</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {([
          ['me', 'An individual', 'A person registering for themselves'],
          ['group', 'A group', 'A chama, self-help group, SACCO, or cooperative'],
          ['biz', 'A business', 'A sole trader, company, or other business entity'],
        ] as const).map(([val, title, desc]) => (
          <label key={val} aria-label={title} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 10,
            border: `2px solid ${f.joiningAs === val ? 'var(--green)' : 'var(--line)'}`,
            cursor: 'pointer', transition: 'border .15s',
          }}>
            <input type="radio" name="joiningAs" value={val} checked={f.joiningAs === val}
              onChange={() => update('joiningAs', val)} style={{ accentColor: 'var(--green)' }} />
            <div>
              <strong style={{ display: 'block' }}>{title}</strong>
              <span className="sub">{desc}</span>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────── step 2: personal ─────────────────── */

const ORG_ROLE_OPTIONS = [
  ['', 'Select role…'], ['CHAIRPERSON', 'Chairperson'], ['TREASURER', 'Treasurer'],
  ['SECRETARY', 'Secretary'], ['MEMBER', 'Member'], ['OTHER', 'Other'],
] as const;
const FIXED_ORG_ROLES = new Set(['CHAIRPERSON', 'TREASURER', 'SECRETARY', 'MEMBER']);

function PersonalStep({ f, update }: { f: FormData; update: (k: keyof FormData, v: string | boolean) => void }) {
  // f.orgRole doubles as both the picked fixed role AND the free text
  // once "Other" is chosen — there's no separate customRole field on
  // this form, unlike Membership.role/customRole elsewhere, so this
  // local state bridges that single field to SelectWithOther's
  // two-piece (value + customValue) model.
  const [orgRoleOther, setOrgRoleOther] = useState(Boolean(f.orgRole) && !FIXED_ORG_ROLES.has(f.orgRole));
  const roleValue = orgRoleOther ? 'OTHER' : f.orgRole;
  const customRoleValue = orgRoleOther ? f.orgRole : '';

  function handleRoleChange(next: string) {
    if (next === 'OTHER') { setOrgRoleOther(true); update('orgRole', ''); }
    else { setOrgRoleOther(false); update('orgRole', next); }
  }

  return (
    <div>
      <p className="sub" style={{ marginBottom: 16 }}>Full name as it appears on their national ID.</p>

      <div style={{ marginBottom: 14 }}>
        <label className="sub" htmlFor="wi-officialName" style={{ display: 'block', marginBottom: 6 }}>Official name *</label>
        <input id="wi-officialName" className="inp" style={{ width: '100%' }}
          value={f.officialName} placeholder="As written on their ID"
          onChange={(e) => update('officialName', e.target.value)} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="sub" htmlFor="wi-knownAs" style={{ display: 'block', marginBottom: 6 }}>Known as (optional)</label>
        <input id="wi-knownAs" className="inp" style={{ width: '100%' }}
          value={f.knownAs} placeholder="e.g. Mama Njeri"
          onChange={(e) => update('knownAs', e.target.value)} />
      </div>

      {f.joiningAs === 'group' && (
        <>
          <h3 style={{ margin: '20px 0 12px', fontSize: '.95rem' }}>Group details</h3>
          <div style={{ marginBottom: 14 }}>
            <label className="sub" htmlFor="wi-orgName" style={{ display: 'block', marginBottom: 6 }}>Group name *</label>
            <input id="wi-orgName" className="inp" style={{ width: '100%' }}
              value={f.orgName} placeholder="Name of the chama, SACCO or group"
              onChange={(e) => update('orgName', e.target.value)} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="sub" htmlFor="wi-orgKnownAs" style={{ display: 'block', marginBottom: 6 }}>Known as (optional)</label>
            <input id="wi-orgKnownAs" className="inp" style={{ width: '100%' }}
              value={f.orgKnownAs} placeholder="Short name the group is called by"
              onChange={(e) => update('orgKnownAs', e.target.value)} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="sub" htmlFor="wi-orgRole" style={{ display: 'block', marginBottom: 6 }}>Their role in the group</label>
            <SelectWithOther
              id="wi-orgRole" bare options={ORG_ROLE_OPTIONS}
              value={roleValue} onChange={handleRoleChange}
              customValue={customRoleValue} onCustomChange={(v) => update('orgRole', v)}
              customPlaceholder="What the group calls this role"
              selectProps={{ style: { width: '100%' } }}
              inputProps={{ style: { width: '100%', marginTop: 8 }, maxLength: 40 }}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="sub" htmlFor="wi-memberCount" style={{ display: 'block', marginBottom: 6 }}>How many members in the group?</label>
            <input id="wi-memberCount" className="inp" type="number" min="1" style={{ width: '100%' }}
              value={f.memberCount} placeholder="e.g. 15"
              onChange={(e) => update('memberCount', e.target.value)} />
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────── step 3: contact ─────────────────── */

function ContactStep({ f, update, counties }: { f: FormData; update: (k: keyof FormData, v: string | boolean) => void; counties: string[] }) {
  return (
    <div>
      <p className="sub" style={{ marginBottom: 16 }}>How to reach them. The phone number is their primary identifier on Esoqo.</p>

      <div style={{ marginBottom: 14 }}>
        <label className="sub" htmlFor="wi-msisdn" style={{ display: 'block', marginBottom: 6 }}>Phone number *</label>
        <input id="wi-msisdn" className="inp mono" style={{ width: '100%' }}
          value={f.msisdn} placeholder="07XX XXX XXX"
          onChange={(e) => update('msisdn', e.target.value)} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="sub" htmlFor="wi-email" style={{ display: 'block', marginBottom: 6 }}>Email address (optional)</label>
        <input id="wi-email" className="inp" type="email" style={{ width: '100%' }}
          value={f.email} placeholder="person@example.com"
          onChange={(e) => update('email', e.target.value)} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="sub" htmlFor="wi-county" style={{ display: 'block', marginBottom: 6 }}>County *</label>
        <select id="wi-county" className="inp" style={{ width: '100%' }} value={f.county}
          onChange={(e) => update('county', e.target.value)}>
          {counties.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="sub" htmlFor="wi-ward" style={{ display: 'block', marginBottom: 6 }}>Ward or market (optional)</label>
        <input id="wi-ward" className="inp" style={{ width: '100%' }}
          value={f.ward} placeholder="e.g. Wakulima market, Kangemi"
          onChange={(e) => update('ward', e.target.value)} />
      </div>
    </div>
  );
}

/* ─────────────────── step 4: work ─────────────────── */

function WorkStep({ f, update }: { f: FormData; update: (k: keyof FormData, v: string | boolean) => void }) {
  return (
    <div>
      <p className="sub" style={{ marginBottom: 16 }}>What do they do for a living? This helps us understand which services are relevant.</p>

      <div style={{ marginBottom: 14 }}>
        <label className="sub" htmlFor="wi-workRaw" style={{ display: 'block', marginBottom: 6 }}>What they do</label>
        <input id="wi-workRaw" className="inp" style={{ width: '100%' }}
          value={f.workRaw} placeholder="carpentry, mama mboga, boda boda, farming…"
          onChange={(e) => update('workRaw', e.target.value)} />
      </div>
    </div>
  );
}

/* ─────────────────── step 5: standing ─────────────────── */

function StandingStep({ f, update }: { f: FormData; update: (k: keyof FormData, v: string | boolean) => void }) {
  return (
    <div>
      <p className="sub" style={{ marginBottom: 16 }}>
        Tell us about their current business and registration status.
      </p>

      <div style={{ marginBottom: 14 }}>
        <label className="sub" htmlFor="wi-hasRegisteredBusiness" style={{ display: 'block', marginBottom: 6 }}>Do they have a registered business?</label>
        <select id="wi-hasRegisteredBusiness" className="inp" style={{ width: '100%' }} value={f.hasRegisteredBusiness}
          onChange={(e) => update('hasRegisteredBusiness', e.target.value)}>
          <option value="">Select…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="soon">Planning to register</option>
        </select>
      </div>

      {f.hasRegisteredBusiness === 'yes' && (
        <div style={{ marginBottom: 14 }}>
          <label className="sub" htmlFor="wi-registrationNo" style={{ display: 'block', marginBottom: 6 }}>Business registration number</label>
          <input id="wi-registrationNo" className="inp" style={{ width: '100%' }}
            value={f.registrationNo} placeholder="e.g. BRS/PY4L4VK9"
            onChange={(e) => update('registrationNo', e.target.value)} />
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label className="sub" htmlFor="wi-hasKraPin" style={{ display: 'block', marginBottom: 6 }}>Do they have a KRA PIN?</label>
        <select id="wi-hasKraPin" className="inp" style={{ width: '100%' }} value={f.hasKraPin}
          onChange={(e) => update('hasKraPin', e.target.value)}>
          <option value="">Select…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="applied">Applied for one</option>
        </select>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="sub" style={{ display: 'block', marginBottom: 6 }}>
          {f.joiningAs === 'group' ? 'Is this group part of a larger group or network?' : 'Are they a member of a group?'}
        </label>
        <select className="inp" style={{ width: '100%' }} value={f.belongsToGroup}
          onChange={(e) => update('belongsToGroup', e.target.value)}>
          <option value="">Select…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>

      {f.belongsToGroup === 'yes' && (
        <div style={{ marginBottom: 14 }}>
          <label className="sub" htmlFor="wi-groupName" style={{ display: 'block', marginBottom: 6 }}>Group name</label>
          <input id="wi-groupName" className="inp" style={{ width: '100%' }}
            value={f.groupName} placeholder="Name of the group"
            onChange={(e) => update('groupName', e.target.value)} />
        </div>
      )}
    </div>
  );
}

/* ─────────────────── step 6: preferences ─────────────────── */

function PreferencesStep({ f, update }: { f: FormData; update: (k: keyof FormData, v: string | boolean) => void }) {
  return (
    <div>
      <p className="sub" style={{ marginBottom: 16 }}>
        What would they like Esoqo to send them?
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        {([
          ['wantsPriceSms', 'Morning price alerts', 'Daily SMS with market prices for their products'],
          ['wantsReceiptSms', 'Payment receipts', 'SMS confirmation when a payment is recorded'],
          ['wantsExpirySms', 'Certificate expiry warnings', 'Reminder before their permits or licences expire'],
        ] as const).map(([k, title, desc]) => (
          <label key={k} aria-label={title} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 8,
            border: `1.5px solid ${f[k as keyof FormData] ? 'var(--green)' : 'var(--line)'}`,
            cursor: 'pointer',
          }}>
            <input type="checkbox" checked={!!f[k as keyof FormData]}
              onChange={(e) => update(k as keyof FormData, e.target.checked)}
              style={{ accentColor: 'var(--green)' }} />
            <div>
              <strong style={{ display: 'block', fontSize: '.9rem' }}>{title}</strong>
              <span className="sub" style={{ fontSize: '.8rem' }}>{desc}</span>
            </div>
          </label>
        ))}
      </div>

      <div>
        <label className="sub" htmlFor="wi-ussdSetupChoice" style={{ display: 'block', marginBottom: 6 }}>
          Would they like to set up USSD dialling access now?
        </label>
        <p className="sub" style={{ fontSize: '.8rem', marginBottom: 10 }}>
          USSD lets them check prices, balances, and certificates from any phone without internet.
        </p>
        <select id="wi-ussdSetupChoice" className="inp" style={{ width: '100%' }} value={f.ussdSetupChoice}
          onChange={(e) => update('ussdSetupChoice', e.target.value as 'now' | 'later' | '')}>
          <option value="">Select…</option>
          <option value="now">Set up now — we will send instructions</option>
          <option value="later">Do it later — they can set up from their profile</option>
        </select>
      </div>
    </div>
  );
}

/* ─────────────────── step 7: review ─────────────────── */

function ReviewStep({ f }: { f: FormData }) {
  const items: [string, string][] = [
    ['Joining as', f.joiningAs === 'me' ? 'Individual' : f.joiningAs === 'group' ? 'Group' : 'Business'],
    ['Official name', f.officialName],
  ];
  if (f.knownAs) items.push(['Known as', f.knownAs]);
  if (f.orgName) items.push(['Group name', f.orgName]);
  if (f.orgRole) items.push(['Role', f.orgRole]);
  if (f.memberCount) items.push(['Group members', f.memberCount]);
  items.push(
    ['Phone', f.msisdn],
  );
  if (f.email) items.push(['Email', f.email]);
  items.push(['County', f.county]);
  if (f.ward) items.push(['Ward', f.ward]);
  if (f.workRaw) items.push(['Work', f.workRaw]);
  if (f.hasRegisteredBusiness) items.push(['Registered business', f.hasRegisteredBusiness === 'yes' ? 'Yes' : f.hasRegisteredBusiness === 'no' ? 'No' : 'Planning to']);
  if (f.registrationNo) items.push(['Registration no.', f.registrationNo]);
  if (f.hasKraPin) items.push(['KRA PIN', f.hasKraPin]);
  if (f.belongsToGroup) items.push(['In a group', f.belongsToGroup === 'yes' ? (f.groupName || 'Yes') : 'No']);
  items.push(
    ['Price alerts', f.wantsPriceSms ? 'Yes' : 'No'],
    ['Receipts', f.wantsReceiptSms ? 'Yes' : 'No'],
    ['Expiry warnings', f.wantsExpirySms ? 'Yes' : 'No'],
  );
  if (f.ussdSetupChoice) items.push(['USSD', f.ussdSetupChoice === 'now' ? 'Set up now' : 'Later']);

  return (
    <div>
      <p className="sub" style={{ marginBottom: 16 }}>
        Review the details before creating the registration. The person will still need to verify their phone number to complete the process.
      </p>

      <table className="tbl">
        <tbody>
          {items.filter(([, v]) => v).map(([k, v]) => (
            <tr key={k}><td className="sub" style={{ width: 170 }}>{k}</td><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
