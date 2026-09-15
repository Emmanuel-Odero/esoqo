'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { actionUpdatePricing } from '../actions';

interface Rule {
  key: string; label: string; amountKes: number | null; amountPct: number | null;
  billingPeriod: string; updatedAt: string;
}

const BILLING_LABEL: Record<string, string> = { ONE_TIME: 'One-time', MONTHLY: 'Monthly', PER_ORDER: '% per order' };

export function PricingRulesEditor({ rules, canEdit }: { rules: Rule[]; canEdit: boolean }) {
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(rules.map((r) => [r.key, r.amountPct !== null ? String(r.amountPct) : String(r.amountKes ?? 0)])),
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(rule: Rule) {
    setError(null);
    setPendingKey(rule.key);
    const value = Number(drafts[rule.key]);
    startTransition(async () => {
      const result = rule.amountPct !== null
        ? await actionUpdatePricing(rule.key, null, value)
        : await actionUpdatePricing(rule.key, value, null);
      if (!result.ok) setError(result.error);
      setPendingKey(null);
    });
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="tbl">
        <thead><tr><th>Rule</th><th className="num">Amount</th><th>Billing</th><th>Updated</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.key}>
              <td><strong>{r.label}</strong><span className="sub mono" style={{ display: 'block' }}>{r.key}</span></td>
              <td className="num">
                {canEdit ? (
                  <input
                    className="mono"
                    style={{ width: 90, textAlign: 'right', padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 6 }}
                    value={drafts[r.key] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))}
                  />
                ) : (
                  <span className="mono">{r.amountPct !== null ? `${r.amountPct}%` : `KES ${(r.amountKes ?? 0).toLocaleString('en-KE')}`}</span>
                )}
              </td>
              <td>{BILLING_LABEL[r.billingPeriod] ?? r.billingPeriod}</td>
              <td className="sub">{new Date(r.updatedAt).toLocaleDateString('en-KE')}</td>
              {canEdit && (
                <td>
                  <button className="btn btn-o btn-sm" disabled={pending && pendingKey === r.key} onClick={() => save(r)}>
                    {pending && pendingKey === r.key ? 'Saving…' : 'Save'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {error && (
        <p role="alert" style={{ padding: '10px 14px', color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}
