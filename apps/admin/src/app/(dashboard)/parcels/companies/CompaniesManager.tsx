'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import type { ParcelOrg } from '../actions';
import { APP_URL, STATUSES, statusPill, TeamManager, OrgForm } from './CompanyPanels';

export function CompaniesManager({ orgs, canEdit }: { orgs: ParcelOrg[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const colCount = canEdit ? 7 : 6;

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Company</th><th>Contact</th><th>Staff sign-in link</th>
              <th>Commission</th><th>Team</th><th>Status</th>{canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => <OrgRow key={o.id} org={o} canEdit={canEdit} colCount={colCount} />)}
            {orgs.length === 0 && (
              <tr>
                <td colSpan={colCount} className="sub" style={{ textAlign: 'center', padding: 24 }}>
                  No courier companies yet. Every parcel is on Esoqo-run dispatch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
          {adding ? (
            <OrgForm submitLabel="Onboard company" onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
          ) : (
            <button className="btn btn-o btn-sm" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />Onboard a courier company
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OrgRow({ org, canEdit, colCount }: { org: ParcelOrg; canEdit: boolean; colCount: number }) {
  const [panel, setPanel] = useState<'edit' | 'staff' | null>(null);
  const status = STATUSES.find(([v]) => v === org.status);

  if (panel === 'edit') {
    return (
      <tr>
        <td colSpan={colCount} style={{ padding: 16 }}>
          <OrgForm initial={org} submitLabel="Save changes"
            onDone={() => setPanel(null)} onCancel={() => setPanel(null)} />
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr>
        <td>
          <Link href={`/parcels/companies/${org.id}` as Route} style={{ color: 'inherit', textDecoration: 'none' }}>
            <strong>{org.name}</strong>
          </Link>
          <span className="sub" style={{ display: 'block' }}>
            {org.enterpriseName ?? 'No registered business linked'}
          </span>
        </td>
        <td>
          {org.primaryContactName ? (
            <>
              {org.primaryContactName}
              {org.primaryContactPhone && (
                <span className="mono sub" style={{ display: 'block' }}>{org.primaryContactPhone}</span>
              )}
            </>
          ) : (
            <span className="sub">Not set — add a manager on Team</span>
          )}
        </td>
        <td>
          <a className="mono" href={`${APP_URL}/parcel-co/${org.slug}`} target="_blank" rel="noreferrer">
            {APP_URL}/parcel-co/{org.slug}
          </a>
        </td>
        <td className="mono">{org.commissionPct}%</td>
        <td>
          <span className="mono">{org.activeStaff ?? 0}/{org.staffCount ?? 0}</span>
          <span className="sub" style={{ display: 'block' }}>active</span>
        </td>
        <td>
          <span className={statusPill(org.status)}>{status?.[1] ?? org.status}</span>
        </td>
        {canEdit && (
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <Link className="btn btn-o btn-sm" href={`/parcels/companies/${org.id}` as Route}>Manage</Link>{' '}
            <button className="btn btn-o btn-sm" onClick={() => setPanel(panel === 'staff' ? null : 'staff')}>
              Team
            </button>{' '}
            <button className="btn btn-o btn-sm" onClick={() => setPanel('edit')}>Edit</button>
          </td>
        )}
      </tr>
      {panel === 'staff' && (
        <tr>
          <td colSpan={colCount} style={{ padding: 16, background: 'var(--bg-1, rgba(0,0,0,.02))' }}>
            <TeamManager org={org} />
          </td>
        </tr>
      )}
    </>
  );
}
