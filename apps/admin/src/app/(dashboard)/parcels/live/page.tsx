import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/session';
import { actionGetLiveDispatch } from '../actions';
import { LiveMap } from './LiveMap';
import { LiveRefresh } from '../../registrations/LiveRefresh';

export const dynamic = 'force-dynamic';

export default async function ParcelLiveDispatchPage() {
  const ctx = await requireStaff();
  if (!ctx.capabilities.includes('*') && !ctx.capabilities.includes('parcels.read')) redirect('/');

  const { couriers, parcels } = await actionGetLiveDispatch();

  return (
    <>
      <div className="head">
        <div>
          <h1>Live dispatch</h1>
          <p>
            Every active courier&apos;s last-known position, plus any parcel still waiting for one or
            running past its SLA. Refreshes on its own every few seconds.
          </p>
        </div>
        <LiveRefresh />
      </div>

      <div className="kpis" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="kpi g">
          <span className="l">Couriers online</span>
          <span className="n">{couriers.length}</span>
        </div>
        <div className={`kpi ${parcels.some((p) => p.Overdue) ? 'r' : ''}`}>
          <span className="l">Needs attention</span>
          <span className="n" style={{ color: parcels.some((p) => p.Overdue) ? 'var(--red)' : undefined }}>{parcels.length}</span>
          <span className="sub">Unassigned or past SLA</span>
        </div>
      </div>

      <LiveMap couriers={couriers} parcels={parcels} />
    </>
  );
}
