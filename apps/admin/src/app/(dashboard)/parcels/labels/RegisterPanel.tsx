'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';
import { Icon } from '@esoqo/ui';
import type { ParcelLabelRegisterRow } from '../actions';

/**
 * The register: every label, at whatever point of its life it reached.
 *
 * What this fixes is not a missing feature but lost data. The only
 * listing that existed filtered on `infoAttachedAt IS NULL`, so the
 * moment a handler wrote down what a label was stuck on and where it
 * was headed, that label dropped out of every screen in the product.
 * The information was recorded and then unreachable — write-only.
 *
 * Four tabs over one table, because it is one lifecycle, not four
 * things. The counts come from the same predicates the tabs filter by
 * (see dbx.ParcelLabelStates), so a tab reading "Filled (12)" opens
 * twelve rows.
 */

const TABS: { state: string; label: string; hint: string }[] = [
  { state: 'all', label: 'All', hint: 'Every label whatever its state' },
  { state: 'blank', label: 'Empty', hint: 'Printed, nothing written on them yet' },
  { state: 'filled', label: 'Filled in', hint: 'A handler recorded an item — not yet a booking' },
  { state: 'spent', label: 'Used', hint: 'Bound to a real parcel — attached to a package' },
  { state: 'voided', label: 'Withdrawn', hint: 'Recalled — can never be booked' },
];

export function RegisterPanel({
  labels, counts, state, orgId,
}: {
  labels: ParcelLabelRegisterRow[]; counts: Record<string, number>;
  state: string; orgId?: string;
}) {
  function tabHref(s: string): Route {
    const params = new URLSearchParams({ state: s });
    if (orgId) params.set('org', orgId);
    return `/parcels/labels?${params}` as Route;
  }

  // Client-side search over the loaded register page — finding one code
  // shouldn't be a round trip. Server tab still scopes the lifecycle.
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toUpperCase();
  const shown = needle
    ? labels.filter((l) =>
        l.code.toUpperCase().includes(needle) ||
        (l.itemDescription ?? '').toUpperCase().includes(needle) ||
        (l.destination ?? '').toUpperCase().includes(needle) ||
        (l.senderName ?? '').toUpperCase().includes(needle) ||
        (l.orgName ?? '').toUpperCase().includes(needle))
    : labels;
  const emptyCount = counts['blank'] ?? 0;
  const attachedCount = (counts['filled'] ?? 0) + (counts['spent'] ?? 0);

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>Label register</strong>
      <p className="sub" style={{ margin: '0 0 10px' }}>
        {emptyCount} empty · {attachedCount} attached to packages
        {orgId ? ' · this company’s pad' : ' · all companies + Esoqo pool'}
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <Link key={t.state} href={tabHref(t.state)} title={t.hint}
            className={`btn btn-sm ${t.state === state ? 'btn-p' : 'btn-o'}`}>
            {t.label} ({counts[t.state] ?? 0})
          </Link>
        ))}
      </div>

      {labels.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>
          {TABS.find((t) => t.state === state)?.hint}. None right now.
        </p>
      ) : (
        <>
        <input
          className="mono" value={filter} placeholder="Find a code, item, destination, sender or company…"
          aria-label="Filter this list"
          onChange={(e) => setFilter(e.target.value.toUpperCase())}
          style={{ width: '100%', maxWidth: 460, padding: '8px 10px', border: '1.5px solid var(--line)', borderRadius: 6, marginBottom: 12 }}
        />
        {shown.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>No matches for “{filter.trim()}” in this list.</p>
        ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Code</th><th>Company</th><th>Item</th><th>Destination</th><th>Sender</th>
              <th>{state === 'voided' ? 'Why' : 'When'}</th><th />
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.code}>
                <td className="mono">{l.code}</td>
                <td style={CLIP} title={l.orgName ?? ''}>{l.orgName ?? <span className="sub">Esoqo pool</span>}</td>
                <td style={CLIP} title={l.itemDescription ?? ''}>{l.itemDescription ?? <span className="sub">—</span>}</td>
                <td style={CLIP} title={l.destination ?? ''}>{l.destination ?? <span className="sub">—</span>}</td>
                <td style={CLIP} title={l.senderName ?? ''}>{l.senderName ?? <span className="sub">—</span>}</td>
                <td className="sub" style={{ fontSize: '.8rem' }}>
                  {state === 'voided'
                    ? (l.voidedReason ?? 'Withdrawn')
                    : whenFor(l)}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {/* A spent label's real home is the parcel it became;
                      sending someone to the attach form for it would
                      only produce a refusal. */}
                  {l.usedAt ? (
                    <Link className="btn btn-o btn-sm" href={`/parcels?q=${encodeURIComponent(l.code)}` as Route}>
                      <Icon name="eye" size={13} />Parcel
                    </Link>
                  ) : !l.voidedAt ? (
                    <Link className="btn btn-o btn-sm" href={`/parcels/counter?code=${encodeURIComponent(l.code)}` as Route}>
                      <Icon name="send" size={13} />{l.infoAttachedAt ? 'Resume' : 'Fill in'}
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </>
        )}
    </div>
  );
}

/** The most recent thing that happened to this label, which is the
 *  only date worth a column. */
function whenFor(l: ParcelLabelRegisterRow): string {
  const stamp = l.usedAt ?? l.infoAttachedAt ?? l.createdAt;
  return new Date(stamp).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

const CLIP = { maxWidth: 180, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const };
