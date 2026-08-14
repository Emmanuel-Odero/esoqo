'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@esoko/ui';
import { checkInCashier, startShift, endShift } from '../(shell)/shifts/actions';
import { cashierSignOut } from '@/app/signin/cashier/[slug]/actions';

interface Cashier { id: string; name: string; role: string }
export interface CashierSession { cashierId: string; cashierName: string; shiftId: string | null }

const storageKey = (storeId: string) => `esoko-pos-session-${storeId}`;

/**
 * Cashier identity for the terminal — two different sources feed the
 * same UI:
 *   · `signedInCashier` — a real, independently-authenticated cashier
 *     session (see /signin/cashier/[slug]). Identity is already known
 *     and can't be swapped from here; only "sign out" leaves it.
 *   · The owner's soft check-in below — the owner is signed in as
 *     themselves but wants to attribute sales to whoever is physically
 *     at a SHARED terminal, without that person having their own
 *     device/session. A PIN check here is a lightweight attribution
 *     tag, not a privilege boundary — the actions it calls still run
 *     under the OWNER's ctx.
 */
export function CashierBar({ storeId, storeSlug, cashiers, signedInCashier, onSession }: {
  storeId: string; storeSlug: string; cashiers: Cashier[];
  signedInCashier?: { id: string; name: string; shiftId: string | null } | null;
  onSession: (session: CashierSession | null) => void;
}) {
  const [session, setSession] = useState<CashierSession | null>(
    signedInCashier ? { cashierId: signedInCashier.id, cashierName: signedInCashier.name, shiftId: signedInCashier.shiftId } : null,
  );
  const [cashierId, setCashierId] = useState('');
  const [pin, setPin] = useState('');
  const [floatKes, setFloatKes] = useState('');
  const [countedKes, setCountedKes] = useState('');
  const [showClose, setShowClose] = useState(false);
  const [zReport, setZReport] = useState<{ expectedCashKes: number; countedCashKes: number | null; varianceKes: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (signedInCashier) { onSession(session); return; } // real session — nothing to restore from storage
    const saved = sessionStorage.getItem(storageKey(storeId));
    if (saved) {
      const parsed = JSON.parse(saved) as CashierSession;
      setSession(parsed);
      onSession(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  function persist(next: CashierSession | null) {
    setSession(next);
    onSession(next);
    if (signedInCashier) return; // real sessions live server-side, not in storage
    if (next) sessionStorage.setItem(storageKey(storeId), JSON.stringify(next));
    else sessionStorage.removeItem(storageKey(storeId));
  }

  async function checkIn() {
    if (!cashierId || pin.length < 4) return;
    setError(null); setPending(true);
    const result = await checkInCashier(storeId, { cashierId, pin });
    setPending(false);
    if (!result.ok) { setError(result.error); return; }
    if (result.data.openShiftId) {
      persist({ cashierId: result.data.cashierId, cashierName: result.data.name, shiftId: result.data.openShiftId });
      setPin('');
    } else {
      // Checked in, but no shift open yet — hold their identity and ask for a float.
      setSession({ cashierId: result.data.cashierId, cashierName: result.data.name, shiftId: null });
      setPin('');
    }
  }

  async function openShiftNow() {
    if (!session) return;
    setError(null); setPending(true);
    const result = await startShift(storeId, { cashierId: session.cashierId, openingFloatKes: Number(floatKes) || 0 });
    setPending(false);
    if (!result.ok) { setError(result.error); return; }
    persist({ ...session, shiftId: result.data.shiftId });
    setFloatKes('');
  }

  async function closeShiftNow() {
    if (!session?.shiftId) return;
    setError(null); setPending(true);
    const result = await endShift({ shiftId: session.shiftId, countedCashKes: Number(countedKes) || 0 });
    setPending(false);
    if (!result.ok) { setError(result.error); return; }
    setZReport({ expectedCashKes: result.data.expectedCashKes, countedCashKes: result.data.countedCashKes, varianceKes: result.data.varianceKes });
    persist(signedInCashier ? { ...session, shiftId: null } : null);
    setShowClose(false); setCountedKes('');
  }

  if (!signedInCashier && cashiers.length === 0) return null;

  const signOutLink = signedInCashier && (
    <button type="button" className="btn btn-o btn-sm" onClick={() => cashierSignOut(storeSlug)}>
      <Icon name="close" size={12} />Sign out
    </button>
  );

  if (zReport) {
    const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <h4 style={{ margin: '0 0 10px', fontSize: '.9rem' }}>Shift closed</h4>
        <div className="review-line"><span>Expected</span><span className="mono">{kes(zReport.expectedCashKes)}</span></div>
        <div className="review-line"><span>Counted</span><span className="mono">{kes(zReport.countedCashKes ?? 0)}</span></div>
        <div className="review-line" style={{ fontWeight: 700 }}>
          <span>Variance</span>
          <span className="mono" style={{ color: (zReport.varianceKes ?? 0) === 0 ? 'var(--green)' : 'var(--red)' }}>
            {zReport.varianceKes !== null ? `${zReport.varianceKes >= 0 ? '+' : ''}${kes(zReport.varianceKes)}` : '—'}
          </span>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-o btn-sm" onClick={() => setZReport(null)}>Start next shift</button>
          {signOutLink}
        </div>
      </div>
    );
  }

  if (session?.shiftId) {
    return (
      <div className="card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <span style={{ fontSize: '.85rem' }}><Icon name="user" size={14} style={{ verticalAlign: -2, marginRight: 6 }} />On till: <b>{session.cashierName}</b></span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!showClose ? (
            <button type="button" className="btn btn-o btn-sm" onClick={() => setShowClose(true)}>Close shift</button>
          ) : (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="inp mono" value={countedKes} onChange={(e) => setCountedKes(e.target.value)} placeholder="Counted cash" style={{ width: 120, padding: '6px 8px', fontSize: '.8rem' }} inputMode="decimal" />
              <button type="button" className="btn btn-p btn-sm" onClick={closeShiftNow} disabled={pending}>{pending ? 'Closing…' : 'Confirm'}</button>
            </span>
          )}
          {signOutLink}
        </span>
      </div>
    );
  }

  if (session && !session.shiftId) {
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ fontSize: '.85rem', margin: '0 0 8px' }}>Checked in as <b>{session.cashierName}</b> — open a shift with your starting float:</p>
        <span style={{ display: 'flex', gap: 6 }}>
          <input className="inp mono" value={floatKes} onChange={(e) => setFloatKes(e.target.value)} placeholder="0" style={{ width: 120, padding: '6px 8px', fontSize: '.8rem' }} inputMode="decimal" />
          <button type="button" className="btn btn-p btn-sm" onClick={openShiftNow} disabled={pending}>{pending ? 'Opening…' : 'Open shift'}</button>
          {signOutLink}
        </span>
        {error && <p className="err" role="alert" style={{ marginTop: 8 }}><Icon name="alert-circle" size={14} />{error}</p>}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div className="fld" style={{ marginBottom: 0, minWidth: 140 }}>
        <label className="lab" htmlFor="cashierpick">Cashier</label>
        <select className="inp" id="cashierpick" value={cashierId} onChange={(e) => setCashierId(e.target.value)} style={{ padding: '8px 10px' }}>
          <option value="">Who's on the till?</option>
          {cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="fld" style={{ marginBottom: 0 }}>
        <label className="lab" htmlFor="cashierpin">PIN</label>
        <input className="inp mono" id="cashierpin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} style={{ width: 100, padding: '8px 10px' }} />
      </div>
      <button type="button" className="btn btn-p btn-sm" onClick={checkIn} disabled={pending || !cashierId || pin.length < 4}>
        {pending ? 'Checking…' : 'Check in'}
      </button>
      {error && <p className="err" role="alert" style={{ margin: 0 }}><Icon name="alert-circle" size={14} />{error}</p>}
    </div>
  );
}
