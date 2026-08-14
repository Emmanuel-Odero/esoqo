'use client';

import { useState, type RefObject } from 'react';
import { Icon } from '@esoko/ui';
import { DocumentStep, PaymentStep } from '../Steps';
import { GroupPicker } from '../GroupPicker';
import { BusinessPicker } from '../BusinessPicker';
import type { Form } from '../form';

/**
 * Step 3 — everything genuinely optional, on one screen instead of
 * three forced screen transitions (standing, documents, payment).
 * Every section starts collapsed and Continue works with nothing
 * touched — there is nothing here the data model requires.
 */
export function MoreAboutYou({
  f, set, headingRef, registrationId,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  registrationId: string;
}) {
  const [open, setOpen] = useState<'standing' | 'documents' | 'payment' | null>(null);

  const standingSummary = f.joiningAs === 'group'
    ? (f.groupPartyId ? `Linked to ${f.groupName}` : f.orgName ? `Registering ${f.orgName}` : 'Not answered')
    : f.joiningAs === 'biz'
    ? (f.bizPartyId ? `Already registered as ${f.bizName}` : f.bizName ? `Registering ${f.bizName}` : 'Not answered')
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

      {f.joiningAs === 'group' ? (
      <>
        <div className="vblock">
          <div className="vhead">
            <span className="icbox"><Icon name="scales" size={17} /></span>
            <div style={{ flex: 1 }}>
              <strong>Your group</strong>
              <span style={{ fontSize: '.86rem', color: 'var(--tx-2)', display: 'block' }}>
                Required — this is the group you are registering
              </span>
            </div>
          </div>
          <div className="sub2">
            <p className="hint" style={{ marginTop: 0 }}>
              Find your group first — we check so nobody registers the same group twice.
              If it is not listed yet, you can register it. You cannot continue until the
              group is linked or added.
            </p>
            <GroupPicker f={f} set={set} />
            <FeeCoverage f={f} set={set} />
          </div>
        </div>
      </>
    ) : f.joiningAs === 'biz' ? (
      <>
        {/* Same shape as the group block above, deliberately not the
            collapsible/optional Section 'me' gets below — a business
            registration that never asks about the business is just a
            personal one wearing a different label. */}
        <div className="vblock">
          <div className="vhead">
            <span className="icbox"><Icon name="shop" size={17} /></span>
            <div style={{ flex: 1 }}>
              <strong>Your business</strong>
              <span style={{ fontSize: '.86rem', color: 'var(--tx-2)', display: 'block' }}>
                Required — this is the business you are registering
              </span>
            </div>
          </div>
          <div className="sub2">
            <p className="hint" style={{ marginTop: 0 }}>
              Find your business first — we check so nobody registers the same business
              twice. If it is not listed yet, you can register it. You cannot continue
              until the business is linked or added.
            </p>
            <BusinessPicker f={f} set={set} />
          </div>
        </div>
      </>
    ) : (
      <Section
        icon="scales" title="Your standing" status={standingSummary}
        open={open === 'standing'} onToggle={() => setOpen(open === 'standing' ? null : 'standing')}
      >
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 15px' }}>
          <legend className="lab">Do you run a business?</legend>
          <div className="opts">
            {([
              ['yes', 'Yes, it is registered', 'You have a business name or BRS certificate'],
              ['no', 'No, not registered', 'Most people start here. Everything still works'],
              ['soon', 'Not yet, but I want to', 'We can handle the filing when you are ready'],
            ] as const).map(([v, t, d]) => (
              <button key={v} type="button" className="opt"
                aria-pressed={f.hasRegisteredBusiness === v}
                onClick={() => set('hasRegisteredBusiness', v)}>
                <span><span className="t">{t}</span><span className="d">{d}</span></span>
              </button>
            ))}
          </div>
        </fieldset>

        {f.hasRegisteredBusiness === 'yes' && (
          <div className="fld">
            <label className="lab" htmlFor="regNo">Registration number <span className="op">— optional</span></label>
            <input className="inp mono" id="regNo" value={f.registrationNo}
              onChange={(e) => set('registrationNo', e.target.value)} placeholder="BN/2026/0000" />
          </div>
        )}

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
            <div style={{ marginTop: 15 }}>
              <GroupPicker f={f} set={set} />
              <FeeCoverage f={f} set={set} />
            </div>
          )}
        </fieldset>
      </Section>
    )}

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
            defaultMsisdn={f.msisdn}
          />
        </Section>
      )}
    </>
  );
}

/** Shared between joiningAs === 'group' (asked about the group's own
 *  fee) and belongsToGroup === 'yes' (asked whether an existing group
 *  covers this person's fee) — same question, same two answers. */
function FeeCoverage({
  f, set,
}: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: '15px 0 0' }}>
      <legend className="lab">Has the group already paid this registration fee?</legend>
      <div className="opts">
        {([['group', 'Yes, the group covers it', 'Nothing more to do here'],
           ['self', 'No, pay it separately', 'Add it in "Registration fee" below']] as const).map(([v, t, d]) => (
          <button key={v} type="button" className="opt" aria-pressed={f.feeCoverage === v}
            onClick={() => set('feeCoverage', v)}>
            <span><span className="t">{t}</span><span className="d">{d}</span></span>
          </button>
        ))}
      </div>
    </fieldset>
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
