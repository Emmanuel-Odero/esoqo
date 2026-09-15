'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import {
  actionFindStorageCustomerByPhone, actionCreateStorageAgreement,
  actionEndStorageAgreement, actionBillStoragePeriod,
} from '../actions';

interface Agreement {
  id: string; tenantWork: string; feeKes: number; billingPeriod: string;
  unitLabel: string | null; startedAt: string; endedAt: string | null;
}

const kes = (n: number) => 'KES ' + n.toLocaleString('en-KE');

/** Shown on a WAREHOUSE organisation's detail page — storage agreements
 *  and the manual "Bill this period" trigger. There is deliberately no
 *  cron here: billing is always staff-triggered, the same
 *  reactive/idempotent shape as every other recurring-payment-shaped
 *  feature in this codebase. */
export function WarehousePanel({
  warehouseOrgId, agreements: initial,
}: { warehouseOrgId: string; agreements: Agreement[] }) {
  const [agreements, setAgreements] = useState(initial);
  const [phone, setPhone] = useState('');
  const [candidates, setCandidates] = useState<{ id: string; workRaw: string }[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [fee, setFee] = useState('');
  const [period, setPeriod] = useState<'MONTHLY' | 'PER_UNIT'>('MONTHLY');
  const [unitLabel, setUnitLabel] = useState('');
  const [billMsg, setBillMsg] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const active = agreements.filter((a) => !a.endedAt);
  const ended = agreements.filter((a) => a.endedAt);

  function lookup() {
    setLookupError(null);
    setCandidates(null);
    startTransition(async () => {
      const res = await actionFindStorageCustomerByPhone(phone);
      if (!res.ok) { setLookupError(res.error); return; }
      setCandidates(res.enterprises);
    });
  }

  function createAgreement(tenantEnterpriseId: string) {
    const feeKes = Number(fee);
    if (!feeKes || feeKes <= 0) { setLookupError('Enter a fee above zero'); return; }
    startTransition(async () => {
      const res = await actionCreateStorageAgreement(warehouseOrgId, tenantEnterpriseId, feeKes, period, unitLabel || undefined);
      if (!res.ok) { setLookupError(res.error); return; }
      setCandidates(null); setPhone(''); setFee(''); setUnitLabel('');
      window.location.reload();
    });
  }

  function end(agreementId: string) {
    if (!confirm('End this storage agreement?')) return;
    startTransition(async () => {
      const res = await actionEndStorageAgreement(agreementId);
      if (res.ok) {
        setAgreements((as) => as.map((a) => (a.id === agreementId ? { ...a, endedAt: new Date().toISOString() } : a)));
      }
    });
  }

  function bill(agreementId: string) {
    setBillMsg((m) => ({ ...m, [agreementId]: '' }));
    startTransition(async () => {
      const res = await actionBillStoragePeriod(agreementId);
      setBillMsg((m) => ({ ...m, [agreementId]: res.ok ? 'Billed this period ✓' : res.error }));
    });
  }

  return (
    <div className="card" style={{ marginTop: 22 }}>
      <h2><Icon name="coins" size={17} />Storage billing</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label className="sub" htmlFor="wh-phone" style={{ display: 'block', marginBottom: 6 }}>
            Add storage customer — phone number
          </label>
          <input id="wh-phone" className="inp" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="07…" style={{ width: 160 }} />
        </div>
        <div>
          <label className="sub" htmlFor="wh-fee" style={{ display: 'block', marginBottom: 6 }}>Fee (KES)</label>
          <input id="wh-fee" className="inp" type="number" value={fee} onChange={(e) => setFee(e.target.value)}
            placeholder="5000" style={{ width: 110 }} />
        </div>
        <div>
          <label className="sub" htmlFor="wh-period" style={{ display: 'block', marginBottom: 6 }}>Billing</label>
          <select id="wh-period" className="inp" value={period} onChange={(e) => setPeriod(e.target.value as 'MONTHLY' | 'PER_UNIT')} style={{ width: 130 }}>
            <option value="MONTHLY">Monthly</option>
            <option value="PER_UNIT">Per unit</option>
          </select>
        </div>
        <div>
          <label className="sub" htmlFor="wh-unit" style={{ display: 'block', marginBottom: 6 }}>Unit (optional)</label>
          <input id="wh-unit" className="inp" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)}
            placeholder="Bay 3" style={{ width: 120 }} />
        </div>
        <button className="btn btn-o btn-sm" disabled={pending} onClick={lookup}>Look up</button>
        {lookupError && <span className="sub" style={{ color: 'var(--red)' }}>{lookupError}</span>}
      </div>

      {candidates && candidates.length > 0 && (
        <div className="card" style={{ padding: 10, marginBottom: 16, background: 'var(--bg-2)' }}>
          <p className="sub" style={{ marginTop: 0 }}>Which business?</p>
          {candidates.map((c) => (
            <button key={c.id} className="btn btn-p btn-sm" style={{ marginRight: 8, marginBottom: 6 }}
              disabled={pending} onClick={() => createAgreement(c.id)}>
              {c.workRaw}
            </button>
          ))}
        </div>
      )}

      <table className="tbl">
        <thead><tr><th>Customer</th><th>Fee</th><th>Billing</th><th>Unit</th><th /><th /></tr></thead>
        <tbody>
          {active.length === 0 ? (
            <tr><td colSpan={6} className="empty">No active storage agreements yet.</td></tr>
          ) : active.map((a) => (
            <tr key={a.id}>
              <td>{a.tenantWork}</td>
              <td className="mono">{kes(a.feeKes)}</td>
              <td className="sub">{a.billingPeriod === 'MONTHLY' ? 'Monthly' : 'Per unit'}</td>
              <td className="sub">{a.unitLabel ?? '—'}</td>
              <td>
                <button className="btn btn-p btn-sm" disabled={pending} onClick={() => bill(a.id)}>
                  Bill this period
                </button>
                {billMsg[a.id] && <div className="sub" style={{ fontSize: '.75rem', marginTop: 4 }}>{billMsg[a.id]}</div>}
              </td>
              <td>
                <button className="btn btn-o btn-sm" disabled={pending} onClick={() => end(a.id)}>End</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {ended.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary className="sub" style={{ cursor: 'pointer' }}>{ended.length} past agreement{ended.length !== 1 ? 's' : ''}</summary>
          <table className="tbl" style={{ marginTop: 8 }}>
            <tbody>
              {ended.map((a) => (
                <tr key={a.id}>
                  <td>{a.tenantWork}</td>
                  <td className="mono sub">{kes(a.feeKes)}</td>
                  <td className="mono sub" style={{ fontSize: '.79rem' }}>ended {a.endedAt?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
