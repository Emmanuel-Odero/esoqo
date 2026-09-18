'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@esoqo/ui';
import { actionUpdateParcelOrg, type ParcelOrgDetail } from '../../actions';
import {
  APP_URL, MiniKpi, OrgForm, TeamManager,
  activityLabel, kes, orgToInput, statusPill, statusLabel,
} from '../CompanyPanels';

export function CompanyDetail({ detail, canEdit }: { detail: ParcelOrgDetail; canEdit: boolean }) {
  const { org, stats, staff, activity } = detail;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const nextStatus = org.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';

  function changeStatus(status: string) {
    setError(null);
    startTransition(async () => {
      const result = await actionUpdateParcelOrg(org.id, orgToInput(org, { status }));
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${APP_URL}/parcel-co/${org.slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the sign-in link manually.');
    }
  }

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {org.logoUrl ? (
            <img src={org.logoUrl} alt={`${org.name} logo`}
              style={{ height: 44, maxWidth: 160, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 8, padding: 4, background: '#fff' }} />
          ) : null}
          <div>
          <Link
            href="/parcels/companies"
            className="sub"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
          >
            <Icon name="arrow-left" size={14} />All courier companies
          </Link>
          <h1 style={{ margin: '6px 0 2px' }}>{org.name}</h1>
          <p className="sub" style={{ margin: 0 }}>
            {org.enterpriseName ?? 'No registered business linked'} ·{' '}
            <span className="mono">/parcel-co/{org.slug}</span>
            {org.logoUrl ? ' · branded labels' : ' · Esoqo-branded labels'}
          </p>
          </div>
        </div>
        <div className="actions">
          <span className={statusPill(org.status)} style={{ alignSelf: 'center' }}>{statusLabel(org.status)}</span>
          {canEdit && (
            <>
              <button className="btn btn-o btn-sm" onClick={copyLink}>
                <Icon name={copied ? 'check' : 'document'} size={13} />
                {copied ? 'Link copied' : 'Copy sign-in link'}
              </button>
              <button className="btn btn-o btn-sm" disabled={pending} onClick={() => changeStatus(nextStatus)}>
                {pending ? 'Saving…' : nextStatus === 'ACTIVE' ? (org.status === 'DRAFT' ? 'Activate' : 'Reactivate') : 'Suspend'}
              </button>
            </>
          )}
        </div>
      </div>

      <nav className="ctabs" aria-label="Company sections">
        <a href="#overview">Overview</a>
        <a href="#team">Team</a>
        <a href="#profile">Profile</a>
        <a href="#activity">Activity</a>
      </nav>

      {error && (
        <div className="chain bad" style={{ marginBottom: 16 }}>
          <Icon name="alert-circle" size={16} />{error}
        </div>
      )}

      <section id="overview" className="cdetail-sec">
        <h2>Overview</h2>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <MiniKpi label="Parcels carried" value={String(org.parcelCount ?? 0)} />
          <MiniKpi label="Delivered" value={String(org.deliveredCount ?? 0)} />
          <MiniKpi label="In flight now" value={String(stats.inTransit)} />
          <MiniKpi label="Awaiting pickup" value={String(stats.awaitingPickup)} />
          <MiniKpi label="Failed attempts" value={String(stats.failedDeliveries)} />
          <MiniKpi label="At pickup points" value={String(stats.atAgent)} />
          <MiniKpi label="Delivered today" value={String(stats.deliveredToday)} />
          <MiniKpi label="Esoqo earnings" value={kes(org.earningsKes)} />
        </div>

        <div className="card">
          <h2>Business profile</h2>
          <dl className="dl-grid">
            <dt className="sub">Registered business</dt><dd>{org.enterpriseName ?? '—'}</dd>
            <dt className="sub">Sign-in slug</dt><dd className="mono">/parcel-co/{org.slug}</dd>
            <dt className="sub">Esoqo commission</dt><dd>{org.commissionPct}%</dd>
            <dt className="sub">Company phone</dt><dd className="mono">{org.contactPhone ?? '—'}</dd>
            <dt className="sub">Settlement M-Pesa</dt><dd className="mono">{org.settlementPhone ?? '—'}</dd>
            <dt className="sub">Walk-in desk</dt><dd>{org.acceptsWalkIn ? (org.locationHint ?? 'Yes') : 'No'}</dd>
            <dt className="sub">Opening hours</dt><dd>{org.openingHours ?? '—'}</dd>
          </dl>
        </div>
      </section>

      <section id="team" className="cdetail-sec">
        <h2>Team</h2>
        <div className="card">
          <TeamManager org={org} initialStaff={staff} canEdit={canEdit} />
        </div>
      </section>

      <section id="profile" className="cdetail-sec">
        <h2>Company profile</h2>
        <div className="card">
          {!canEdit ? (
            <p className="sub">Editing requires the parcels.edit permission.</p>
          ) : editing ? (
            <OrgForm
              initial={org}
              submitLabel="Save changes"
              onDone={() => { setEditing(false); router.refresh(); }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <button className="btn btn-o btn-sm" onClick={() => setEditing(true)}>Edit profile</button>
          )}
        </div>
      </section>

      <section id="activity" className="cdetail-sec">
        <h2>Activity</h2>
        <div className="card">
          {activity.length === 0 ? (
            <p className="sub">No activity recorded yet.</p>
          ) : (
            <ul className="activity">
              {activity.map((a, i) => (
                <li key={i}>
                  <span className="mono sub">{a.occurredAt.replace('T', ' ').replace('Z', '')}</span>
                  <span>{activityLabel(a.action)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
