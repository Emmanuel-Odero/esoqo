import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import { actionListParcelOrgs } from '../actions';
import { CompaniesManager } from './CompaniesManager';

export const dynamic = 'force-dynamic';

/**
 * Courier companies as tenants.
 *
 * Until this page existed, every parcel on the platform belonged to
 * Esoqo-run dispatch and a partner courier firm logged into nothing at
 * all — two of the product's six personas (a parcel company, and its
 * employees) had no surface whatsoever. Onboarding one here gives it a
 * sign-in URL, its own staff PINs, its own rate card and a share of
 * what its parcels earn.
 */
export default async function ParcelCompaniesPage() {
  const ctx = await requireStaff();
  const canEdit = ctx.capabilities.includes('*') || ctx.capabilities.includes('parcels.edit');
  const orgs = await actionListParcelOrgs();

  const active = orgs.filter((o) => o.status === 'ACTIVE').length;
  const draft = orgs.filter((o) => o.status === 'DRAFT').length;
  const suspended = orgs.filter((o) => o.status === 'SUSPENDED').length;
  const people = orgs.reduce((n, o) => n + (o.activeStaff ?? 0), 0);
  const parcels = orgs.reduce((n, o) => n + (o.parcelCount ?? 0), 0);
  const earnings = orgs.reduce((n, o) => n + Number(o.earningsKes ?? 0), 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Courier companies</h1>
          <p>
            Partner firms that carry parcels on Esoqo. Each gets its own staff sign-in link, its
            own riders and a commission split — parcels with no company stay on Esoqo-run dispatch.
          </p>
        </div>
        <Link href="/parcels/companies/payouts" className="btn btn-o btn-sm">
          Manual payouts
        </Link>
      </div>

      {!canEdit && (
        <div className="chain" style={{ background: 'var(--blue-t)', border: '1px solid #C8DDEC', color: 'var(--blue)' }}>
          <Icon name="info" size={18} />
          <span>
            You can see courier companies but not change them. Editing requires the{' '}
            <code className="mono">parcels.edit</code> permission.
          </span>
        </div>
      )}

      {draft > 0 && (
        <div className="chain" style={{ background: 'var(--amber-t)', border: '1px solid #E8D2A0', color: 'var(--amber)', marginBottom: 16 }}>
          <Icon name="alert-triangle" size={18} />
          <span>
            {draft} {draft === 1 ? 'company is' : 'companies are'} still a draft. A draft
            company&apos;s sign-in link doesn&apos;t work and no parcels route to it — set it
            active once its first manager has a PIN.
          </span>
        </div>
      )}

      <div className="kpis" style={{ marginBottom: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="kpi g">
          <span className="l">Active companies</span>
          <span className="n">{active}</span>
          <span className="sub">
            {orgs.length} total{ suspended > 0 ? ` · ${suspended} suspended` : '' }
          </span>
        </div>
        <div className="kpi">
          <span className="l">Onboarding</span>
          <span className="n">{draft}</span>
          <span className="sub">Draft — not yet live</span>
        </div>
        <div className="kpi">
          <span className="l">People</span>
          <span className="n">{people}</span>
          <span className="sub">Active logins across all companies</span>
        </div>
        <div className="kpi">
          <span className="l">Parcels carried</span>
          <span className="n">{parcels}</span>
          <span className="sub">KES {earnings.toLocaleString('en-KE', { maximumFractionDigits: 0 })} earned by partners</span>
        </div>
      </div>

      <CompaniesManager orgs={orgs} canEdit={canEdit} />
    </>
  );
}
