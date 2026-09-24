/**
 * Courier Portal — Dispatch Page
 * 
 * Replaces /parcel-org/dispatch/page.tsx
 * Runs / fleet board showing active and completed dispatch runs.
 */

import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';
import type { ParcelOrgMe } from '@/lib/parcel-org-session';

export const metadata = { title: 'Dispatch' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CourierDispatchPage({ params }: PageProps) {
  const { id: orgId } = await params;

  // Fetch org session
  const me = (await fetchOrgMe(orgId, 'courier').catch(() => null)) as ParcelOrgMe | null;
  if (!me) {
    notFound();
  }

  const canDispatch = me.capabilities.includes('parcelorg.dispatch');

  if (!canDispatch) {
    return (
      <div className="dispatch-page-unauthorized">
        <div className="unauthorized-message">
          <h1>Access Denied</h1>
          <p>You don't have permission to manage dispatch</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dispatch-page">
      <div className="dispatch-page-header">
        <h1>Dispatch</h1>
        <p>Manage runs and fleet operations</p>
      </div>

      <div className="dispatch-page-content">
        <div className="dispatch-section">
          <h2>Active Runs</h2>
          <div className="placeholder-card">
            <p>Live dispatch board with active runs</p>
            <p className="text-muted">Shows vehicle locations, crew, cargo, and ETA</p>
          </div>
        </div>

        <div className="dispatch-section">
          <h2>Create New Run</h2>
          <div className="placeholder-card">
            <p>Create a new dispatch run</p>
            <p className="text-muted">Assign vehicle, crew, parcels, and route</p>
          </div>
        </div>

        <div className="dispatch-section">
          <h2>Run History</h2>
          <div className="placeholder-card">
            <p>Completed runs and delivery history</p>
            <p className="text-muted">Analytics and performance tracking</p>
          </div>
        </div>
      </div>

      <style>{`
        .dispatch-page {
          padding: 1.5rem;
        }
        .dispatch-page-header {
          margin-bottom: 2rem;
        }
        .dispatch-page-header h1 {
          margin: 0 0 0.5rem 0;
          font-size: 1.75rem;
          font-weight: 600;
        }
        .dispatch-page-header p {
          margin: 0;
          color: #6b7280;
        }
        .dispatch-page-content {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }
        .dispatch-section {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .dispatch-section h2 {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 600;
          color: #1f2937;
        }
        .placeholder-card {
          padding: 1.5rem;
          background: #f9fafb;
          border: 2px dashed #d1d5db;
          border-radius: 0.5rem;
          text-align: center;
          color: #6b7280;
        }
        .placeholder-card p {
          margin: 0.5rem 0;
        }
        .text-muted {
          font-size: 0.875rem;
          color: #9ca3af;
        }
        .dispatch-page-unauthorized {
          padding: 2rem;
          text-align: center;
        }
        .unauthorized-message {
          padding: 2rem;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 0.5rem;
        }
        .unauthorized-message h1 {
          margin: 0 0 0.5rem 0;
          color: #991b1b;
        }
        .unauthorized-message p {
          margin: 0;
          color: #7f1d1d;
        }
      `}</style>
    </div>
  );
}
