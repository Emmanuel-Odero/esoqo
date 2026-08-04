'use client';

import { useState, type RefObject } from 'react';
import { Icon } from '@esoko/ui';
import { DocumentStep, PaymentStep } from '../Steps';
import type { Form } from '../form';

interface GroupHit { id: string; name: string; county: string }

/**
 * Step 3 — everything genuinely optional, on one screen instead of
 * three forced screen transitions (standing, documents, payment).
 * Every section starts collapsed and Continue works with nothing
 * touched — there is nothing here the data model requires.
 */
export function MoreAboutYou({
  f, set, headingRef, registrationId, groupHits, onGroupInput,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  registrationId: string;
  groupHits: GroupHit[];
  onGroupInput: (v: string) => void;
}) {
  const [open, setOpen] = useState<'standing' | 'documents' | 'payment' | null>(null);

  const standingSummary = f.joiningAs === 'group'
    ? (f.memberCount ? `${f.memberCount} members` : 'Not answered')
    : [
        f.hasRegisteredBusiness && { yes: 'Registered business', no: 'Not registered', soon: 'Registering soon' }[f.hasRegisteredBusiness],
        f.belongsToGroup === 'yes' && (f.groupName ? `In ${f.groupName}` : 'In a group'),
      ].filter(Boolean).join(' · ') || 'Not answered';

  return (
    <>
      <h2 className="qh" ref={headingRef} tabIndex={-1}>Anything else? All of this is optional</h2>
      <p className="qs">
        Your record is created either way. Add these now if they're handy, or from your account any time.
      </p>

      <Section
        icon="scales" title="Your standing" status={standingSummary}
        open={open === 'standing'} onToggle={() => setOpen(open === 'standing' ? null : 'standing')}
      >
        {f.joiningAs !== 'group' && (
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 15px' }}>
            <legend className="lab">Do you have a registered business?</legend>
            <div className="opts">
              {([
                ['yes', 'Yes, it is registered', 'You have a business name or BRS certificate'],
                ['no', 'No, not registered', 'Most people start here. Everything still works'],
                ['soon', 'Not yet, but I want to', 'Esoko can handle the filing when you are ready'],
              ] as const).map(([v, t, d]) => (
                <button key={v} type="button" className="opt"
                  aria-pressed={f.hasRegisteredBusiness === v}
                  onClick={() => set('hasRegisteredBusiness', v)}>
                  <span><span className="t">{t}</span><span className="d">{d}</span></span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {f.hasRegisteredBusiness === 'yes' && (
          <div className="fld">
            <label className="lab" htmlFor="regNo">Registration number <span className="op">— optional</span></label>
            <input className="inp mono" id="regNo" value={f.registrationNo}
              onChange={(e) => set('registrationNo', e.target.value)} placeholder="BN/2026/0000" />
          </div>
        )}

        {f.joiningAs === 'group' ? (
          <div className="fld">
            <label className="lab" htmlFor="members">How many members?</label>
            <input className="inp mono" id="members" inputMode="numeric" value={f.memberCount}
              onChange={(e) => set('memberCount', e.target.value)} placeholder="18" />
            <p className="hint">A rough number is fine. Members join later with their own phone numbers.</p>
          </div>
        ) : (
          <fieldset style={{ border: 0, padding: 0 }}>
            <legend className="lab">Do you belong to a group, sacco or cooperative?</legend>
            <div className="opts">
              {([['yes', 'Yes', 'A chama, sacco, cooperative, welfare group or association'],
                 ['no', 'No', 'You can join or start one later from the menu']] as const).map(([v, t, d]) => (
                <button key={v} type="button" className="opt" aria-pressed={f.belongsToGroup === v}
                  onClick={() => set('belongsToGroup', v)}>
                  <span><span className="t">{t}</span><span className="d">{d}</span></span>
                </button>
              ))}
            </div>
            {f.belongsToGroup === 'yes' && (
              <>
                <div className="fld" style={{ marginTop: 15 }}>
                  <label className="lab" htmlFor="groupName">Name of the group</label>
                  <input className="inp" id="groupName" value={f.groupName} autoComplete="off"
                    role="combobox" aria-expanded={groupHits.length > 0} aria-controls="group-hits"
                    onChange={(e) => onGroupInput(e.target.value)} placeholder="Search or type the name" />
                  <div className="hits" id="group-hits" role="listbox" aria-label="Matching groups">
                    {groupHits.map((g) => (
                      <button key={g.id} type="button" className="hit" role="option"
                        aria-selected={f.groupPartyId === g.id}
                        onClick={() => { set('groupName', g.name); set('groupPartyId', g.id); }}>
                        <span>{g.name} <span className="op">— {g.county}</span></span>
                        <span className="yes">SELECT</span>
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    {f.groupPartyId ? 'Linked — Esoko will connect your record to this group.' : 'Pick it from the list, or just type the name.'}
                  </p>
                </div>
                <fieldset style={{ border: 0, padding: 0, margin: '15px 0 0' }}>
                  <legend className="lab">Has your group already paid your registration fee?</legend>
                  <div className="opts">
                    {([['group', 'Yes, the group covers it', 'Nothing more to do here'],
                       ['self', 'No, I paid it myself', 'Add it in "Registration fee" below']] as const).map(([v, t, d]) => (
                      <button key={v} type="button" className="opt" aria-pressed={f.feeCoverage === v}
                        onClick={() => set('feeCoverage', v)}>
                        <span><span className="t">{t}</span><span className="d">{d}</span></span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
          </fieldset>
        )}
      </Section>

      <Section
        icon="document" title="Add a document" status="Optional — a national ID, certificate or group rules"
        open={open === 'documents'} onToggle={() => setOpen(open === 'documents' ? null : 'documents')}
      >
        <DocumentStep registrationId={registrationId} />
      </Section>

      {f.feeCoverage !== 'group' && (
        <Section
          icon="coins" title="Registration fee"
          status={f.paymentChoice === 'paid' ? 'Marked as paid' : f.paymentChoice === 'later' ? "Paying later" : 'Not answered'}
          open={open === 'payment'} onToggle={() => setOpen(open === 'payment' ? null : 'payment')}
        >
          <PaymentStep
            registrationId={registrationId}
            choice={f.paymentChoice}
            feeCoveredByGroup={false}
            onChoice={(c) => set('paymentChoice', c)}
          />
        </Section>
      )}
    </>
  );
}

function Section({
  icon, title, status, open, onToggle, children,
}: {
  icon: Parameters<typeof Icon>[0]['name']; title: string; status: string;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="vblock">
      <button
        type="button" onClick={onToggle}
        style={{ all: 'unset', display: 'flex', width: '100%', cursor: 'pointer', boxSizing: 'border-box' }}
        aria-expanded={open}
      >
        <div className="vhead" style={{ width: '100%' }}>
          <span className="icbox"><Icon name={icon} size={17} /></span>
          <div style={{ flex: 1 }}>
            <strong>{title}</strong>
            <span style={{ fontSize: '.86rem', color: 'var(--tx-2)', display: 'block' }}>{status}</span>
          </div>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} />
        </div>
      </button>
      {open && <div className="sub2">{children}</div>}
    </div>
  );
}
