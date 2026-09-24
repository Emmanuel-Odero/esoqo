/**
 * Hotel Portal — Settings
 */
import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';

export const metadata = { title: 'Settings' };

export default async function HotelSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = await params;
  const me = await fetchOrgMe(orgId, 'hotel').catch(() => null);
  if (!me) notFound();

  return (
    <main className="hotel-main">
      <div className="hotel-page-header">
        <h1>Settings</h1>
        <p className="subtitle">{me.org.name}</p>
      </div>

      <section className="settings-section">
        <h2>Hotel Profile</h2>
        <div className="settings-card">
          <div className="setting-row">
            <span className="setting-label">Name</span>
            <span className="setting-value">{me.org.name}</span>
          </div>
          <div className="setting-row">
            <span className="setting-label">Slug</span>
            <span className="setting-value">{me.org.slug}</span>
          </div>
          <div className="setting-row">
            <span className="setting-label">Status</span>
            <span className="setting-value">{me.org.status}</span>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>Session</h2>
        <div className="settings-card">
          <p className="setting-help">
            You are signed in as a hotel staff member. Your capabilities:{' '}
            {me.capabilities.length > 0
              ? me.capabilities.join(', ')
              : 'none'}
          </p>
          <form action="/orgs/signout" method="post">
            <button type="submit" className="btn-danger">Sign out of hotel</button>
          </form>
        </div>
      </section>

      <style>{`
        .hotel-main { padding: 1.5rem; max-width: 700px; }
        .hotel-page-header { margin-bottom: 2rem; }
        .hotel-page-header h1 { margin: 0 0 .25rem; font-size: 1.5rem; font-weight: 700; }
        .subtitle { margin: 0; color: #6b7280; font-size: .875rem; }
        .settings-section { margin-bottom: 2rem; }
        .settings-section h2 { margin: 0 0 .75rem; font-size: 1rem; font-weight: 600; color: #374151; }
        .settings-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: .5rem; padding: 1rem; display: flex; flex-direction: column; gap: .75rem; }
        .setting-row { display: flex; justify-content: space-between; font-size: .875rem; }
        .setting-label { font-weight: 500; color: #374151; }
        .setting-value { color: #1f2937; }
        .setting-help { margin: 0; font-size: .875rem; color: #6b7280; }
        .btn-danger { padding: .5rem 1rem; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; border-radius: .375rem; font-size: .875rem; font-weight: 500; cursor: pointer; }
        .btn-danger:hover { background: #fecaca; }
      `}</style>
    </main>
  );
}
