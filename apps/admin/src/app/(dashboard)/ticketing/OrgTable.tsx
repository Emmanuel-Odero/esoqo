'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { actionModerateOrg } from './actions';

interface OrgRow {
  id: string; name: string; slug: string; vertical: string; status: string;
  owner: string; staffCount: number; listingCount: number; createdAt: string;
}

const STATUS_PILL: Record<string, string> = { ACTIVE: 'p-ok', DRAFT: 'p-warn', SUSPENDED: 'p-bad' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', DRAFT: 'Draft', SUSPENDED: 'Suspended' };
const VERTICAL_LABEL: Record<string, string> = { EVENTS: 'Events / tours', TRANSPORT: 'Transport' };

export function OrgTable({
  rows, canModerate, canManageStaff, q, status,
}: { rows: OrgRow[]; canModerate: boolean; canManageStaff: boolean; q: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function moderate(orgId: string, next: 'ACTIVE' | 'SUSPENDED') {
    setError(null);
    start(async () => {
      const r = await actionModerateOrg(orgId, next);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <>
      <div className="ctl">
        <form className="srch" style={{ display: 'contents' }}>
          <div className="srch">
            <span className="mg"><Icon name="search" size={16} /></span>
            <input className="inp" name="q" defaultValue={q} aria-label="Search organisers"
              placeholder="Organiser name…" />
          </div>
          <select className="inp" name="status" aria-label="Filter by status" defaultValue={status}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="btn btn-o" type="submit"><Icon name="filter" size={15} />Filter</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty">
            <span className="ico"><Icon name="tag" size={22} /></span>
            <h3>No organisers match</h3>
            <p style={{ margin: 0 }}>They appear here once a business registers a ticketing organiser.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Organiser</th><th>Type</th><th>Owner</th><th className="num">Staff</th><th className="num">Listings</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.name}</strong>
                    <span className="sub" style={{ display: 'block' }}>{o.slug}</span>
                  </td>
                  <td>{VERTICAL_LABEL[o.vertical] ?? o.vertical}</td>
                  <td>{o.owner}</td>
                  <td className="num">{o.staffCount}</td>
                  <td className="num">{o.listingCount}</td>
                  <td><span className={`pill ${STATUS_PILL[o.status]}`}>{STATUS_LABEL[o.status] ?? o.status}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canModerate && (
                      o.status === 'SUSPENDED' ? (
                        <button className="btn btn-o btn-sm" disabled={pending} style={{ marginRight: 8 }}
                          onClick={() => moderate(o.id, 'ACTIVE')}>Reinstate</button>
                      ) : (
                        <button className="btn btn-o btn-sm" disabled={pending} style={{ marginRight: 8 }}
                          onClick={() => moderate(o.id, 'SUSPENDED')}>Suspend</button>
                      )
                    )}
                    <Link className="btn btn-p btn-sm" href={`/ticketing/${o.id}` as Route}>
                      <Icon name={canManageStaff ? 'users' : 'eye'} size={13} />
                      {canManageStaff ? 'Manage' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: '.85rem', marginTop: 10 }}>{error}</p>}
    </>
  );
}
