/**
 * Courier Portal — Counter Page
 * 
 * Replaces /parcel-org/counter/page.tsx
 * The commercial desk: book a parcel and manage label stock.
 */

import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';
import type { ParcelOrgMe } from '@/lib/parcel-org-session';

export const metadata = { title: 'Counter' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CourierCounterPage({ params }: PageProps) {
  const { id: orgId } = await params;

  // Fetch org session
  const me = (await fetchOrgMe(orgId, 'courier').catch(() => null)) as ParcelOrgMe | null;
  if (!me) {
    notFound();
  }

  const canDispatch = me.capabilities.includes('parcelorg.dispatch');
  const canSell = canDispatch || me.capabilities.includes('parcelorg.write');

  if (!canSell) {
    return (
      <div className="counter-page-unauthorized">
        <div className="unauthorized-message">
          <h1>Access Denied</h1>
          <p>You don't have permission to use the counter</p>
        </div>
      </div>
    );
  }

  return (
    <div className="counter-page">
      <div className="counter-page-header">
        <h1>Counter</h1>
        <p>Book parcels and manage label stock</p>
      </div>

      <div className="counter-page-content">
        <div className="counter-section">
          <h2>Book a Parcel</h2>
          <div className="placeholder-card">
            <p>Counter booking form - replaces /parcel-org/counter</p>
            <p className="text-muted">This page will be implemented with courier-specific booking UI</p>
          </div>
        </div>

        <div className="counter-section">
          <h2>Label Stock</h2>
          <div className="placeholder-card">
            <p>Label management - track and manage label inventory</p>
            <p className="text-muted">Shows available labels and batch management</p>
          </div>
        </div>

        <div className="counter-section">
          <h2>Recent Bookings</h2>
          <div className="placeholder-card">
            <p>Recent counter bookings for this org</p>
            <p className="text-muted">Shows today's bookings and statistics</p>
          </div>
        </div>
      </div>

      <style>{`
        .counter-page {
          padding: 1.5rem;
        }
        .counter-page-header {
          margin-bottom: 2rem;
        }
        .counter-page-header h1 {
          margin: 0 0 0.5rem 0;
          font-size: 1.75rem;
          font-weight: 600;
        }
        .counter-page-header p {
          margin: 0;
          color: #6b7280;
        }
        .counter-page-content {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }
        .counter-section {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .counter-section h2 {
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
        .counter-page-unauthorized {
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
