'use client';

import { useState, type RefObject } from 'react';
import { Icon, SelectWithOther } from '@esoko/ui';
import type { Form } from '../form';

// Plain words as both value and label — that's what Form['orgRole']
// stores directly (no separate enum code), and the sentinel here is
// 'Other', not the 'OTHER' convention used elsewhere in the product
// (see WalkInFlow.tsx's admin-side equivalent of this same field).
const ORG_ROLE_OPTIONS = [
  ['Chairperson', 'Chairperson'], ['Treasurer', 'Treasurer'], ['Secretary', 'Secretary'],
  ['Member', 'Member'], ['Other', 'Other'],
] as const;

const WHO_OPTIONS = [
  { v: 'me', icon: 'user', t: 'Myself', d: 'A trader, farmer, rider, fundi or anyone working on their own' },
  { v: 'group', icon: 'users', t: 'A group', d: 'Chama, self-help group, CBO, faith-based group, cooperative or SACCO' },
  { v: 'biz', icon: 'shop', t: 'A business', d: 'Registered or not — either is fine' },
] as const;

/**
 * Step 1 — who's joining, and their name, on one screen.
 *
 * Previously two separate screens: pick "who's joining" (which fired a
 * server call and jumped to a new screen before you'd typed anything),
 * then a second screen for the name. Merged because there's nothing to
 * decide between them — the name fields simply reveal once you've picked.
 *
 * The four picker cards collapse to a compact "X · Change" row once a
 * choice is made, so the name fields stay within the viewport and the
 * user never has to scroll down to reach Continue.
 */
export function WhoAndName({
  f, set, headingRef, orgRoleOther, setOrgRoleOther, errField, onPickJoiningAs,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  orgRoleOther: boolean;
  setOrgRoleOther: (v: boolean) => void;
  errField?: string;
  onPickJoiningAs: (v: Form['joiningAs']) => void;
}) {
  const [browsing, setBrowsing] = useState(f.joiningAs === '');
  const chosen = WHO_OPTIONS.find((o) => o.v === f.joiningAs);
  const qs = !f.joiningAs
    ? 'Who is joining? This decides which forms come next.'
    : f.joiningAs === 'me'
      ? 'A personal membership — your own record, on your own terms.'
      : f.joiningAs === 'group'
        ? 'A group membership, together — one record for the whole group, with one person who signs for it.'
        : 'A business membership, registered with you as its contact person.';

  function pick(v: (typeof WHO_OPTIONS)[number]['v']) {
    onPickJoiningAs(v);
    // Collapse the picker and move focus to the first name field so the
    // revealed fields are both visible and ready.
    setBrowsing(false);
    requestAnimationFrame(() => {
      document.getElementById(v === 'group' ? 'orgRole' : 'officialName')?.focus();
    });
  }

  return (
    <>
      <h2 className="qh" ref={headingRef} tabIndex={-1}>Who's joining, and what's your name?</h2>
      <p className="qs">{qs}</p>

      <div className="opts" style={{ marginBottom: 20 }}>
        {browsing ? (
          WHO_OPTIONS.map((o) => (
            <button key={o.v} type="button" className="opt"
              aria-pressed={f.joiningAs === o.v}
              onClick={() => pick(o.v)}>
              <span className="icbox"><Icon name={o.icon} size={18} /></span>
              <span><span className="t">{o.t}</span><span className="d">{o.d}</span></span>
            </button>
          ))
        ) : (
          chosen && (
            <button type="button" className="opt chosen" onClick={() => setBrowsing(true)}>
              <span className="icbox"><Icon name={chosen.icon} size={18} /></span>
              <span style={{ flex: 1 }}>
                <span className="t">{chosen.t}</span>
                <span className="d">{chosen.d}</span>
              </span>
              <span className="chosen-change">Change</span>
              <Icon name="chevron-down" size={16} />
            </button>
          )
        )}
      </div>

      {f.joiningAs && (
        <div className="sub2">
          {f.joiningAs === 'group' && (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Next you will search for your group — we check first so nobody registers the
                same group twice. If it is not listed yet, you can register it there.
              </p>
              <SelectWithOther
                id="orgRole" label="Your role in the group" otherValue="Other"
                options={ORG_ROLE_OPTIONS}
                value={orgRoleOther ? 'Other' : f.orgRole}
                onChange={(v) => {
                  if (v === 'Other') { setOrgRoleOther(true); set('orgRole', ''); }
                  else { setOrgRoleOther(false); set('orgRole', v); }
                }}
                customValue={f.orgRole} onCustomChange={(v) => set('orgRole', v)}
                customLabel="Your role in the group" customPlaceholder="What the group calls this role"
              />
              <div className="sub2" />
            </>
          )}

          <div className="fld">
            <label className="lab" htmlFor="officialName"><Icon name="user" size={15} />Official name</label>
            <input className="inp" id="officialName" value={f.officialName}
              aria-invalid={errField === 'officialName'}
              aria-describedby="officialName-hint"
              onChange={(e) => set('officialName', e.target.value)}
              placeholder="As written on your ID" autoComplete="name" />
            <p className="hint" id="officialName-hint">
              Used only when a certificate or registration is issued in your name.
            </p>
          </div>
          <div className="fld">
            <label className="lab" htmlFor="knownAs">
              Name people know you by <span className="op">— optional</span>
            </label>
            <input className="inp" id="knownAs" value={f.knownAs}
              aria-describedby="knownAs-hint"
              onChange={(e) => set('knownAs', e.target.value)} placeholder="e.g. Mama Njeri" />
            <p className="hint" id="knownAs-hint">This is what we use in messages and on your record.</p>
          </div>
        </div>
      )}
    </>
  );
}
