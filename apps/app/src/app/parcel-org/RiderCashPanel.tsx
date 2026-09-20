'use client';
import { displayKES, toCentsOrZero, toWire } from '@esoqo/domain';

import { useEffect, useId, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { ParcelOrgStaffRow } from '@/lib/parcel-org-session';
import { remitRiderCod } from './actions';
import { setFormActive } from './form-activity';

/**
 * A depot manager counting one of their own riders in at the end of a
 * round.
 *
 * The counted amount is typed, never pre-filled with what's expected.
 * That's the whole point of a reconciliation record: the notes on the
 * table and the system's expectation are allowed to disagree, and
 * pre-filling the expected figure is exactly how somebody confirms a
 * number they never actually counted.
 *
 * The rider is PICKED, though. This used to ask for "Rider's Esoqo
 * party id" in a bare text box — a UUID nobody standing at a counter
 * has, which made the one action on this page effectively unusable
 * without going to look it up. The roster already carries partyId.
 */
export function RiderCashPanel({ riders }: { riders: ParcelOrgStaffRow[] }) {
  const [riderPartyId, setRiderPartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ expectedKes: string; shortfallKes: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { rider: useId(), amount: useId(), note: useId() };

  // While counting cash the dashboard poller stands down, so the page
  // never refreshes mid-count.
  useEffect(() => {
    setFormActive(true);
    return () => setFormActive(false);
  }, []);

  function submit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      // Exact decimal string — money.Amount on the server takes either
      // shape, so what was counted is what gets recorded.
      const res = await remitRiderCod(riderPartyId.trim(), toWire(toCentsOrZero(amount)), note.trim());
      if (!res.ok) { setError(res.error); return; }
      setResult({ expectedKes: res.expectedKes, shortfallKes: res.shortfallKes });
      setAmount(''); setNote('');
    });
  }

  const short = result ? toCentsOrZero(result.shortfallKes) > 0 : false;

  return (
    <section className="ppanel porg-money-count">
      <div className="ppanel-head">
        <div>
          <h2>Count a rider in</h2>
          <p>
            Records what you actually counted and closes out every parcel that rider
            collected money for. A shortfall is kept on the record, not rejected.
          </p>
        </div>
      </div>

      <div className="ppanel-body">
        {riders.length === 0 ? (
          <div className="pempty">
            <span className="pempty-icon"><Icon name="users" size={20} /></span>
            <strong>No riders on the roster yet</strong>
            <p>
              Cash is counted in against a named rider. Add them under Settings →
              Team first.
            </p>
          </div>
        ) : (
          <>
            <div className="pgrid">
              <div className="pfield">
                <label htmlFor={ids.rider}>Rider</label>
                <select
                  id={ids.rider}
                  value={riderPartyId}
                  onChange={(e) => { setRiderPartyId(e.target.value); setResult(null); }}
                >
                  <option value="">Choose a rider…</option>
                  {riders.map((r) => (
                    <option key={r.id} value={r.partyId ?? ''}>
                      {r.name}{r.msisdn ? ` · ${r.msisdn}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pfield">
                <label htmlFor={ids.amount}>Amount counted (KES)</label>
                <input
                  id={ids.amount} className="mono" value={amount} inputMode="decimal"
                  placeholder="What you actually counted"
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                />
                <em className="phint">Not pre-filled on purpose — count first.</em>
              </div>
              <div className="pfield">
                <label htmlFor={ids.note}>Note (optional)</label>
                <input id={ids.note} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. two notes short, will bring tomorrow" />
              </div>
            </div>

            <div className="ptoolbar" style={{ marginTop: 'var(--sp-5)', marginBottom: 0 }}>
              <button
                className="btn btn-p"
                disabled={pending || !riderPartyId || !amount}
                onClick={submit}
              >
                <Icon name="coins" size={16} />{pending ? 'Recording…' : 'Record the count'}
              </button>
            </div>

            {result && (
              <p className={`pnote ${short ? 'pnote-warn' : 'pnote-ok'}`} style={{ marginTop: 'var(--sp-4)' }} role="status">
                <Icon name={short ? 'alert-triangle' : 'check-circle'} size={16} />
                <span>
                  Expected KES {displayKES(result.expectedKes)}.{' '}
                  {short
                    ? `That's KES ${displayKES(result.shortfallKes)} short — both figures are on the record.`
                    : 'Counted in full.'}
                </span>
              </p>
            )}
            {error && (
              <p className="pnote pnote-bad" style={{ marginTop: 'var(--sp-4)' }} role="alert">
                <Icon name="alert-circle" size={16} /><span>{error}</span>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
