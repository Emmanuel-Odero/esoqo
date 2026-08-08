'use client';

import type { RefObject } from 'react';
import { Icon } from '@esoko/ui';
import type { Form } from '../form';

/**
 * Step 1 — who's joining, and their name, on one screen.
 *
 * Previously two separate screens: pick "who's joining" (which fired a
 * server call and jumped to a new screen before you'd typed anything),
 * then a second screen for the name. Merged because there's nothing to
 * decide between them — the name fields simply reveal once you've picked.
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
  return (
    <>
      <h2 className="qh" ref={headingRef} tabIndex={-1}>Who's joining, and what's your name?</h2>
      <p className="qs">This decides what Esoko asks next.</p>

      <div className="opts" style={{ marginBottom: f.joiningAs ? 20 : 0 }}>
        {([
          ['me', 'user', 'Myself', 'A trader, farmer, rider, fundi or anyone working on their own'],
          ['group', 'users', 'A group', 'Chama, self-help group, CBO, faith-based group, cooperative or SACCO'],
          ['biz', 'shop', 'A business', 'Registered or not — either is fine'],
          ['inst', 'gov', 'A bank, county, buyer or agency', 'Institutions are set up by agreement, not through this form'],
        ] as const).map(([v, icon, t, d]) => (
          <button key={v} type="button" className="opt"
            aria-pressed={f.joiningAs === v}
            onClick={() => onPickJoiningAs(v)}>
            <span className="icbox"><Icon name={icon} size={18} /></span>
            <span><span className="t">{t}</span><span className="d">{d}</span></span>
          </button>
        ))}
      </div>

      {f.joiningAs && f.joiningAs !== 'inst' && (
        <div className="sub2">
          {f.joiningAs === 'group' && (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Next you will search for your group — Esoko checks first so nobody registers the
                same group twice. If it is not listed yet, you can register it there.
              </p>
              <div className="fld">
                <label className="lab" htmlFor="orgRole">Your role in the group</label>
                <select className="inp" id="orgRole" value={orgRoleOther ? 'Other' : f.orgRole}
                  onChange={(e) => {
                    if (e.target.value === 'Other') { setOrgRoleOther(true); set('orgRole', ''); }
                    else { setOrgRoleOther(false); set('orgRole', e.target.value); }
                  }}>
                  <option>Chairperson</option><option>Treasurer</option>
                  <option>Secretary</option><option>Member</option>
                  <option>Other</option>
                </select>
                {orgRoleOther && (
                  <input className="inp" style={{ marginTop: 8 }} value={f.orgRole} maxLength={40}
                    onChange={(e) => set('orgRole', e.target.value)}
                    placeholder="What the group calls this role" />
                )}
              </div>
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
            <p className="hint" id="knownAs-hint">This is what Esoko uses in messages and on your record.</p>
          </div>
        </div>
      )}
    </>
  );
}
