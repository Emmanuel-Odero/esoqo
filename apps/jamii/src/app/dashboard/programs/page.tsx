import Link from 'next/link';
import { Icon, type IconName } from '@esoqo/ui';
import { listJamiiPrograms } from '@esoqo/db';
import { requireMyPage } from '@/lib/session';

export default async function ProgramsScreen() {
  const { ctx, page } = await requireMyPage();
  const programs = await listJamiiPrograms(ctx, page.organisationId);

  return (
    <>
      <div className="titlebar">
        <div><h1 style={{ marginBottom: 4 }}>Programmes</h1><p className="sub" style={{ marginBottom: 0 }}>What you do — shown on your public Programmes page.</p></div>
        <Link href="/dashboard/programs/new" className="btn btn-ink btn-sm">New programme</Link>
      </div>
      {programs.length === 0 ? (
        <div className="card" style={{ padding: 22, color: '#8a8368' }}>No programmes yet.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="dtable">
            <thead><tr><th>Programme</th><th>Description</th><th /></tr></thead>
            <tbody>
              {programs.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 700 }}>
                    {p.icon && <Icon name={p.icon as IconName} size={14} />} {p.title}
                  </td>
                  <td style={{ color: '#6b6552', maxWidth: 420 }}>{p.body}</td>
                  <td><Link href={`/dashboard/programs/${p.id}/edit`}>Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
