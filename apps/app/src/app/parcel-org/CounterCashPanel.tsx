'use client';
import { displayKES, toCentsOrZero, toWire } from '@esoqo/domain';

import { useEffect, useId, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import type { ParcelOrgStaffRow } from '@/lib/parcel-org-session';
import { remitCounterCash } from './actions';
import { setFormActive } from './form-activity';

/**
 * A manager counting one of their own clerks' counter-intake cash in —
 * RiderCashPanel's counterpart for a station desk instead of a
 * delivery round. Same shape throughout: the amount is typed, never
 * pre-filled with what's expected, because that's the whole point of a
 * reconciliation record; and the clerk is picked from the roster, not
 * typed as a bare id.
 */
export function CounterCashPanel({ clerks }: { clerks: ParcelOrgStaffRow[] }) {
  const [staffId, setStaffId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ expectedKes: string; shortfallKes: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { clerk: useId(), amount: useId(), note: useId() };

  useEffect(() => {
    setFormActive(true);
    return () => setFormActive(false);
  }, []);

  function submit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await remitCounterCash(staffId.trim(), toWire(toCentsOrZero(amount)), note.trim());
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
          <h2>Count counter cash in</h2>
          <p>
            Records what you actually counted and closes out every parcel that clerk took
            cash for at the desk. A shortfall is kept on the record, not rejected.
          </p>
        </div>
      </div>

      <div className="ppanel-body">
        {clerks.length === 0 ? (
          <div className="pempty">
            <span className="pempty-icon"><Icon name="users" size={20} /></span>
            <strong>No one on the roster can hold counter cash yet</strong>
            <p>
              Cash is counted in against a named person. Add a linked person under
              Settings → Team first.
            </p>
          </div>
        ) : (
          <>
            <div className="pgrid">
              <div className="pfield">
                <label htmlFor={ids.clerk}>Team member</label>
                <select
                  id={ids.clerk}
                  value={staffId}
                  onChange={(e) => { setStaffId(e.target.value); setResult(null); }}
                >
                  <option value="">Choose who you're counting in…</option>
                  {clerks.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.msisdn ? ` · ${s.msisdn}` : ''}
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
                <input id={ids.note} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. one note short, will bring tomorrow" />
              </div>
            </div>

            <div className="ptoolbar" style={{ marginTop: 'var(--sp-5)', marginBottom: 0 }}>
              <button
                className="btn btn-p"
                disabled={pending || !staffId || !amount}
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
