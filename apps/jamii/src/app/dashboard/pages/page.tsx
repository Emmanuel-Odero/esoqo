import Link from 'next/link';
import { listJamiiSitePagesForDashboard } from '@esoqo/db';
import { requireMyPage } from '@/lib/session';
import { NewPageForm } from './NewPageForm';

export default async function PagesScreen() {
  const { ctx, page } = await requireMyPage();
  const pages = await listJamiiSitePagesForDashboard(ctx, page.organisationId);

  return (
    <>
      <div className="titlebar">
        <div>
          <h1 style={{ marginBottom: 4 }}>Pages</h1>
          <p className="sub" style={{ marginBottom: 0 }}>
            Every page on your site — the built-in sections below, plus any page you&rsquo;ve created
            yourself. Manage where each one shows up in your menu from{' '}
            <Link href="/dashboard/navigation">Navigation</Link>.
          </p>
        </div>
      </div>

      <NewPageForm pageId={page.organisationId} />

      <div className="card" style={{ padding: 0, overflow: 'auto', marginTop: 16 }}>
        <table className="dtable">
          <thead><tr><th>Page</th><th>Type</th><th>Status</th><th /></tr></thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 700 }}>{p.title}</td>
                <td style={{ color: '#6b6552' }}>{p.kind === 'CUSTOM' ? 'Custom page' : 'Built in'}</td>
                <td style={{ color: p.status === 'PUBLISHED' ? 'var(--ledger)' : '#8a8368' }}>
                  {p.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                </td>
                <td><Link href={`/dashboard/pages/${p.id}`}>Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
