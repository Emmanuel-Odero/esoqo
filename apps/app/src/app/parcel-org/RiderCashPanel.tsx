'use client';
import { displayKES, toCentsOrZero, toWire } from '@esoqo/domain';

import { useEffect, useId, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
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
 */
export function RiderCashPanel() {
  const [open, setOpen] = useState(false);
  const [riderPartyId, setRiderPartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ expectedKes: string; shortfallKes: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { rider: useId(), amount: useId(), note: useId() };

  // Same deal as the custom-parcel panel: while counting cash the
  // dashboard poller stands down so the page never refreshes mid-count.
  useEffect(() => {
    if (!open) return;
    setFormActive(true);
    return () => setFormActive(false);
  }, [open ]);

  if (!open) {
    return (
      <button className="btn btn-o btn-sm" style={{ marginBottom: 16 }} onClick={() => setOpen(true)}>
        <Icon name="coins" size={14} />Count a rider&apos;s cash in
      </button>
    );
  }

  function submit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      // Exact decimal string — money.Amount on the server takes either
      // shape, so what was counted is what gets recorded.
      const res = await remitRiderCod(riderPartyId.trim(), toWire(toCentsOrZero(amount)), note.trim());
      if (!res.ok) { setError(res.error); return; }
      setResult({ expectedKes: res.expectedKes, shortfallKes: res.shortfallKes });
      setRiderPartyId(''); setAmount(''); setNote('');
    });
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6, width: '100%',
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0 }}>Count a rider&apos;s cash in</h3>
          <p className="sub" style={{ margin: '4px 0 12px', fontSize: '.85rem' }}>
            Closes out every parcel that rider collected money for.
          </p>
        </div>
        <button className="btn btn-o btn-sm" onClick={() => setOpen(false)}>Close</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div>
          <label className="sub" htmlFor={ids.rider} style={{ display: 'block', marginBottom: 4 }}>
            Rider&apos;s Esoqo party id
          </label>
          <input id={ids.rider} className="mono" style={inputStyle} value={riderPartyId}
            onChange={(e) => setRiderPartyId(e.target.value)} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.amount} style={{ display: 'block', marginBottom: 4 }}>
            Amount counted (KES)
          </label>
          <input id={ids.amount} className="mono" style={inputStyle} value={amount}
            placeholder="What you actually counted"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
        <div>
          <label className="sub" htmlFor={ids.note} style={{ display: 'block', marginBottom: 4 }}>
            Note (optional)
          </label>
          <input id={ids.note} style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn btn-p btn-sm" disabled={pending || !riderPartyId.trim() || !amount} onClick={submit}>
          {pending ? 'Recording…' : 'Record'}
        </button>
      </div>

      {result && (
        <p className="sub" style={{ marginTop: 12, fontSize: '.85rem' }}>
          Expected KES {displayKES(result.expectedKes)}.
          {toCentsOrZero(result.shortfallKes) > 0
            ? ` That's KES ${displayKES(result.shortfallKes)} short — both figures are on the record.`
            : ' Counted in full.'}
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center', marginTop: 12 }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}
