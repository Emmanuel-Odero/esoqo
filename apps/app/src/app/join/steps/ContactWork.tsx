'use client';

import type { RefObject } from 'react';
import { Icon } from '@esoqo/ui';
import { COUNTIES, LIVE_COUNTIES } from '@esoqo/domain';
import { SearchCombobox } from '../SearchCombobox';
import { normaliseMsisdnLive, type Form } from '../form';

interface WorkHit { key: string; name: string }

/** Step 2 — contact details and work, on one screen (previously two). */
export function ContactWork({
  f, set, headingRef, errField, hits, onWorkInput, onSelectWork,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  errField?: string;
  hits: WorkHit[];
  onWorkInput: (v: string) => void;
  onSelectWork: (key: string, name: string) => void;
}) {
  return (
    <>
      <h2 className="qh" ref={headingRef} tabIndex={-1}>How to reach you, and what you do</h2>
      <p className="qs">
        Your record is mostly used by dialling <strong className="mono">*483*77#</strong> from this number.
      </p>

      <div className="fld">
        <label className="lab" htmlFor="msisdn"><Icon name="phone" size={15} />Phone number</label>
        <input className="inp mono msisdn" id="msisdn" value={f.msisdn} inputMode="tel"
          autoComplete="tel" aria-invalid={errField === 'msisdn'} aria-describedby="msisdn-hint"
          onChange={(e) => set('msisdn', normaliseMsisdnLive(e.target.value))} />
        <p className="hint" id="msisdn-hint">
          A six-digit code confirms this is your line. Your record stays with this number even if you change handsets.
        </p>
      </div>

      <div className="sub2">
        <div className="fld">
          <label className="lab" htmlFor="county"><Icon name="pin" size={15} />County</label>
          <select className="inp" id="county" value={f.county}
            onChange={(e) => set('county', e.target.value)}>
            {LIVE_COUNTIES.map((c) => <option key={c}>{c}</option>)}
            <option disabled>──────────</option>
            {COUNTIES.slice(8).map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="fld">
          <label className="lab" htmlFor="ward">Ward or market <span className="op">— optional</span></label>
          <input className="inp" id="ward" value={f.ward}
            onChange={(e) => set('ward', e.target.value)} placeholder="e.g. Gikomba, Kamukunji" />
        </div>
      </div>

      <div className="fld">
        <label className="lab" htmlFor="email">
          <Icon name="mail" size={15} />Email <span className="op">— optional</span>
        </label>
        <input className="inp" id="email" type="email" value={f.email} inputMode="email"
          autoComplete="email"
          onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" />
      </div>

      <div className="sub2">
        <SearchCombobox<WorkHit>
          id="work" label="What do you do?" icon="search"
          value={f.workRaw} onInputChange={onWorkInput}
          placeholder="carpentry, mama mboga, boda, chama, kanisa, welding…"
          hits={hits} getKey={(h) => h.key} isSelected={(h) => f.segment === h.key}
          onSelect={(h) => onSelectWork(h.key, h.name)}
          renderHit={(h) => <span>{h.name}</span>}
          hint="In English or Kiswahili, however you say it. You can edit this later."
          noMatchLabel={(typed) => `Use "${typed}" — it does not have to be on the list`}
          onNoMatchSelect={(typed) => onSelectWork('', typed)}
        />
      </div>
    </>
  );
}
