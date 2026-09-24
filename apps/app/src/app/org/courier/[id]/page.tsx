/**
 * Courier Portal Home — Parcel Register
 *
 * Replaces /parcel-org/page.tsx
 * Shows all parcels for the logged-in courier company with filtering and search.
 */

import { notFound } from "next/navigation";
import { fetchOrgMe } from "@/lib/org-session";
import { parcelOrgFetch } from "@/lib/parcel-org-session";
import type { ParcelOrgMe, OrgParcelRow } from "@/lib/parcel-org-session";

export const metadata = { title: "Parcels" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CourierDashboard({ params }: PageProps) {
  const { id: orgId } = await params;

  // Fetch org session
  const me = (await fetchOrgMe(orgId, "courier").catch(
    () => null,
  )) as ParcelOrgMe | null;
  if (!me) {
    notFound();
  }

  // Fetch parcels list (this will be replaced with generic org API eventually)
  let parcels: OrgParcelRow[] = [];
  try {
    const res = await parcelOrgFetch<{ parcels: OrgParcelRow[] }>(
      "/v1/parcel-orgs/me/parcels",
    );
    parcels = res.parcels || [];
  } catch (e) {
    console.error("Failed to fetch parcels:", e);
  }

  return (
    <div className="porg-dashboard">
      <div className="porg-dashboard-header">
        <h1>Parcels</h1>
        <div className="porg-stats">
          <div className="stat-card">
            <div className="stat-value">{me.stats.awaitingPickup || 0}</div>
            <div className="stat-label">Awaiting Pickup</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{me.stats.inTransit || 0}</div>
            <div className="stat-label">In Transit</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{me.stats.deliveredToday || 0}</div>
            <div className="stat-label">Delivered Today</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{parcels.length}</div>
            <div className="stat-label">Total Parcels</div>
          </div>
        </div>
      </div>

      <div className="porg-dashboard-content">
        <div className="porg-parcels-section">
          <h2>Recent Parcels</h2>
          {parcels.length === 0 ? (
            <div className="empty-state">
              <p>No parcels found</p>
            </div>
          ) : (
            <div className="porg-parcels-list">
              {parcels.slice(0, 20).map((parcel) => (
                <div key={parcel.id} className="parcel-row">
                  <div className="parcel-code">{parcel.code}</div>
                  <div className="parcel-receiver">{parcel.receiverName}</div>
                  <div className="parcel-status">{parcel.status}</div>
                  <div className="parcel-destination">
                    {parcel.destinationLabel}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .porg-dashboard {
          padding: 1.5rem;
        }
        .porg-dashboard-header {
          margin-bottom: 2rem;
        }
        .porg-dashboard-header h1 {
          margin: 0 0 1rem 0;
          font-size: 1.75rem;
          font-weight: 600;
        }
        .porg-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
        }
        .stat-card {
          padding: 1rem;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
        }
        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
        }
        .stat-label {
          font-size: 0.875rem;
          color: #6b7280;
        }
        .porg-dashboard-content {
          margin-top: 2rem;
        }
        .porg-parcels-section h2 {
          margin: 0 0 1rem 0;
          font-size: 1.25rem;
          font-weight: 600;
        }
        .empty-state {
          padding: 2rem;
          text-align: center;
          background: #f9fafb;
          border-radius: 0.5rem;
        }
        .porg-parcels-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .parcel-row {
          display: grid;
          grid-template-columns: 80px 1fr 100px 1fr;
          gap: 1rem;
          padding: 0.75rem;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.375rem;
          align-items: center;
          font-size: 0.875rem;
        }
        .parcel-code {
          font-weight: 600;
          color: #1f2937;
        }
        .parcel-receiver {
          color: #374151;
        }
        .parcel-status {
          padding: 0.25rem 0.75rem;
          background: #dbeafe;
          color: #0c4a6e;
          border-radius: 0.25rem;
          font-size: 0.75rem;
          font-weight: 500;
          text-align: center;
        }
        .parcel-destination {
          color: #6b7280;
          text-align: right;
        }
      `}</style>
    </div>
  );
}
