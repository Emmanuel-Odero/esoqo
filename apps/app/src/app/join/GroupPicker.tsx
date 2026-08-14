'use client';

import { useRef, useState, useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';
import { JOINABLE_GROUP_KINDS, ORG_KINDS, SEGMENTS, searchSegments } from '@esoko/domain';
import { actionCheckGroupMembership, actionSearchGroups } from './actions';
import { SearchCombobox } from './SearchCombobox';
import type { Form } from './form';

interface GroupHit { id: string; name: string; county: string }

const ORG_KIND_LABELS: Record<string, string> = {
  CHAMA: 'Chama', SELF_HELP_GROUP: 'Self-help group', TABLE_BANKING: 'Table banking',
  WELFARE_GROUP: 'Welfare group', CBO: 'Community-based organisation', FBO: 'Faith-based organisation',
  COOPERATIVE: 'Cooperative', SACCO: 'SACCO', NGO: 'NGO', SCHOOL: 'School', CLINIC: 'Clinic',
  MARKET_ASSOCIATION: 'Market association', OTHER: 'Other',
};
void ORG_KINDS; // kept for reference — the label map above must cover every JOINABLE_GROUP_KINDS entry

/**
 * Search-before-create for a group, plus the private "am I already
 * listed?" check — used both when joiningAs is 'group' (mandatory: you
 * must end up either linked to an existing group or having registered a
 * new one) and when an individual/business says they belong to a group
 * (optional, gated by the caller on belongsToGroup === 'yes'). One
 * implementation either way, per the request to merge this into
 * something reusable rather than building it twice.
 */
export function GroupPicker({
  f, set,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
}) {
  const announce = useAnnounce();
  const [pending, start] = useTransition();
  const [registeringNew, setRegisteringNew] = useState(Boolean(f.orgKind));
  const [checkName, setCheckName] = useState('');
  const [checkMsisdn, setCheckMsisdn] = useState('');
  const [checkResult, setCheckResult] = useState<'matched' | 'unmatched' | null>(null);
  const [tagHits, setTagHits] = useState<{ key: string; name: string }[]>([]);
  const [tagQuery, setTagQuery] = useState('');
  const [groupHits, setGroupHits] = useState<GroupHit[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function onGroupInput(v: string) {
    set('groupName', v);
    set('groupPartyId', '');
    clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setGroupHits([]); return; }
    searchTimer.current = setTimeout(async () => {
      const res = await actionSearchGroups(v);
      setGroupHits(res);
      announce(res.length ? `${res.length} matching groups` : 'No match — you can register it');
    }, 200);
  }

  function pickExisting(g: GroupHit) {
    set('groupName', g.name);
    set('groupPartyId', g.id);
    // Picking a real group clears any in-progress "register new" answers —
    // they no longer apply once we're linking instead of founding.
    set('orgName', ''); set('orgKind', ''); set('orgKnownAs', '');
    setRegisteringNew(false);
    setCheckResult(null);
  }

  function startNewGroup(typedName: string) {
    set('groupPartyId', '');
    set('orgName', typedName);
    setRegisteringNew(true);
  }

  function checkMembership() {
    if (!f.groupPartyId) return;
    start(async () => {
      const r = await actionCheckGroupMembership({
        groupPartyId: f.groupPartyId, name: checkName || undefined, msisdn: checkMsisdn || undefined,
      });
      if (!r.ok) { announce(r.error, 'assertive'); return; }
      setCheckResult(r.data.matched ? 'matched' : 'unmatched');
      announce(r.data.matched
        ? "You're already on this group's list."
        : "Not listed yet — you'll be registered as a new member.", 'assertive');
    });
  }

  function onTagInput(v: string) {
    setTagQuery(v);
    if (v.trim().length < 2) { setTagHits([]); return; }
    setTagHits(searchSegments(v, 5).map((s) => ({ key: s.key, name: s.name })));
  }

  function toggleTag(key: string) {
    set('orgTags', f.orgTags.includes(key) ? f.orgTags.filter((t) => t !== key) : [...f.orgTags, key].slice(0, 6));
  }

  return (
    <div>
      {!f.groupPartyId && !registeringNew && (
        <SearchCombobox<GroupHit>
          id="groupSearch" label="Name of the group" icon="users"
          value={f.groupName} onInputChange={onGroupInput}
          placeholder="Search first — avoid registering it twice"
          hits={groupHits} getKey={(g) => g.id} isSelected={(g) => f.groupPartyId === g.id}
          onSelect={pickExisting}
          renderHit={(g) => <span>{g.name} <span className="op">— {g.county}</span></span>}
          hint="We check for a match by name so the same group is never registered twice."
          noMatchLabel={(typed) => `"${typed}" isn't listed — register it`}
          onNoMatchSelect={startNewGroup}
        />
      )}

      {f.groupPartyId && !registeringNew && (
        <div className="vblock" style={{ marginBottom: 14 }}>
          <div className="vhead">
            <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
              <Icon name="check-circle" size={17} />
            </span>
            <div style={{ flex: 1 }}>
              <strong>{f.groupName}</strong>
              <span style={{ fontSize: '.86rem', color: 'var(--tx-2)', display: 'block' }}>Linked</span>
            </div>
            <button type="button" className="btn btn-o" style={{ minHeight: 34, padding: '6px 12px', fontSize: '.84rem' }}
              onClick={() => { set('groupPartyId', ''); set('groupName', ''); setCheckResult(null); }}>
              Change
            </button>
          </div>

          <div className="sub2" style={{ marginTop: 14 }}>
            <p className="lab" style={{ marginBottom: 8 }}>Check if you're already listed</p>
            <div className="fld">
              <label className="lab" htmlFor="checkName">Your name</label>
              <input className="inp" id="checkName" value={checkName}
                onChange={(e) => setCheckName(e.target.value)} placeholder="As it might appear on the list" />
            </div>
            <div className="fld">
              <label className="lab" htmlFor="checkMsisdn">Or your phone number <span className="op">— optional</span></label>
              <input className="inp mono" id="checkMsisdn" value={checkMsisdn} inputMode="tel"
                onChange={(e) => setCheckMsisdn(e.target.value)} placeholder="+254 7…" />
            </div>
            <button type="button" className="btn btn-o" onClick={checkMembership}
              disabled={pending || (!checkName.trim() && !checkMsisdn.trim())}>
              <Icon name="search" size={15} />Check
            </button>

            {checkResult === 'matched' && (
              <p className="hint" style={{ color: 'var(--green)', marginTop: 10 }}>
                <Icon name="check-circle" size={14} /> You're already on this group's list — finish
                below and we will connect your record to it.
              </p>
            )}
            {checkResult === 'unmatched' && (
              <p className="hint" style={{ marginTop: 10 }}>
                Not listed yet — that's fine. Finish below and you'll be registered as a new member.
              </p>
            )}
          </div>
        </div>
      )}

      {registeringNew && (
        <div className="sub2">
          <div className="fld">
            <label className="lab" htmlFor="orgName2">Official name of the group</label>
            <input className="inp" id="orgName2" value={f.orgName}
              onChange={(e) => set('orgName', e.target.value)}
              placeholder="As registered, or as it will be registered" />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="orgKnownAs2">What people call it <span className="op">— optional</span></label>
            <input className="inp" id="orgKnownAs2" value={f.orgKnownAs}
              onChange={(e) => set('orgKnownAs', e.target.value)} placeholder="e.g. Tumaini Ladies" />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="orgKind">Type of group</label>
            <select className="inp" id="orgKind" value={f.orgKind}
              onChange={(e) => set('orgKind', e.target.value)}>
              <option value="">Choose one</option>
              {JOINABLE_GROUP_KINDS.map((k) => <option key={k} value={k}>{ORG_KIND_LABELS[k] ?? k}</option>)}
            </select>
          </div>
          <div className="sub2">
            <div className="fld">
              <label className="lab" htmlFor="orgSubCounty">Sub-county <span className="op">— optional</span></label>
              <input className="inp" id="orgSubCounty" value={f.orgSubCounty}
                onChange={(e) => set('orgSubCounty', e.target.value)} />
            </div>
            <div className="fld">
              <label className="lab" htmlFor="orgDistrict">District <span className="op">— optional</span></label>
              <input className="inp" id="orgDistrict" value={f.orgDistrict}
                onChange={(e) => set('orgDistrict', e.target.value)} placeholder="If your paperwork uses one" />
            </div>
          </div>

          <SearchCombobox<{ key: string; name: string }>
            id="orgTags" label="What most members deal in" icon="tag"
            value={tagQuery} onInputChange={onTagInput}
            placeholder="juakali, carpentry, farming, mama mboga…"
            hits={tagHits} getKey={(h) => h.key} isSelected={(h) => f.orgTags.includes(h.key)}
            onSelect={(h) => { toggleTag(h.key); setTagHits([]); setTagQuery(''); }}
            renderHit={(h) => <span>{h.name}</span>}
            hint="Pick a few — helps us show the group relevant prices and buyers."
          />
          {f.orgTags.length > 0 && (
            <div className="opts" style={{ marginTop: 8 }}>
              {f.orgTags.map((t) => (
                <button key={t} type="button" className="opt" aria-pressed onClick={() => toggleTag(t)}>
                  <span className="t">{SEGMENTS.find((s) => s.key === t)?.name ?? t} ✕</span>
                </button>
              ))}
            </div>
          )}

          <div className="sub2">
            <div className="fld">
              <label className="lab" htmlFor="orgRegNo">
                Registration number <span className="op">— optional</span>
              </label>
              <input className="inp mono" id="orgRegNo" value={f.registrationNo}
                onChange={(e) => set('registrationNo', e.target.value)} placeholder="BN/2026/0000" />
            </div>
            <div className="fld">
              <label className="lab" htmlFor="orgMemberCount">How many members?</label>
              <input className="inp mono" id="orgMemberCount" inputMode="numeric" value={f.memberCount}
                onChange={(e) => set('memberCount', e.target.value.replace(/\D/g, ''))} placeholder="18" />
              <p className="hint">A rough number is fine. Members join later with their own phone numbers.</p>
            </div>
          </div>

          <button type="button" className="btn btn-o" style={{ marginTop: 4 }}
            onClick={() => { setRegisteringNew(false); set('orgName', ''); set('orgKind', ''); }}>
            <Icon name="arrow-left" size={15} /> Search again instead
          </button>
        </div>
      )}
    </div>
  );
}
