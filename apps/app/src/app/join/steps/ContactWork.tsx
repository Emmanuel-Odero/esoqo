'use client';

import type { RefObject } from 'react';
import { Icon } from '@esoko/ui';
import { COUNTIES, LIVE_COUNTIES } from '@esoko/domain';
import type { Form } from '../form';

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
        Esoko is used mainly by dialling <strong className="mono">*483*77#</strong> from this number.
      </p>

      <div className="fld">
        <label className="lab" htmlFor="msisdn"><Icon name="phone" size={15} />Phone number</label>
        <input className="inp mono" id="msisdn" value={f.msisdn} inputMode="tel"
          autoComplete="tel" aria-invalid={errField === 'msisdn'} aria-describedby="msisdn-hint"
          onChange={(e) => set('msisdn', e.target.value)} />
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
        <div className="fld">
          <label className="lab" htmlFor="work"><Icon name="search" size={15} />What do you do?</label>
          <input className="inp" id="work" value={f.workRaw} autoComplete="off"
            role="combobox" aria-expanded={hits.length > 0} aria-controls="work-hits"
            aria-describedby="work-hint"
            onChange={(e) => onWorkInput(e.target.value)}
            placeholder="carpentry, mama mboga, boda, chama, kanisa, welding…" />
        </div>
        <div className="hits" id="work-hits" role="listbox" aria-label="Matching kinds of work">
          {hits.map((h) => (
            <button key={h.key} type="button" className="hit" role="option"
              aria-selected={f.segment === h.key}
              onClick={() => onSelectWork(h.key, h.name)}>
              <span>{h.name}</span><span className="yes">SELECT</span>
            </button>
          ))}
          {f.workRaw.trim().length >= 2 && hits.length === 0 && (
            <button type="button" className="hit" onClick={() => onSelectWork('', f.workRaw)}>
              <span>Use "{f.workRaw}" — Esoko is for you too</span>
              <span className="yes">SELECT</span>
            </button>
          )}
        </div>
        <p className="hint" id="work-hint">In English or Kiswahili, however you say it. You can edit this later.</p>
      </div>
    </>
  );
}
