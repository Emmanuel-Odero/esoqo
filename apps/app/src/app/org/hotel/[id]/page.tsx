/**
 * Hotel Portal — Dashboard
 *
 * Shows live occupancy, today's arrivals/departures, and quick actions.
 * Proof-of-concept for the generic org portal architecture.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { fetchOrgMe } from "@/lib/org-session";
import { hotelFetch } from "./hotel-fetch";

export const metadata = { title: "Hotel Dashboard" };

interface DashboardData {
  org: { id: string; name: string; slug: string };
  occupancy: {
    totalRooms: string;
    occupiedRooms: string;
    availableRooms: string;
  };
}

export default async function HotelDashboard({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = await params;

  const me = await fetchOrgMe(orgId, "hotel").catch(() => null);
  if (!me) notFound();

  const dashboard = await hotelFetch<DashboardData>(
    orgId,
    `/v1/hotels/${orgId}/dashboard`,
  ).catch(() => null);

  const total = Number(dashboard?.occupancy?.totalRooms || 0);
  const occupied = Number(dashboard?.occupancy?.occupiedRooms || 0);
  const available = Number(
    dashboard?.occupancy?.availableRooms || total - occupied,
  );
  const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0;

  return (
    <main className="hotel-main">
      <div className="hotel-page-header">
        <h1>{me.org.name}</h1>
        <p className="subtitle">Hotel Dashboard</p>
      </div>

      {/* Occupancy strip */}
      <section className="hotel-section">
        <h2 className="section-title">Occupancy</h2>
        <div className="metrics-row">
          <div className="metric-card metric-total">
            <span className="metric-number">{total || "—"}</span>
            <span className="metric-label">Total Rooms</span>
          </div>
          <div className="metric-card metric-occupied">
            <span className="metric-number">{occupied}</span>
            <span className="metric-label">Occupied</span>
          </div>
          <div className="metric-card metric-available">
            <span className="metric-number">{available}</span>
            <span className="metric-label">Available</span>
          </div>
          <div className="metric-card metric-pct">
            <span className="metric-number">{occupancyPct}%</span>
            <span className="metric-label">Occupancy Rate</span>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="hotel-section">
        <h2 className="section-title">Quick Actions</h2>
        <div className="actions-grid">
          <Link
            href={`/org/hotel/${orgId}/reservations` as Route}
            className="action-tile"
          >
            <span className="action-icon">📋</span>
            <span className="action-title">Reservations</span>
            <span className="action-desc">
              View and manage guest reservations
            </span>
          </Link>
          <Link href={`/org/hotel/${orgId}/rooms` as Route} className="action-tile">
            <span className="action-icon">🛏</span>
            <span className="action-title">Rooms</span>
            <span className="action-desc">Room status and housekeeping</span>
          </Link>
          <Link href={`/org/hotel/${orgId}/staff` as Route} className="action-tile">
            <span className="action-icon">👥</span>
            <span className="action-title">Staff</span>
            <span className="action-desc">Manage hotel team members</span>
          </Link>
          <Link href={`/org/hotel/${orgId}/settings` as Route} className="action-tile">
            <span className="action-icon">⚙️</span>
            <span className="action-title">Settings</span>
            <span className="action-desc">Configure hotel profile</span>
          </Link>
        </div>
      </section>

      <style>{`
        .hotel-main {
          padding: 1.5rem;
          max-width: 1100px;
        }
        .hotel-page-header {
          margin-bottom: 2rem;
        }
        .hotel-page-header h1 {
          margin: 0 0 0.25rem;
          font-size: 1.75rem;
          font-weight: 700;
        }
        .subtitle {
          margin: 0;
          color: #6b7280;
          font-size: 0.9rem;
        }
        .hotel-section {
          margin-bottom: 2.5rem;
        }
        .section-title {
          margin: 0 0 1rem;
          font-size: 1rem;
          font-weight: 600;
          color: #374151;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .metrics-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 1rem;
        }
        .metric-card {
          padding: 1.25rem;
          border-radius: 0.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .metric-total {
          background: #f3f4f6;
        }
        .metric-occupied {
          background: #fef3c7;
        }
        .metric-available {
          background: #d1fae5;
        }
        .metric-pct {
          background: #dbeafe;
        }
        .metric-number {
          font-size: 2rem;
          font-weight: 700;
          line-height: 1;
        }
        .metric-label {
          font-size: 0.8rem;
          color: #6b7280;
          font-weight: 500;
        }
        .actions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1rem;
        }
        .action-tile {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          padding: 1.25rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          text-decoration: none;
          color: inherit;
          transition:
            border-color 0.15s,
            box-shadow 0.15s;
        }
        .action-tile:hover {
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.08);
        }
        .action-icon {
          font-size: 1.5rem;
        }
        .action-title {
          font-weight: 600;
          font-size: 0.95rem;
        }
        .action-desc {
          font-size: 0.8rem;
          color: #6b7280;
        }
      `}</style>
    </main>
  );
}
