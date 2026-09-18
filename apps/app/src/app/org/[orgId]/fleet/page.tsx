import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { displayKES } from '@esoqo/domain';
import { Icon } from '@esoqo/ui';
import { requireOrgAccess } from '@/lib/session';
import { canOrg, orgGo, orgForCan, type GoOrg } from '@/lib/ticketing';
import {
  activeTrails, getFleetOverview, latestPositions, listFleetCrew, listFleetTrips,
  listFleetVehicles, listShortRoutes,
  type ActiveTrail, type CrewMember, type FleetTrip,
  type FleetVehicle, type ShortRoute, type VehiclePosition,
} from '@/lib/fleet';
import { DispatchPanel } from './DispatchPanel';
import { LiveFleetMap } from './LiveFleetMap';

export const dynamic = 'force-dynamic';

/**
 * The fleet manager's console — the "overview, live map, dispatch" a
 * transport company is actually paying for. Reads come from core-go's
 * fleet endpoints (all org-scoped, all capability-checked); the TS ctx
 * here only decides what to draw, never what is allowed (ADR-0003).
 *
 * Deliberately separate from the ticketing dashboard: a manager who runs
 * buses cares about vehicles on the road and today's cash-up, not
 * listings and ticket classes.
 */
export default async function FleetPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { ctx } = await requireOrgAccess(orgId);
  const org = await orgGo<{ org: GoOrg }>(orgId, `/v1/ticketorgs/${orgId}`)
    .then((r) => orgForCan(r.org))
    .catch(() => null);
  if (!org) notFound();

  if (!canOrg(ctx, org, 'fleet.read')) notFound();

  const canTrack = canOrg(ctx, org, 'vehicle.track');
  const canReadTrips = canOrg(ctx, org, 'trip.read');
  const canDispatch = canOrg(ctx, org, 'trip.write');
  const canPrice = canOrg(ctx, org, 'fleet.write');
  const canReadCrew = canOrg(ctx, org, 'crew.read');

  // Each read is independently guarded: a custom role that can see the
  // fleet but not, say, crew.read should still get a working console
  // rather than a page that 403s on one section.
  const [overview, positions, trails, trips, vehicles, crew, routes] = await Promise.all([
    getFleetOverview(orgId).catch(() => null),
    canTrack ? latestPositions(orgId).catch(() => [] as VehiclePosition[]) : Promise.resolve([] as VehiclePosition[]),
    canTrack ? activeTrails(orgId).catch(() => [] as ActiveTrail[]) : Promise.resolve([] as ActiveTrail[]),
    canReadTrips ? listFleetTrips(orgId).catch(() => [] as FleetTrip[]) : Promise.resolve([] as FleetTrip[]),
    listFleetVehicles(orgId).catch(() => [] as FleetVehicle[]),
    canReadCrew ? listFleetCrew(orgId).catch(() => [] as CrewMember[]) : Promise.resolve([] as CrewMember[]),
    listShortRoutes(orgId).catch(() => [] as ShortRoute[]),
  ]);

  // "Today" for the closed list: trips that ended since local midnight.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const activeTrips = trips.filter((t) => t.Status === 'ACTIVE');
  const recentTrips = trips.filter(
    (t) => t.Status !== 'ACTIVE' && t.EndedAt && new Date(t.EndedAt) >= startOfDay,
  );

  const kpis: { k: string; v: string; h: string; icon: React.ReactNode }[] = [];
  if (overview) {
    kpis.push(
      { k: 'On the road', v: String(overview.activeTrips), h: `${overview.vehiclesOnRoad} vehicle${overview.vehiclesOnRoad === 1 ? '' : 's'}`, icon: <Icon name="truck" size={17} /> },
      { k: 'Reporting now', v: String(overview.reportingVehicles), h: 'pinged in the last 15 min', icon: <Icon name="pin" size={17} /> },
      { k: 'Fares today', v: `KES ${displayKES(overview.faresTodayKes)}`, h: `${overview.faresTodayCount} payment${overview.faresTodayCount === 1 ? '' : 's'}`, icon: <Icon name="coins" size={17} /> },
      { k: 'Declared cash', v: `KES ${displayKES(overview.declaredCashTodayKes)}`, h: 'counted by crew today', icon: <Icon name="bank" size={17} /> },
    );
  }

  return (
    <>
      <div className="mehead">
        <h1>{org.name}</h1>
        <p>Fleet · {org.status.toLowerCase()}</p>
      </div>

      {kpis.length > 0 && (
        <section className="stat-grid" aria-label="Fleet overview">
          {kpis.map((kpi) => (
            <div className="tile" key={kpi.k}>
              <span className="icbox" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>{kpi.icon}</span>
              <span className="tile-k">{kpi.k}</span>
              <span className="tile-v">{kpi.v}</span>
              <span className="tile-h">{kpi.h}</span>
            </div>
          ))}
        </section>
      )}

      {overview && overview.cashVarianceTodayKes !== '0.00' && Number(overview.cashVarianceTodayKes) !== 0 && (
        <div className="mcard" style={{ marginBottom: 16, borderColor: 'var(--amber)' }}>
          <h2><Icon name="alert-triangle" size={18} />Cash variance today</h2>
          <p style={{ margin: 0 }} className="mono">
            Cash fares KES {displayKES(overview.cashFaresTodayKes)} vs declared KES {displayKES(overview.declaredCashTodayKes)}
            {' '}— variance <strong>KES {displayKES(overview.cashVarianceTodayKes)}</strong>.
          </p>
        </div>
      )}

      {canTrack && (
        <section aria-label="Live map" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ fontSize: '.98rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
              <Icon name="pin" size={18} />Where the fleet is now
            </h2>
            <span className="sub" style={{ fontSize: '.8rem' }}>
              {positions.length} reporting · lines show the last hour
            </span>
          </div>
          {positions.length === 0 && trails.length === 0 ? (
            <div className="mcard"><p className="sub" style={{ margin: 0 }}>No positions yet — crew phones report as trips move.</p></div>
          ) : (
            <LiveFleetMap positions={positions} trails={trails} />
          )}
        </section>
      )}

      <DispatchPanel
        orgId={orgId}
        activeTrips={activeTrips}
        recentTrips={recentTrips}
        vehicles={vehicles}
        crew={crew}
        routes={routes}
        canDispatch={canDispatch}
      />

      <div className="dash-cols" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        <Link href={`/org/${orgId}/fleet/pricing` as Route} className="mcard" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <h2><Icon name="coins" size={18} />Pricing &amp; routes</h2>
          <p style={{ margin: 0, color: 'var(--tx-2)', fontSize: '.9rem' }}>
            {routes.length} short route{routes.length === 1 ? '' : 's'} · fares per stage
            {canPrice ? ' · edit' : ''}
          </p>
        </Link>
        <div className="mcard">
          <h2><Icon name="truck" size={18} />Fleet</h2>
          <p style={{ margin: '0 0 6px', color: 'var(--tx-2)', fontSize: '.9rem' }}>
            {overview?.fleetSize ?? vehicles.filter((v) => v.Status === 'ACTIVE').length} active vehicles · {overview?.crewActive ?? crew.filter((c) => c.Active).length} crew
          </p>
          <p className="sub" style={{ margin: 0, fontSize: '.8rem' }}>
            {vehicles.map((v) => v.PlateNo).slice(0, 12).join(', ') || 'No vehicles registered yet'}
          </p>
        </div>
      </div>
    </>
  );
}
