'use client';

import { useRef, useState } from 'react';
import { Icon, SelectWithOther } from '@esoko/ui';
import { BUSINESS_TYPES, searchSegments } from '@esoko/domain';
import { actionSearchBusinesses } from './actions';
import { SearchCombobox } from './SearchCombobox';
import type { Form } from './form';

interface BizHit { id: string; name: string; county: string }

const CHANNELS = ['M-Pesa', 'Bank', 'Cash', 'Card', 'Other'];
const BIZ_TYPE_OPTIONS = [
  ['', 'Choose one'],
  ...BUSINESS_TYPES.map((t) => [t.key, `${t.label} — ${t.blurb}`] as const),
] as const;

/**
 * The business path: registered-or-not first (so an existing
 * registration number can be looked up before typing anything else),
 * then a live search-before-create by name — same mechanism as
 * GroupPicker, just pointed at OrgKind.BUSINESS — then, only for a
 * genuinely new business, sector/type/financials/banking.
 */
export function BusinessPicker({
  f, set,
}: {
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
}) {
  const [hits, setHits] = useState<BizHit[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function onBizInput(v: string) {
    set('bizName', v);
    set('bizPartyId', '');
    clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setHits([]); return; }
    searchTimer.current = setTimeout(async () => {
      setHits(await actionSearchBusinesses(v));
    }, 200);
  }

  function pickExisting(b: BizHit) {
    set('bizName', b.name);
    set('bizPartyId', b.id);
  }

  return (
    <div className="sub2">
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend className="lab">Is the business registered?</legend>
        <div className="opts">
          {([
            ['yes', 'Yes, it is registered', 'You have a business number or certificate'],
            ['no', 'Not yet', "We'll ask if you plan to register it"],
          ] as const).map(([v, t, d]) => (
            <button key={v} type="button" className="opt" aria-pressed={f.bizIsRegistered === v}
              onClick={() => set('bizIsRegistered', v)}>
              <span><span className="t">{t}</span><span className="d">{d}</span></span>
            </button>
          ))}
        </div>
      </fieldset>

      {f.bizIsRegistered === 'yes' && (
        <div className="fld">
          <label className="lab" htmlFor="bizRegNo">Registration number, as on the certificate</label>
          <input className="inp mono" id="bizRegNo" value={f.registrationNo}
            onChange={(e) => set('registrationNo', e.target.value)} placeholder="BN/2026/0000" />
        </div>
      )}

      {f.bizIsRegistered === 'no' && (
        <fieldset style={{ border: 0, padding: 0 }}>
          <legend className="lab">Do you plan to register it?</legend>
          <div className="opts">
            {([['yes', 'Yes, eventually'], ['no', 'No, not for now']] as const).map(([v, t]) => (
              <button key={v} type="button" className="opt" aria-pressed={f.bizIntendsToRegister === v}
                onClick={() => set('bizIntendsToRegister', v)}>
                <span className="t">{t}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {f.bizIsRegistered && !f.bizPartyId && (
        <SearchCombobox<BizHit>
          id="bizSearch" label="Business name" icon="shop"
          value={f.bizName} onInputChange={onBizInput}
          placeholder="Search first — avoid registering it twice"
          hits={hits} getKey={(b) => b.id} isSelected={(b) => f.bizPartyId === b.id}
          onSelect={pickExisting}
          renderHit={(b) => <span>{b.name} <span className="op">— {b.county}</span></span>}
          hint="We check for a match by name so the same business is never registered twice."
        />
      )}

      {f.bizPartyId && (
        <div className="paidbox">
          <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)' }}>
            <Icon name="check-circle" size={19} />
          </span>
          <div>
            <strong style={{ display: 'block', marginBottom: 3 }}>Already registered</strong>
            <span className="hint" style={{ margin: 0 }}>
              {f.bizName} is already registered — no need to register it again. You can still
              finish your own registration below.
            </span>
          </div>
        </div>
      )}

      {f.bizIsRegistered && !f.bizPartyId && f.bizName.trim().length >= 2 && hits.length === 0 && (
        <BizDetails f={f} set={set} />
      )}
    </div>
  );
}

function BizDetails({
  f, set,
}: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void }) {
  const [sectorHits, setSectorHits] = useState<{ key: string; name: string }[]>([]);

  function onSectorInput(v: string) {
    set('bizSector', v);
    setSectorHits(v.trim().length >= 2 ? searchSegments(v, 5).map((s) => ({ key: s.key, name: s.name })) : []);
  }

  function toggleChannel(c: string) {
    set('bizPaymentChannels', f.bizPaymentChannels.includes(c)
      ? f.bizPaymentChannels.filter((x) => x !== c)
      : [...f.bizPaymentChannels, c]);
  }

  return (
    <>
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend className="lab">What kind of business is this?</legend>
        <div className="opts">
          {([
            ['', 'Business', 'Shop, service, or anything general'],
            ['SUPPLIER', 'Supplier', 'You supply goods to other businesses'],
            ['WHOLESALER', 'Wholesaler', 'You sell in bulk to retailers'],
            ['WAREHOUSE', 'Godown', 'You store or handle goods for others'],
            ['MALL', 'Mall', 'You host other businesses as tenants'],
          ] as const).map(([v, t, d]) => (
            <button key={v || 'BUSINESS'} type="button" className="opt"
              aria-pressed={f.bizOrgKind === v}
              onClick={() => set('bizOrgKind', v)}>
              <span><span className="t">{t}</span><span className="d">{d}</span></span>
            </button>
          ))}
        </div>
      </fieldset>

      <SearchCombobox<{ key: string; name: string }>
        id="bizSector" label="What sector is it in?" icon="search"
        value={f.bizSector} onInputChange={onSectorInput}
        placeholder="retail, agri-processing, transport…"
        hits={sectorHits} getKey={(h) => h.key} isSelected={(h) => f.bizSector === h.name}
        onSelect={(h) => { set('bizSector', h.name); setSectorHits([]); }}
        renderHit={(h) => <span>{h.name}</span>}
      />

      <SelectWithOther
        id="bizType" label="Type of business" options={BIZ_TYPE_OPTIONS}
        value={f.bizType} onChange={(v) => set('bizType', v)}
        customValue={f.bizTypeOther} onCustomChange={(v) => set('bizTypeOther', v)}
        customLabel="What kind of business is it?"
      />

      {f.bizType && (
        <>
          <div className="sub2">
            <div className="fld">
              <label className="lab" htmlFor="bizEmployees">
                People it employs <span className="op">— optional</span>
              </label>
              <input className="inp mono" id="bizEmployees" inputMode="numeric" value={f.bizEmployeeCount}
                onChange={(e) => set('bizEmployeeCount', e.target.value.replace(/\D/g, ''))} placeholder="0" />
            </div>
            <div className="fld">
              <label className="lab" htmlFor="bizBank">Bank provider <span className="op">— optional</span></label>
              <input className="inp" id="bizBank" value={f.bizBankProvider}
                onChange={(e) => set('bizBankProvider', e.target.value)} placeholder="e.g. Equity, KCB" />
            </div>
          </div>
          <div className="sub2">
            <div className="fld">
              <label className="lab" htmlFor="bizRevGood">
                Revenue on a good day (KES) <span className="op">— optional</span>
              </label>
              <input className="inp mono" id="bizRevGood" inputMode="numeric" value={f.bizRevenueGoodKes}
                onChange={(e) => set('bizRevenueGoodKes', e.target.value.replace(/\D/g, ''))} placeholder="5000" />
            </div>
            <div className="fld">
              <label className="lab" htmlFor="bizRevBad">
                Revenue on a bad day (KES) <span className="op">— optional</span>
              </label>
              <input className="inp mono" id="bizRevBad" inputMode="numeric" value={f.bizRevenueBadKes}
                onChange={(e) => set('bizRevenueBadKes', e.target.value.replace(/\D/g, ''))} placeholder="500" />
            </div>
          </div>

          <fieldset style={{ border: 0, padding: 0 }}>
            <legend className="lab">How do customers pay? <span className="op">— optional</span></legend>
            <div className="opts">
              {CHANNELS.map((c) => (
                <button key={c} type="button" className="opt" aria-pressed={f.bizPaymentChannels.includes(c)}
                  onClick={() => toggleChannel(c)}>
                  <span className="t">{c}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}
    </>
  );
}
