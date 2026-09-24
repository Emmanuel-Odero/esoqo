/**
 * Courier Portal — Scan Page
 * 
 * Replaces /parcel-org/scan/page.tsx
 * Allows scanning/typing parcel codes and resolving them against company's own stock.
 */

import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';
import type { ParcelOrgMe } from '@/lib/parcel-org-session';
import { ScanForm } from './ScanForm';

export const metadata = { title: 'Scan' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CourierScanPage({ params }: PageProps) {
  const { id: orgId } = await params;

  // Fetch org session
  const me = (await fetchOrgMe(orgId, 'courier').catch(() => null)) as ParcelOrgMe | null;
  if (!me) {
    notFound();
  }

  const canScan =
    me.capabilities.includes('parcelorg.intake')
    || me.capabilities.includes('parcelorg.arrival')
    || me.capabilities.includes('parcelorg.carry');

  if (!canScan) {
    return (
      <div className="scan-page-unauthorized">
        <div className="unauthorized-message">
          <h1>Access Denied</h1>
          <p>You don't have permission to scan parcels</p>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-page">
      <div className="scan-page-header">
        <h1>Scan Parcel</h1>
        <p>Scan or type a parcel code to look it up and take action</p>
      </div>

      <div className="scan-page-content">
        <ScanForm orgId={orgId} custodyCapable={me.custodyCapable !== false} />
      </div>

      <style>{`
        .scan-page {
          padding: 1.5rem;
          max-width: 800px;
          margin: 0 auto;
        }
        .scan-page-header {
          margin-bottom: 2rem;
        }
        .scan-page-header h1 {
          margin: 0 0 0.5rem 0;
          font-size: 1.75rem;
          font-weight: 600;
        }
        .scan-page-header p {
          margin: 0;
          color: #6b7280;
        }
        .scan-page-content {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 2rem;
        }
        .scan-page-unauthorized {
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
