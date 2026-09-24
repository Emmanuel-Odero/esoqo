/**
 * Courier Portal — Settings Page
 * 
 * Replaces /parcel-org/settings/page.tsx
 * Configure pricing, stations, team, labels, and more.
 */

import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';
import type { ParcelOrgMe } from '@/lib/parcel-org-session';

export const metadata = { title: 'Settings' };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CourierSettingsPage({ params }: PageProps) {
  const { id: orgId } = await params;

  // Fetch org session
  const me = (await fetchOrgMe(orgId, 'courier').catch(() => null)) as ParcelOrgMe | null;
  if (!me) {
    notFound();
  }

  const canManagePricing = me.capabilities.includes('parcelorg.write');
  const canManageStaff = me.capabilities.includes('parcelorg.staff');
  const canManageStations = me.capabilities.includes('parcelorg.stations');

  const settingsTabs = [
    {
      id: 'profile',
      label: 'Profile',
      href: `/org/courier/${orgId}/settings/profile`,
      always: true,
    },
    {
      id: 'team',
      label: 'Team',
      href: `/org/courier/${orgId}/settings/team`,
      show: canManageStaff,
    },
    {
      id: 'pricing',
      label: 'Pricing',
      href: `/org/courier/${orgId}/settings/rates`,
      show: canManagePricing,
    },
    {
      id: 'stations',
      label: 'Stations',
      href: `/org/courier/${orgId}/settings/stations`,
      show: canManageStations,
    },
    {
      id: 'labels',
      label: 'Labels',
      href: `/org/courier/${orgId}/settings/labels`,
      show: true,
    },
    {
      id: 'routes',
      label: 'Routes',
      href: `/org/courier/${orgId}/settings/routes`,
      show: canManageStaff,
    },
    {
      id: 'security',
      label: 'Security',
      href: `/org/courier/${orgId}/settings/security`,
      show: true,
    },
  ];

  const visibleTabs = settingsTabs.filter((t) => t.show !== false || t.always);

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <h1>Settings</h1>
        <p>Configure your courier company</p>
      </div>

      <div className="settings-page-content">
        <div className="settings-tabs">
          <nav className="tabs-nav">
            {visibleTabs.map((tab) => (
              <a
                key={tab.id}
                href={tab.href}
                className="tab-link"
              >
                {tab.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="settings-sections">
          <div className="settings-section">
            <h2>Company Settings</h2>
            <div className="placeholder-card">
              <p>Select a settings category from the tabs above</p>
              <p className="text-muted">
                Manage your company profile, team members, pricing, stations, label inventory, routes, and security settings.
              </p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .settings-page {
          padding: 1.5rem;
        }
        .settings-page-header {
          margin-bottom: 2rem;
        }
        .settings-page-header h1 {
          margin: 0 0 0.5rem 0;
          font-size: 1.75rem;
          font-weight: 600;
        }
        .settings-page-header p {
          margin: 0;
          color: #6b7280;
        }
        .settings-page-content {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .settings-tabs {
          border-bottom: 1px solid #e5e7eb;
        }
        .tabs-nav {
          display: flex;
          gap: 0;
          flex-wrap: wrap;
        }
        .tab-link {
          padding: 1rem 1.5rem;
          border-bottom: 2px solid transparent;
          color: #6b7280;
          text-decoration: none;
          font-weight: 500;
          transition: all 0.2s;
        }
        .tab-link:hover {
          color: #1f2937;
          border-bottom-color: #d1d5db;
        }
        .tab-link:active {
          color: #1f2937;
          border-bottom-color: #3b82f6;
        }
        .settings-sections {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .settings-section {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .settings-section h2 {
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
      `}</style>
    </div>
  );
}
