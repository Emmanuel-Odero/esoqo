'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionSetActive, actionUpdateLabel } from './actions';

interface Row {
  id: string; key: string; label: string; category: string; patternKey: string; active: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  HERO: 'Hero (homepage cover)', GALLERY: 'Gallery', POST: 'Post cover',
};

export function MediaLibraryTable({ rows, canWrite }: { rows: Row[]; canWrite: boolean }) {
  const groups = Object.entries(CATEGORY_LABEL).map(([cat, label]) => ({
    cat, label, items: rows.filter((r) => r.category === cat),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {groups.map((g) => (
        <div key={g.cat} className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
            <strong>{g.label}</strong>
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Label</th><th>Key</th><th>Pattern</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {g.items.map((row) => <MediaRow key={row.id} row={row} canWrite={canWrite} />)}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function MediaRow({ row, canWrite }: { row: Row; canWrite: boolean }) {
  const [label, setLabel] = useState(row.label);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  function saveLabel() {
    if (label.trim() === row.label || !label.trim()) { setLabel(row.label); return; }
    start(async () => {
      const r = await actionUpdateLabel(row.id, label);
      if (r.ok) announce(`Renamed to ${label}`, 'polite');
      else { setLabel(row.label); announce(r.error, 'assertive'); }
    });
  }

  function toggle() {
    start(async () => {
      const r = await actionSetActive(row.id, !row.active);
      if (r.ok) announce(row.active ? `${row.label} disabled` : `${row.label} enabled`, 'polite');
      else announce(r.error, 'assertive');
    });
  }

  return (
    <tr>
      <td>
        {canWrite ? (
          <input
            className="inp" value={label} disabled={pending}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={saveLabel}
            style={{ maxWidth: 220 }}
          />
        ) : row.label}
      </td>
      <td className="sub mono">{row.key}</td>
      <td className="sub">{row.patternKey}</td>
      <td>
        <span className={`pill ${row.active ? 'p-ok' : 'p-mute'}`}>{row.active ? 'Active' : 'Disabled'}</span>
      </td>
      <td>
        {canWrite && (
          <button className="btn btn-o btn-sm" disabled={pending} onClick={toggle}>
            <Icon name={row.active ? 'ban' : 'check'} size={13} />
            {row.active ? 'Disable' : 'Enable'}
          </button>
        )}
      </td>
    </tr>
  );
}
