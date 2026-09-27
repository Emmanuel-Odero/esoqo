'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { orgKindLabel } from '@esoqo/domain';
import { PayClient } from './PayClient';
import { actionLookupGroup, actionLookupTransport, type TargetLookup } from './targets';

/**
 * Search, then hand over to the ordinary pay flow.
 *
 * The group and transport pages differ from /pay/business in exactly one
 * step — how a name becomes an organisation — and in nothing at all
 * after that. So rather than a second copy of the amount screen, the STK
 * push, the QR, the polling and the receipt, this hands the chosen
 * payee to PayClient as a lookup result and gets out of the way.
 *
 * That reuse is the point. A payment flow exists once, which is the only
 * way to be sure the group page and the shop page cannot drift into
 * behaving differently on money.
 */

type Mode = 'group' | 'transport';

const COPY: Record<Mode, {
  kicker: string; title: string; lead: string; field: string; placeholder: string;
  cta: string; chips: string[]; note: string;
}> = {
  group: {
    kicker: 'Pay a group',
    title: 'Pay into a savings group',
    lead: 'Chamas, table-banking groups, SACCOs, co-operatives and associations — by name or by Esoqo ID.',
    field: 'Group name or Esoqo ID',
    placeholder: 'Kilimani Chama or ESK-HWQHDU-KE',
    cta: 'Find the group',
    chips: ['Group name', 'Esoqo ID', 'Phone number', 'Email'],
    note: 'Only groups registered on Esoqo can be paid. Ask your treasurer for the group’s Esoqo ID.',
  },
  transport: {
    kicker: 'Transport',
    title: 'Pay a transport company',
    lead: 'Find the company by name, or by the number plate on the vehicle you are boarding.',
    field: 'Company name or number plate',
    placeholder: 'Umoja Boda or KCB 123A',
    cta: 'Find the company',
    chips: ['Number plate', 'Company name', 'Esoqo ID'],
    note: 'Paying by plate pays the company that owns the vehicle — useful when you are boarding and cannot read the name on the side.',
  },
};

export function TargetClient({ mode }: { mode: Mode }) {
  const [identifier, setIdentifier] = useState('');
  const [result, setResult] = useState<TargetLookup | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const c = COPY[mode];

  // Once a payee is chosen this component has no further job; PayClient
  // owns the screen from here, including the back-to-hub navigation.
  if (result?.status === 'FOUND' && result.targets.length === 1) {
    const only = result.targets[0]!;
    return (
      <PayClient
        initialLookup={{
          status: 'FOUND',
          businesses: [{
            partyId: only.partyId,
            esoqoId: only.esoqoId,
            name: only.name,
            county: only.county,
            registrationNo: only.registrationNo,
            kind: only.kind,
          }],
        }}
        prefillAmount={null}
      />
    );
  }

  const found = result?.status === 'FOUND' ? result.targets : [];

  return (
    <>
      <section className="phead">
        <div className="wrap" style={{ textAlign: 'center' }}>
          <span
            className="icbox"
            style={{ background: 'rgba(255,255,255,.12)', color: '#fff', width: 52, height: 52, borderRadius: 13, margin: '0 auto 16px' }}
          >
            <Icon name={mode === 'group' ? 'users' : 'truck'} size={28} />
          </span>
          <p className="kicker" style={{ justifyContent: 'center' }}>{c.kicker}</p>
          <h1 style={{ margin: '0 auto' }}>{c.title}</h1>
          <p className="lead" style={{ margin: '12px auto 0', maxWidth: 500 }}>{c.lead}</p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 560 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              startTransition(async () => {
                const r = mode === 'group'
                  ? await actionLookupGroup(identifier)
                  : await actionLookupTransport(identifier);
                if (r.status === 'EMPTY') { setError(`Enter ${mode === 'group' ? 'a group' : 'a company or plate'} to search for.`); return; }
                if (r.status === 'NOT_FOUND') { setResult(null); setError(r.hint); return; }
                if (r.status === 'NOT_PAYABLE') { setResult(null); setError('That one is registered but cannot take payments yet.'); return; }
                setResult(r);
              });
            }}
          >
            <div className="card" style={{ padding: 28 }}>
              <h2 style={{ marginBottom: 6 }}>{c.field}</h2>
              <p className="sub" style={{ marginBottom: 18 }}>Then choose the amount on the next screen.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
                  placeholder={c.placeholder}
                  className="mono"
                  style={{
                    flex: 1, minWidth: 0, padding: '12px 14px', minHeight: 50,
                    border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '1.05rem',
                    background: 'var(--paper)',
                  }}
                  aria-label={c.field}
                  required
                />
                <button type="submit" className="btn btn-p" disabled={pending || !identifier.trim()}>
                  {pending ? <span className="spin" aria-hidden /> : <Icon name="search" size={16} />}
                  {pending ? 'Searching…' : c.cta}
                </button>
              </div>

              {error && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--red-t)', borderRadius: 8, color: 'var(--red)', fontSize: '.9rem' }}>
                  {error}
                </div>
              )}

              {found.length > 0 && (
                <>
                  <p className="sub" style={{ margin: '20px 0 0', fontSize: '.82rem', color: 'var(--tx-3)' }}>
                    {found.length === 1 ? 'One match — check it is the right one:' : `${found.length} matches — pick the right one:`}
                  </p>
                  <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 8 }}>
                    {found.map((t) => (
                      <li key={t.partyId}>
                        <PayChoice
                          partyId={t.partyId}
                          esoqoId={t.esoqoId}
                          name={t.name}
                          kind={t.kind}
                          county={t.county}
                          registrationNo={t.registrationNo}
                          onChoose={() => setResult({ status: 'FOUND', targets: [t], via: 'NAME' })}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div style={{ marginTop: 16 }}>
                <p className="sub" style={{ marginBottom: 8, fontSize: '.82rem', color: 'var(--tx-3)' }}>Accepted identifiers:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {c.chips.map((chip) => <span key={chip} className="chip mono">{chip}</span>)}
                </div>
              </div>
            </div>
          </form>

          <div className="card" style={{ padding: 20, marginTop: 18 }}>
            <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>{c.note}</p>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * One row of the results list, split out so the same markup is used by
 * both pages and a change to it cannot land on one of them.
 */
function PayChoice({
  partyId, esoqoId, name, kind, county, registrationNo, onChoose,
}: {
  partyId: string; esoqoId: string; name: string; kind: string;
  county: string; registrationNo: string | null; onChoose: () => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-b btn-block"
      style={{ textAlign: 'left', justifyContent: 'space-between' }}
      onClick={onChoose}
      data-party={partyId}
    >
      <span>
        <span style={{ display: 'block', fontWeight: 600 }}>{name}</span>
        <span className="mono" style={{ fontSize: '.78rem', color: 'var(--tx-3)' }}>
          {esoqoId} · {orgKindLabel(kind)}{registrationNo ? ` · ${registrationNo}` : ''}{county ? ` · ${county}` : ''}
        </span>
      </span>
      <Icon name="arrow-right" size={16} />
    </button>
  );
}
