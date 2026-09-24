/**
 * Courier Portal — Money Page
 * 
 * Replaces /parcel-org/money/page.tsx
 * Manage rider float and earnings reconciliation.
 */

import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';
import type { ParcelOrgMe } from '@/lib/parcel-org-session';

export const metadata = { title: 'Money' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CourierMoneyPage({ params }: PageProps) {
  const { id: orgId } = await params;

  // Fetch org session
  const me = (await fetchOrgMe(orgId, 'courier').catch(() => null)) as ParcelOrgMe | null;
  if (!me) {
    notFound();
  }

  const canSeeMoney = me.capabilities.includes('parcelorg.earnings');

  if (!canSeeMoney) {
    return (
      <div className="money-page-unauthorized">
        <div className="unauthorized-message">
          <h1>Access Denied</h1>
          <p>You don't have permission to view money and earnings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="money-page">
      <div className="money-page-header">
        <h1>Money & Earnings</h1>
        <p>Manage rider float and track earnings</p>
      </div>

      <div className="money-page-content">
        <div className="money-section">
          <h2>Company Earnings</h2>
          <div className="earnings-card">
            <div className="earnings-stat">
              <div className="earnings-label">Today</div>
              <div className="earnings-value">
                {me.stats.earningsTodayKes
                  ? `KES ${(parseInt(me.stats.earningsTodayKes) / 100).toLocaleString()}`
                  : 'KES 0'}
              </div>
            </div>
            <div className="earnings-stat">
              <div className="earnings-label">Total</div>
              <div className="earnings-value">
                {me.stats.earningsKes
                  ? `KES ${(parseInt(me.stats.earningsKes) / 100).toLocaleString()}`
                  : 'KES 0'}
              </div>
            </div>
          </div>
        </div>

        <div className="money-section">
          <h2>Rider Float</h2>
          <div className="placeholder-card">
            <p>Manage rider float and reconciliation</p>
            <p className="text-muted">Track cash float, collections, and settlements</p>
          </div>
        </div>

        <div className="money-section">
          <h2>Reconciliation</h2>
          <div className="placeholder-card">
            <p>Reconcile earnings and settlements</p>
            <p className="text-muted">Daily, weekly, and monthly reports</p>
          </div>
        </div>
      </div>

      <style>{`
        .money-page {
          padding: 1.5rem;
        }
        .money-page-header {
          margin-bottom: 2rem;
        }
        .money-page-header h1 {
          margin: 0 0 0.5rem 0;
          font-size: 1.75rem;
          font-weight: 600;
        }
        .money-page-header p {
          margin: 0;
          color: #6b7280;
        }
        .money-page-content {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
        }
        .money-section {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .money-section h2 {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 600;
          color: #1f2937;
        }
        .earnings-card {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          padding: 1rem;
          background: #f0fdf4;
          border: 1px solid #86efac;
          border-radius: 0.5rem;
        }
        .earnings-stat {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .earnings-label {
          font-size: 0.875rem;
          color: #166534;
          font-weight: 500;
        }
        .earnings-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: #15803d;
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
        .money-page-unauthorized {
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
