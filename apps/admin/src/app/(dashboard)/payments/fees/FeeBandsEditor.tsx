'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { actionCreateFeeBand, actionDeleteFeeBand } from './actions';

type Kind = 'WALLET_WITHDRAWAL' | 'THIRDPARTY_PAYOUT';

interface Band {
  id: string; kind: Kind; minKes: number; maxKes: number; feeKes: number; updatedAt: string;
}

const KIND_LABEL: Record<Kind, string> = {
  WALLET_WITHDRAWAL: 'Wallet withdrawal (own M-Pesa number)',
  THIRDPARTY_PAYOUT: 'Third-party M-Pesa payout',
};

function emptyDraft() { return { minKes: '', maxKes: '', feeKes: '' }; }

export function FeeBandsEditor({ bands, canEdit }: { bands: Band[]; canEdit: boolean }) {
  const [drafts, setDrafts] = useState<Record<Kind, { minKes: string; maxKes: string; feeKes: string }>>({
    WALLET_WITHDRAWAL: emptyDraft(),
    THIRDPARTY_PAYOUT: emptyDraft(),
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function addBand(kind: Kind) {
    setError(null);
    const draft = drafts[kind];
    const minKes = Number(draft.minKes);
    const maxKes = Number(draft.maxKes);
    const feeKes = Number(draft.feeKes);
    if (!Number.isFinite(minKes) || !Number.isFinite(maxKes) || !Number.isFinite(feeKes)) {
      setError('Enter numbers for min, max and fee');
      return;
    }
    setPendingId(`new-${kind}`);
    startTransition(async () => {
      const result = await actionCreateFeeBand(kind, minKes, maxKes, feeKes);
      if (!result.ok) setError(result.error);
      else setDrafts((d) => ({ ...d, [kind]: emptyDraft() }));
      setPendingId(null);
    });
  }

  function removeBand(id: string) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await actionDeleteFeeBand(id);
      if (!result.ok) setError(result.error);
      setPendingId(null);
    });
  }

  const kinds: Kind[] = ['WALLET_WITHDRAWAL', 'THIRDPARTY_PAYOUT'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {kinds.map((kind) => {
        const rows = bands.filter((b) => b.kind === kind).sort((a, b) => a.minKes - b.minKes);
        const draft = drafts[kind];
        return (
          <div className="card" style={{ padding: 0 }} key={kind}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <strong>{KIND_LABEL[kind]}</strong>
              <span className="sub mono" style={{ display: 'block' }}>{kind}</span>
            </div>
            <table className="tbl">
              <thead>
                <tr><th className="num">Min (KES)</th><th className="num">Max (KES)</th><th className="num">Fee (KES)</th><th>Updated</th>{canEdit && <th />}</tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td className="num mono">{b.minKes.toLocaleString('en-KE')}</td>
                    <td className="num mono">{b.maxKes.toLocaleString('en-KE')}</td>
                    <td className="num mono">{b.feeKes.toLocaleString('en-KE')}</td>
                    <td className="sub">{new Date(b.updatedAt).toLocaleDateString('en-KE')}</td>
                    {canEdit && (
                      <td>
                        <button
                          className="btn btn-o btn-sm"
                          disabled={pending && pendingId === b.id}
                          onClick={() => removeBand(b.id)}
                        >
                          {pending && pendingId === b.id ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={canEdit ? 5 : 4} className="sub">No bands set — this transaction kind is currently free.</td></tr>
                )}
                {canEdit && (
                  <tr>
                    <td className="num">
                      <input className="mono" style={{ width: 90, textAlign: 'right' }} placeholder="min"
                        value={draft.minKes} onChange={(e) => setDrafts((d) => ({ ...d, [kind]: { ...d[kind], minKes: e.target.value } }))} />
                    </td>
                    <td className="num">
                      <input className="mono" style={{ width: 90, textAlign: 'right' }} placeholder="max"
                        value={draft.maxKes} onChange={(e) => setDrafts((d) => ({ ...d, [kind]: { ...d[kind], maxKes: e.target.value } }))} />
                    </td>
                    <td className="num">
                      <input className="mono" style={{ width: 90, textAlign: 'right' }} placeholder="fee"
                        value={draft.feeKes} onChange={(e) => setDrafts((d) => ({ ...d, [kind]: { ...d[kind], feeKes: e.target.value } }))} />
                    </td>
                    <td />
                    <td>
                      <button className="btn btn-o btn-sm" disabled={pending && pendingId === `new-${kind}`} onClick={() => addBand(kind)}>
                        {pending && pendingId === `new-${kind}` ? 'Adding…' : 'Add band'}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
      {error && (
        <p role="alert" style={{ color: 'var(--red)', fontSize: '.85rem', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="alert-circle" size={14} />{error}
        </p>
      )}
    </div>
  );
}
